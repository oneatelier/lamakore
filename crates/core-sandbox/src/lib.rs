//! core-sandbox — OS sandbox drivers for tool execution.
//!
//! Driver order follows the P000 host profile: always-present primitives
//! first (Job Objects, AppContainer), hypervisor-backed isolation only as
//! an opt-in tier. See ADR-000, consequence 3.
//!
//! Tier-1 confines one spawned tool process per OS:
//!
//! * Windows: Job Object (`KILL_ON_JOB_CLOSE`, no breakaway, UI
//!   restrictions) plus an AppContainer security context with ZERO
//!   capabilities (no network, no broad filesystem) and an explicit DACL
//!   grant of the declared scope directory to the AppContainer SID.
//!   [`spawn_sandboxed`] is what P017 dispatches through.
//! * Linux: Landlock filesystem rules (scope read-write, system read-only,
//!   best-effort ABI with the observed ABI recorded) plus a seccomp-bpf
//!   filter (via `seccompiler`) denying `socket(AF_INET/AF_INET6)` with
//!   `EPERM`, plus `PR_SET_NO_NEW_PRIVS` and `PR_SET_PDEATHSIG,SIGKILL`
//!   orphan cleanup.
//! * macOS: Seatbelt via `sandbox_init` (`deny network*`, `deny file-write*`
//!   outside the scope, scope reads/writes allowed).
//!
//! Non-supported platforms return [`SandboxError::UnsupportedPlatform`];
//! supported platforms whose primitive is unavailable at runtime return
//! [`SandboxError::Unavailable`] (both map to the NOT_IMPLEMENTED wire
//! error — never fake enforcement).

#![deny(clippy::unwrap_used)]
#![deny(clippy::expect_used)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

/// A sandbox driver the daemon may confine a tool with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Driver {
    /// Windows Job Objects: memory, CPU, and process-tree limits.
    JobObjects,
    /// Windows AppContainer / integrity levels: token sandboxing.
    AppContainer,
    /// Windows Low Privilege AppContainer: least-capability tokens.
    Lpac,
    /// Linux Landlock: unprivileged filesystem self-confinement.
    Landlock,
    /// Linux seccomp-bpf: syscall filtering (socket denial).
    Seccomp,
    /// macOS Seatbelt: `sandbox_init` SBPL profiles.
    Seatbelt,
}

/// Drivers verified present on the reference host, strongest first.
pub fn default_drivers() -> Vec<Driver> {
    #[cfg(windows)]
    {
        vec![Driver::JobObjects, Driver::AppContainer, Driver::Lpac]
    }
    #[cfg(target_os = "linux")]
    {
        vec![Driver::Landlock, Driver::Seccomp]
    }
    #[cfg(target_os = "macos")]
    {
        vec![Driver::Seatbelt]
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        vec![]
    }
}

/// Wire error code the daemon reports when sandboxing is unavailable here.
pub const NOT_IMPLEMENTED_CODE: i64 = -32002;

/// Every sandbox failure. Panics are a bug: every failure is reported here.
#[derive(Debug, thiserror::Error)]
pub enum SandboxError {
    /// This platform has no Tier-1 driver (anything but Windows/Linux/macOS).
    #[error("sandbox not implemented on this platform")]
    UnsupportedPlatform,
    /// A supported platform whose primitive is unavailable at runtime
    /// (e.g. Landlock disabled, `sandbox_init` missing). Honest
    /// NOT_IMPLEMENTED — never fake enforcement.
    #[error("sandbox unavailable: {reason}")]
    Unavailable { reason: String },
    /// A Windows API call failed (function name + system detail).
    #[error("windows api failed in {op}: {detail}")]
    Api { op: &'static str, detail: String },
    /// A filesystem failure, with the path it happened at.
    #[error("io error at {path}: {source}")]
    Io {
        /// Path being created, opened, or locked down.
        path: String,
        /// Underlying OS error.
        source: std::io::Error,
    },
}

impl SandboxError {
    /// Wire code the daemon should report for this failure.
    pub fn wire_code(&self) -> i64 {
        match self {
            Self::UnsupportedPlatform | Self::Unavailable { .. } => NOT_IMPLEMENTED_CODE,
            Self::Api { .. } | Self::Io { .. } => -32603,
        }
    }
}

#[cfg(windows)]
include!(concat!(env!("OUT_DIR"), "/sandbox_profile.rs"));

#[cfg(windows)]
mod tier1;

#[cfg(windows)]
pub use tier1::SandboxedChild;

#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "linux")]
pub use linux::SandboxedChild;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub use macos::SandboxedChild;

/// Off-platform placeholder: [`spawn_sandboxed`] always fails here, so this
/// is never constructed, but the symbol must exist for the shared signature.
#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
#[derive(Debug)]
pub struct SandboxedChild {
    _never: std::convert::Infallible,
}

/// Spawn `program` with `args` confined to Tier-1.
///
/// The child runs with the working directory inside `scope_dir`:
/// Windows creates it when missing and grants it explicitly to the sandbox
/// AppContainer SID; Linux/macOS canonicalize it and confine the child to
/// it (Landlock/Seatbelt) with network denied. On unsupported targets this
/// always returns [`SandboxError::UnsupportedPlatform`]; on supported
/// targets whose primitive is unavailable at runtime it returns
/// [`SandboxError::Unavailable`].
pub fn spawn_sandboxed(
    scope_dir: &std::path::Path,
    program: &std::ffi::OsStr,
    args: &[&std::ffi::OsStr],
) -> Result<SandboxedChild, SandboxError> {
    #[cfg(windows)]
    {
        tier1::spawn(scope_dir, program, args)
    }
    #[cfg(target_os = "linux")]
    {
        linux::spawn(scope_dir, program, args)
    }
    #[cfg(target_os = "macos")]
    {
        macos::spawn(scope_dir, program, args)
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = (scope_dir, program, args);
        Err(SandboxError::UnsupportedPlatform)
    }
}
