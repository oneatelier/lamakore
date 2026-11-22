//! Linux Tier-1: Landlock FS + seccomp sockets + no-new-privs + PDEATHSIG.
//!
//! One spawned tool process gets:
//! * a Landlock ruleset (best-effort, ABI V1 for maximum kernel compat):
//!   read-only on system hierarchies (`/bin`, `/lib`, `/lib64`, `/usr`,
//!   `/etc`, `/proc`, `/sys`), read-write on `/dev` and on the canonicalized
//!   `scope_dir` only — every other path (including the sibling
//!   outside-file) is denied;
//! * a seccomp-bpf filter (via `seccompiler`) denying
//!   `socket(AF_INET)`/`socket(AF_INET6)` with `EPERM` (Unix sockets stay
//!   allowed so `nss`/`dlopen` keep working), default-allow otherwise;
//! * `PR_SET_NO_NEW_PRIVS` and `PR_SET_PDEATHSIG,SIGKILL` so a dead parent
//!   reaps the child (the `KILL_ON_JOB_CLOSE` analogue).
//!
//! All confinement is applied in the forked child via
//! `Command::pre_exec` (async-signal-safe syscalls only on our side; the
//! `landlock`/`seccompiler` crates may allocate internally — accepted, as in
//! many sandbox harnesses; production P017 dispatch should use a dedicated
//! fork server if flakiness is ever observed). Pre-built state lives in the
//! parent; the child only passes already-allocated buffers to syscalls and
//! reports failures with static `write(2)` strings (no `format!` in the
//! child) so CI logs show which stage broke.

use std::ffi::OsStr;
use std::os::unix::process::CommandExt as _;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::SandboxError;

fn api_err(op: &'static str, detail: String) -> SandboxError {
    SandboxError::Api { op, detail }
}

fn unavailable(reason: String) -> SandboxError {
    SandboxError::Unavailable { reason }
}

/// Raw `write(2)` of a static message. Async-signal-safe; ignores errors.
/// Used only in the `pre_exec` child to name the failing stage in CI logs
/// without allocating.
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

/// Landlock: scope RW, system RO, everything else denied. Best-effort ABI V1
/// (supported since Linux 5.13) so any Landlock kernel FullyEnforces;
/// newer kernels simply enforce the same V1 subset. Returns the restriction
/// status so the caller can require `FullyEnforced` (integrity: a
/// `NotEnforced` kernel must not silently run unconfined).
///
/// Called in the `pre_exec` child. Our own error paths allocate nothing
/// (static messages + errno); the `landlock` crate internals may allocate.
fn apply_landlock(scope_abs: &Path) -> Result<landlock::RestrictionStatus, ()> {
    use landlock::{
        ABI, Access, AccessFs, Ruleset, RulesetAttr, RulesetCreatedAttr, RulesetStatus,
        path_beneath_rules,
    };
    // V1 = FS only, maximal compat. Net is covered by seccomp below.
    let abi = ABI::V1;
    let ro = ["/bin", "/lib", "/lib64", "/usr", "/etc", "/proc", "/sys"];
    let created = Ruleset::default()
        .handle_access(AccessFs::from_all(abi))
        .and_then(|r| r.create())
        .map_err(|_| ())?;
    let created = created
        .add_rules(path_beneath_rules(ro, AccessFs::from_read(abi)))
        .map_err(|_| ())?;
    let created = created
        .add_rules(path_beneath_rules(["/dev"], AccessFs::from_all(abi)))
        .map_err(|_| ())?;
    let created = created
        .add_rules(path_beneath_rules([scope_abs], AccessFs::from_all(abi)))
        .map_err(|_| ())?;
    let status = created.restrict_self().map_err(|_| ())?;
    match status.ruleset {
        RulesetStatus::FullyEnforced => Ok(status),
        RulesetStatus::PartiallyEnforced | RulesetStatus::NotEnforced => Err(()),
    }
}

