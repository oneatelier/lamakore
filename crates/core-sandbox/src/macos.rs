//! macOS Tier-1: Seatbelt via `sandbox_init`.
//!
//! One spawned tool process gets a Seatbelt profile (raw SBPL):
//! `(allow default)` base with `(deny network*)` and a broad
//! `(deny file-write* (subpath "/"))` overridden only by an explicit
//! `(allow file-write* (subpath <scope>) ...)` for the canonicalized scope
//! plus `/dev/null` + `/dev/tty`. Reads stay allowed (including scope
//! reads); writes outside the scope and all sockets are denied by the
//! kernel for the process and every child it spawns.
//!
//! Applied in the forked child via `Command::pre_exec` (like the Linux
//! driver). `sandbox_init` is linked from `libSystem`; failures are
//! reported with a raw `write(2)` of the libSystem error string (no Rust
//! allocation in the child) and mapped to a hard `Api` error in the
//! parent. A missing symbol would be a load failure — treated as
//! `Unavailable` only via the explicit probe below.

use std::ffi::OsStr;
use std::os::unix::process::CommandExt as _;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::SandboxError;

fn api_err(op: &'static str, detail: String) -> SandboxError {
    SandboxError::Api { op, detail }
}

use std::os::raw::{c_char, c_int};

unsafe extern "C" {
    fn sandbox_init(profile: *const c_char, flags: u64, errorbuf: *mut *mut c_char) -> c_int;
}

const SANDBOX_RAW: u64 = 0;

/// Raw `write(2)` of static bytes. Async-signal-safe; ignores errors.
unsafe fn write_stderr_static(msg: &[u8]) {
    unsafe {
        let mut done = 0usize;
        while done < msg.len() {
            let r = libc::write(
                2,
                msg.as_ptr().add(done) as *const libc::c_void,
                msg.len() - done,
            );
            if r <= 0 {
                break;
            }
            done += r as usize;
        }
    }
}

/// Escape a path for embedding in an SBPL string literal.
fn escape_sbpl(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Build the Tier-1 SBPL profile for `scope_abs` (already canonicalized,
/// so `/var` → `/private/var` matching is exact).
fn build_profile(scope_abs: &str) -> Vec<u8> {
    let scope = escape_sbpl(scope_abs);
    let profile = format!(
        "(version 1)\n\
(allow default)\n\
(deny network*)\n\
(deny file-write* (subpath \"/\"))\n\
(allow file-write* (subpath \"{scope}\") (literal \"/dev/null\") (literal \"/dev/tty\"))\n"
    );
    let mut v = profile.into_bytes();
    v.push(0);
    v
}

/// A live Tier-1 child. Owns the `std::process::Child` behind a mutex so the
/// public API stays `&self` like the other drivers; `Drop` kills + reaps.
pub struct SandboxedChild {
    child: std::sync::Mutex<std::process::Child>,
    scope_dir: PathBuf,
}

impl SandboxedChild {
    /// OS process id of the confined child.
    pub fn pid(&self) -> u32 {
        match self.child.lock() {
            Ok(g) => g.id(),
            Err(e) => e.into_inner().id(),
        }
    }

    /// Scope directory this child was granted.
    pub fn scope_dir(&self) -> &Path {
        &self.scope_dir
    }

    fn lock_child(&self) -> std::sync::MutexGuard<'_, std::process::Child> {
        match self.child.lock() {
            Ok(g) => g,
            Err(e) => e.into_inner(),
        }
    }

    /// `true` while the child has not exited.
    pub fn is_alive(&self) -> bool {
        match self.lock_child().try_wait() {
            Ok(None) => true,
            Ok(Some(_)) | Err(_) => false,
        }
    }

    /// Wait up to `timeout_ms` for exit. Returns `Some(code)` on exit,
    /// `None` on timeout.
    pub fn wait_timeout(&self, timeout_ms: u32) -> Result<Option<u32>, SandboxError> {
        let step = std::time::Duration::from_millis(10);
        let mut waited = 0u32;
        loop {
            match self.lock_child().try_wait() {
                Ok(Some(status)) => return Ok(status.code().map(|c| c as u32)),
                Ok(None) => {}
                Err(e) => {
                    return Err(api_err("try_wait", format!("wait poll failed: {e}")));
                }
            }
            if waited >= timeout_ms {
                return Ok(None);
            }
            std::thread::sleep(step);
            waited = waited.saturating_add(10);
        }
    }

    /// Wait forever for exit and return the exit code.
    pub fn wait(&self) -> Result<u32, SandboxError> {
        match self.lock_child().wait() {
            Ok(status) => Ok(status.code().unwrap_or(-1) as u32),
            Err(e) => Err(api_err("wait", format!("wait failed: {e}"))),
        }
    }

    /// Kill the child (SIGKILL).
    pub fn kill(&self) -> Result<(), SandboxError> {
        match self.lock_child().kill() {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::InvalidInput => Ok(()),
            Err(e) => Err(api_err("kill", format!("kill failed: {e}"))),
        }
    }
}

impl Drop for SandboxedChild {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.child.lock() {
            let _ = guard.kill();
            let _ = guard.wait();
        }
    }
}

