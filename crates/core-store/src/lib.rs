//! core-store — durable local state for the daemon.
//!
//! SQLite-backed in later prompts; this stub fixes the crate boundary so
//! dependents can name it now.

/// Handle to the daemon's local store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Store {
    /// Filesystem path of the backing database file.
    pub path: String,
}

impl Store {
    /// Bind a store handle to `path` without touching the filesystem.
    pub fn at(path: &str) -> Self {
        Self {
            path: path.to_string(),
        }
    }
}