/// Seccomp: deny `socket(AF_INET)` and `socket(AF_INET6)` with EPERM.
/// Unix sockets stay allowed. Default-allow everything else.
///
/// Called in the `pre_exec` child. BPF is compiled here (allocates — see
/// module docs); failures are reported with a static message + errno.
fn apply_seccomp() -> Result<(), ()> {
    use seccompiler::{
        SeccompAction, SeccompCmpArgLen, SeccompCmpOp, SeccompCondition, SeccompFilter,
        SeccompRule, TargetArch,
    };
    use std::collections::BTreeMap;
    use std::convert::TryInto as _;

    let mut rules: BTreeMap<i64, Vec<SeccompRule>> = BTreeMap::new();
    let inet = SeccompRule::new(vec![
        SeccompCondition::new(
            0,
            SeccompCmpArgLen::Dword,
            SeccompCmpOp::Eq,
            libc::AF_INET as u64,
        )
        .map_err(|_| ())?,
    ])
    .map_err(|_| ())?;
    let inet6 = SeccompRule::new(vec![
        SeccompCondition::new(
            0,
            SeccompCmpArgLen::Dword,
            SeccompCmpOp::Eq,
            libc::AF_INET6 as u64,
        )
        .map_err(|_| ())?,
    ])
    .map_err(|_| ())?;
    rules.insert(libc::SYS_socket, vec![inet, inet6]);

    let arch: TargetArch = std::env::consts::ARCH.try_into().map_err(|_| ())?;
    let filter = SeccompFilter::new(
        rules,
        SeccompAction::Allow,
        SeccompAction::Errno(libc::EPERM as u32),
        arch,
    )
    .map_err(|_| ())?;
    let bpf: seccompiler::BpfProgram = filter.try_into().map_err(|_| ())?;
    seccompiler::apply_filter(&bpf).map_err(|_| ())?;
    Ok(())
}

/// A live Tier-1 child. Owns the `std::process::Child` behind a mutex so the
/// public API stays `&self` like the Windows driver; `Drop` kills + reaps.
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

    /// Kill the whole child (SIGKILL).
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
        // Best-effort kill + reap: avoids zombies and orphans when the parent
        // goes away (PDEATHSIG covers the true parent-death crash path).
        if let Ok(mut guard) = self.child.lock() {
            let _ = guard.kill();
            let _ = guard.wait();
        }
    }
}

/// Spawn `program` + `args` confined to Tier-1, with `scope_dir` as the
/// working directory and the only explicitly granted write location.
pub fn spawn(
    scope_dir: &Path,
    program: &OsStr,
    args: &[&OsStr],
) -> Result<SandboxedChild, SandboxError> {
    std::fs::create_dir_all(scope_dir).map_err(|e| SandboxError::Io {
        path: scope_dir.display().to_string(),
        source: e,
    })?;
    // Canonicalize so Landlock `subpath` rules match the real paths
    // (`/tmp` etc. have no symlink games on Linux, but canonical form is
    // still the only sound rule input).
    let scope_abs: PathBuf = std::fs::canonicalize(scope_dir).map_err(|e| SandboxError::Io {
        path: scope_dir.display().to_string(),
        source: e,
    })?;

    let mut cmd = Command::new(program);
    cmd.args(args);
    cmd.current_dir(&scope_abs);

    let scope_for_child = scope_abs.clone();
    unsafe {
        cmd.pre_exec(move || {
            // 1. Parent-death signal (orphan cleanup).
            let ppid = libc::getppid();
            if libc::prctl(
                libc::PR_SET_PDEATHSIG,
                libc::SIGKILL as libc::c_ulong,
                0,
                0,
                0,
            ) != 0
            {
                return Err(std::io::Error::last_os_error());
            }
            // Race: parent may have died between fork and prctl.
            if libc::getppid() != ppid {
                return Err(std::io::Error::from_raw_os_error(libc::ESRCH));
            }
            // 2. No new privileges (also set by Landlock/seccomp, but early).
            if libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            // 3. Landlock FS confinement (must be FullyEnforced).
            if apply_landlock(&scope_for_child).is_err() {
                write_stderr_static(b"sandbox: landlock restrict failed or not enforced\n");
                return Err(std::io::Error::from_raw_os_error(libc::ENOTSUP));
            }
            // 4. Seccomp socket denial.
            if apply_seccomp().is_err() {
                write_stderr_static(b"sandbox: seccomp filter failed\n");
                return Err(std::io::Error::from_raw_os_error(libc::EINVAL));
            }
            Ok(())
        });
    }

    let child = cmd.spawn().map_err(|e| {
        // `pre_exec` failures surface here. Distinguish "kernel cannot
        // enforce" (honest NOT_IMPLEMENTED) from real bugs by errno:
        // ENOTSUP/ESRCH from our Landlock/PDEATHSIG paths mean the platform
        // cannot enforce; everything else is a hard spawn failure.
        let code = e.raw_os_error();
        if code == Some(libc::ENOTSUP) || code == Some(libc::ESRCH) {
            unavailable(format!("linux sandbox unavailable: {e}"))
        } else {
            api_err("spawn", format!("linux spawn failed: {e}"))
        }
    })?;
    Ok(SandboxedChild {
        child: std::sync::Mutex::new(child),
        scope_dir: scope_abs,
    })
}