/// Spawn `program` + `args` confined to Tier-1, with `scope_dir` as the
/// working directory and the only granted write location.
pub fn spawn(
    scope_dir: &Path,
    program: &OsStr,
    args: &[&OsStr],
) -> Result<SandboxedChild, SandboxError> {
    std::fs::create_dir_all(scope_dir).map_err(|e| SandboxError::Io {
        path: scope_dir.display().to_string(),
        source: e,
    })?;
    // Canonicalize: Seatbelt matches resolved paths (`/var` is a symlink to
    // `/private/var`, `/tmp` to `/private/tmp`).
    let scope_abs: PathBuf = std::fs::canonicalize(scope_dir).map_err(|e| SandboxError::Io {
        path: scope_dir.display().to_string(),
        source: e,
    })?;
    let scope_str = scope_abs.to_str().ok_or_else(|| {
        api_err(
            "scope",
            "scope path is not valid UTF-8 for the Seatbelt profile".to_string(),
        )
    })?;
    let profile = build_profile(scope_str);

    let mut cmd = Command::new(program);
    cmd.args(args);
    cmd.current_dir(&scope_abs);

    unsafe {
        cmd.pre_exec(move || {
            // profile is NUL-terminated (built above); pass the raw pointer.
            let mut errorbuf: *mut c_char = std::ptr::null_mut();
            let rc = sandbox_init(
                profile.as_ptr() as *const c_char,
                SANDBOX_RAW,
                &mut errorbuf,
            );
            if rc == 0 {
                return Ok(());
            }
            // Failure: copy the libSystem message to stderr with raw
            // syscalls only (no Rust allocation in the child), then fail
            // the spawn with EPERM so the parent maps it to a hard error.
            // (Leak errorbuf: the child exits right after; avoids malloc
            //  lock churn in the forked child.)
            if !errorbuf.is_null() {
                let mut len = 0usize;
                while *errorbuf.add(len) != 0 {
                    len += 1;
                }
                write_stderr_static(b"sandbox: sandbox_init failed: ");
                let slice = std::slice::from_raw_parts(errorbuf as *const u8, len);
                write_stderr_static(slice);
                write_stderr_static(b"\n");
            } else {
                write_stderr_static(b"sandbox: sandbox_init failed (no detail)\n");
            }
            Err(std::io::Error::from_raw_os_error(libc::EPERM))
        });
    }

    let child = cmd
        .spawn()
        .map_err(|e| api_err("spawn", format!("macos spawn failed: {e}")))?;
    // Note: a linked `sandbox_init` missing at load would prevent this binary
    // from starting at all; a pre_exec EPERM above is a hard profile failure,
    // not an "unavailable" platform — kept as Api (never fake green).
    Ok(SandboxedChild {
        child: std::sync::Mutex::new(child),
        scope_dir: scope_abs,
    })
}
