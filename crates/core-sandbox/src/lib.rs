//! core-sandbox — OS sandbox drivers for tool execution.
//!
//! Driver order follows the P000 host profile: always-present primitives
//! first (Job Objects, AppContainer), hypervisor-backed isolation only as
//! an opt-in tier. See ADR-000, consequence 3.
//!
//! Tier-1 (Windows) confines one spawned tool process with a Job Object
//! (`KILL_ON_JOB_CLOSE`, no breakaway, UI restrictions) plus an AppContainer
//! security context with ZERO capabilities (no network, no broad filesystem)
//! and an explicit DACL grant of the declared scope directory to the
//! AppContainer SID. [`spawn_sandboxed`] is what P017 dispatches through.
//!
//! Non-Windows platforms return [`SandboxError::UnsupportedPlatform`]; the
//! daemon maps that to the NOT_IMPLEMENTED wire error.

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
}

/// Drivers verified present on the reference host, strongest first.
pub fn default_drivers() -> Vec<Driver> {
    vec![Driver::JobObjects, Driver::AppContainer, Driver::Lpac]
}

/// Wire error code the daemon reports when sandboxing is unavailable here.
pub const NOT_IMPLEMENTED_CODE: i64 = -32002;

/// Every sandbox failure. Panics are a bug: every failure is reported here.
#[derive(Debug, thiserror::Error)]
pub enum SandboxError {
    /// This platform has no Tier-1 driver (anything but Windows).
    #[error("sandbox not implemented on this platform")]
    UnsupportedPlatform,
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
            Self::UnsupportedPlatform => NOT_IMPLEMENTED_CODE,
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

/// Off-Windows placeholder: [`spawn_sandboxed`] always fails here, so this
/// is never constructed, but the symbol must exist for the shared signature.
#[cfg(not(windows))]
#[derive(Debug)]
pub struct SandboxedChild {
    _never: std::convert::Infallible,
}

/// Spawn `program` with `args` confined to Tier-1.
///
/// The child runs with the working directory inside `scope_dir`, which is
/// created when missing and receives an explicit DACL grant to the sandbox
/// AppContainer SID. On non-Windows targets this always returns
/// [`SandboxError::UnsupportedPlatform`].
pub fn spawn_sandboxed(
    scope_dir: &std::path::Path,
    program: &std::ffi::OsStr,
    args: &[&std::ffi::OsStr],
) -> Result<SandboxedChild, SandboxError> {
    #[cfg(windows)]
    {
        tier1::spawn(scope_dir, program, args)
    }
    #[cfg(not(windows))]
    {
        let _ = (scope_dir, program, args);
        Err(SandboxError::UnsupportedPlatform)
    }
}
