//! core-store — durable local state for the daemon.
//!
//! SQLite through `rusqlite` with the `bundled` feature: the engine is
//! compiled in, so there is no system dependency on any OS. Every open:
//!
//! * creates the parent directory with an owner-only ACL (Unix `0700`,
//!   Windows inheritance removed + grant to the current user only) and the
//!   database file as owner-only (Unix `0600`);
//! * sets `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON` and a
//!   5 s busy timeout, and refuses to continue when WAL does not engage;
//! * applies forward-only embedded migrations (`migrations/0001_init.sql`
//!   …), recorded in the `migrations` table, inside one transaction;
//! * runs `PRAGMA integrity_check` and fails closed on any other result
//!   than a single `ok` row.
//!
//! Schema v1 holds `sessions`, `messages`, `tool_calls`, `approvals`,
//! `capability_grants`, `audit_events` and `settings`. There are
//! deliberately NO secret columns anywhere: credentials stay in the vault.
//!
//! The database lives in the OS user-data directory under the provisional
//! token directory (see [`default_db_path`]).

#![deny(clippy::unwrap_used)]
#![deny(clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::time::Duration;

include!(concat!(env!("OUT_DIR"), "/brand_token.rs"));

#[cfg(not(any(unix, windows)))]
compile_error!(
    "core-store: owner-only ACL lockdown is implemented for unix and windows targets only"
);

const DB_FILE_NAME: &str = "store.db";
/// Current schema version (maximum migration version in `migrations/`).
pub const SCHEMA_VERSION: u32 = 1;
const BUSY_TIMEOUT: Duration = Duration::from_millis(5000);

const MIGRATIONS: &[(&str, u32, &str)] = &[(
    "0001_init.sql",
    1,
    include_str!("../migrations/0001_init.sql"),
)];

/// Errors from opening or using the store. Panics are a bug: every failure
/// is reported here instead.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// A SQLite failure, with the underlying error preserved.
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    /// A filesystem failure, with the path it happened at.
    #[error("io error at {path}: {source}")]
    Io {
        /// Path being created, opened, or locked down.
        path: String,
        /// Underlying OS error.
        source: std::io::Error,
    },
    /// `PRAGMA integrity_check` returned anything but a single `ok` row.
    #[error("integrity check failed: {0}")]
    Corrupt(String),
    /// `PRAGMA journal_mode=WAL` did not engage (got the reported mode).
    #[error("WAL journal mode unavailable (got {0})")]
    WalUnavailable(String),
    /// The OS user-data directory could not be resolved.
    #[error("config error: {0}")]
    Config(String),
}

/// Handle to the daemon's local store. One connection per handle; handles
/// are `Send` and each thread opens its own (WAL allows concurrent readers
/// with a single writer).
#[derive(Debug)]
pub struct Store {
    conn: rusqlite::Connection,
}

fn io_err(path: &Path, source: std::io::Error) -> StoreError {
    StoreError::Io {
        path: path.display().to_string(),
        source,
    }
}

fn pragmas(conn: &rusqlite::Connection) -> Result<(), StoreError> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; \
         PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    )?;
    let mode: String = conn.query_row("PRAGMA journal_mode", [], |row| row.get(0))?;
    if mode.to_lowercase() != "wal" {
        return Err(StoreError::WalUnavailable(mode));
    }
    let sync: i32 = conn.query_row("PRAGMA synchronous", [], |row| row.get(0))?;
    if sync != 1 {
        return Err(StoreError::Config(format!(
            "synchronous=NORMAL not in effect (got {sync})"
        )));
    }
    let fk: i32 = conn.query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;
    if fk != 1 {
        return Err(StoreError::Config(format!(
            "foreign_keys=ON not in effect (got {fk})"
        )));
    }
    Ok(())
}

fn integrity_rows(conn: &rusqlite::Connection) -> Result<Vec<String>, StoreError> {
    let mut stmt = conn.prepare("PRAGMA integrity_check")?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn check_integrity(conn: &rusqlite::Connection) -> Result<(), StoreError> {
    let rows = integrity_rows(conn)?;
    if rows.len() == 1 && rows[0].to_lowercase() == "ok" {
        Ok(())
    } else {
        Err(StoreError::Corrupt(rows.join("; ")))
    }
}

fn applied_versions(
    conn: &rusqlite::Connection,
) -> Result<std::collections::HashSet<u32>, StoreError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS migrations (
           version    INTEGER PRIMARY KEY,
           name       TEXT NOT NULL,
           applied_at TEXT NOT NULL
         );",
    )?;
    let mut stmt = conn.prepare("SELECT version FROM migrations")?;
    let rows = stmt
        .query_map([], |row| row.get::<_, u32>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows.into_iter().collect())
}

fn apply_migrations(conn: &mut rusqlite::Connection) -> Result<(), StoreError> {
    let applied = applied_versions(conn)?;
    let tx = conn.transaction()?;
    for (name, version, sql) in MIGRATIONS {
        if applied.contains(version) {
            continue;
        }
        tx.execute_batch(sql)?;
        tx.execute(
            "INSERT INTO migrations (version, name, applied_at) \
             VALUES (?1, ?2, datetime('now'))",
            rusqlite::params![version, name],
        )?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(unix)]
fn lock_down_dir(dir: &Path) -> Result<(), StoreError> {
    use std::os::unix::fs::PermissionsExt as _;
    let perm = std::fs::Permissions::from_mode(0o700);
    std::fs::set_permissions(dir, perm).map_err(|e| io_err(dir, e))
}

#[cfg(windows)]
fn lock_down_dir(dir: &Path) -> Result<(), StoreError> {
    lock_down_windows(dir, true)
}

#[cfg(unix)]
fn lock_down_file(path: &Path) -> Result<(), StoreError> {
    use std::os::unix::fs::PermissionsExt as _;
    let perm = std::fs::Permissions::from_mode(0o600);
    std::fs::set_permissions(path, perm).map_err(|e| io_err(path, e))
}

#[cfg(windows)]
fn lock_down_file(path: &Path) -> Result<(), StoreError> {
    lock_down_windows(path, false)
}

#[cfg(windows)]
fn current_username() -> Result<String, StoreError> {
    if let Ok(name) = std::env::var("USERNAME")
        && !name.trim().is_empty()
    {
        return Ok(name);
    }
    let out = std::process::Command::new("whoami")
        .output()
        .map_err(|e| StoreError::Io {
            path: "whoami".to_string(),
            source: e,
        })?;
    if !out.status.success() {
        return Err(StoreError::Config(
            "cannot determine current user for ACL lockdown".to_string(),
        ));
    }
    let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if name.is_empty() {
        return Err(StoreError::Config(
            "cannot determine current user for ACL lockdown".to_string(),
        ));
    }
    Ok(name)
}

/// Windows owner-only ACL: strip inheritance, grant the current user full
/// control (with object+container inherit on directories).
#[cfg(windows)]
fn lock_down_windows(path: &Path, is_dir: bool) -> Result<(), StoreError> {
    let user = current_username()?;
    let rights = if is_dir {
        format!("{user}:(OI)(CI)F")
    } else {
        format!("{user}:F")
    };
    let status = std::process::Command::new("icacls")
        .arg(path)
        .arg("/inheritance:r")
        .arg("/grant:r")
        .arg(rights)
        .output()
        .map_err(|e| io_err(path, e))?;
    if status.status.success() {
        Ok(())
    } else {
        let detail = String::from_utf8_lossy(&status.stderr).trim().to_string();
        Err(StoreError::Config(format!(
            "icacls lockdown failed for {}: {detail}",
            path.display()
        )))
    }
}

fn ensure_parent_dir(path: &Path) -> Result<(), StoreError> {
    let Some(dir) = path.parent() else {
        return Err(StoreError::Config(
            "database path has no parent directory".to_string(),
        ));
    };
    if dir.as_os_str().is_empty() {
        return Err(StoreError::Config(
            "database path has no parent directory".to_string(),
        ));
    }
    std::fs::create_dir_all(dir).map_err(|e| io_err(dir, e))?;
    lock_down_dir(dir)
}

impl Store {
    /// Open (creating if needed) the database at `path`, enforcing the
    /// owner-only ACL, pragmas, migrations, and integrity check.
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        ensure_parent_dir(path)?;
        #[cfg(unix)]
        {
            // Pre-create owner-only so the file is never born world-readable.
            use std::os::unix::fs::OpenOptionsExt as _;
            std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(false)
                .mode(0o600)
                .open(path)
                .map_err(|e| io_err(path, e))?;
        }
        let mut conn = rusqlite::Connection::open(path).map_err(StoreError::Sqlite)?;
        conn.busy_timeout(BUSY_TIMEOUT)
            .map_err(StoreError::Sqlite)?;
        pragmas(&conn)?;
        lock_down_file(path)?;
        check_integrity(&conn)?;
        apply_migrations(&mut conn)?;
        check_integrity(&conn)?;
        Ok(Self { conn })
    }

    /// OS user-data directory: `%APPDATA%` on Windows,
    /// `~/Library/Application Support` on macOS, `$XDG_DATA_HOME` (or
    /// `~/.local/share`) elsewhere. Read-only lookup; never creates anything.
    pub fn user_data_dir() -> Result<PathBuf, StoreError> {
        #[cfg(windows)]
        {
            std::env::var("APPDATA")
                .map(PathBuf::from)
                .map_err(|_| StoreError::Config("%APPDATA% is not set".to_string()))
        }
        #[cfg(target_os = "macos")]
        {
            let home = std::env::var("HOME")
                .map_err(|_| StoreError::Config("HOME is not set".to_string()))?;
            Ok(PathBuf::from(home).join("Library/Application Support"))
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            if let Ok(xdg) = std::env::var("XDG_DATA_HOME")
                && !xdg.trim().is_empty()
            {
                return Ok(PathBuf::from(xdg));
            }
            let home = std::env::var("HOME")
                .map_err(|_| StoreError::Config("HOME is not set".to_string()))?;
            Ok(PathBuf::from(home).join(".local/share"))
        }
    }

    /// Database path under an arbitrary base directory: used by
    /// [`Store::default_db_path`] and directly testable without env access.
    pub fn db_path_under(base: &Path) -> PathBuf {
        base.join(TOKEN_DIR).join(DB_FILE_NAME)
    }

    /// Default database path: OS user-data dir, provisional token dir,
    /// `store.db`. Creates nothing; [`Store::open`] creates on demand.
    pub fn default_db_path() -> Result<PathBuf, StoreError> {
        Ok(Self::db_path_under(&Self::user_data_dir()?))
    }

    /// Current schema version (maximum applied migration).
    pub fn schema_version(&self) -> Result<u32, StoreError> {
        let v: u32 = self.conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM migrations",
            [],
            |row| row.get(0),
        )?;
        Ok(v)
    }

    /// Read back a simple `PRAGMA name` value as text (diagnostics: engine
    /// posture assertions, schema dumps). Only bare pragma names are
    /// accepted; anything with arguments or separators is rejected.
    pub fn pragma(&self, name: &str) -> Result<String, StoreError> {
        if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Err(StoreError::Config(format!(
                "refusing non-trivial pragma: {name}"
            )));
        }
        let sql = format!("PRAGMA {name}");
        let v: rusqlite::types::Value = self
            .conn
            .query_row(&sql, [], |row| row.get(0))
            .map_err(StoreError::Sqlite)?;
        Ok(match v {
            rusqlite::types::Value::Null => "null".to_string(),
            rusqlite::types::Value::Integer(i) => i.to_string(),
            rusqlite::types::Value::Real(f) => f.to_string(),
            rusqlite::types::Value::Text(s) => s,
            rusqlite::types::Value::Blob(b) => format!("blob({} bytes)", b.len()),
        })
    }

    /// `true` when `PRAGMA integrity_check` returns a single `ok` row.
    pub fn integrity_ok(&self) -> Result<bool, StoreError> {
        Ok(integrity_rows(&self.conn)? == vec!["ok".to_string()])
    }

    /// Checkpoint the WAL with `TRUNCATE`. Returns
    /// `(busy, log_frames, checkpointed)`.
    pub fn checkpoint_truncate(&self) -> Result<(i32, i32, i32), StoreError> {
        let row = self
            .conn
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| {
                Ok((
                    r.get::<_, i32>(0)?,
                    r.get::<_, i32>(1)?,
                    r.get::<_, i32>(2)?,
                ))
            })?;
        Ok(row)
    }

    /// Record a session row.
    pub fn insert_session(&self, id: &str, title: &str, now: &str) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO sessions (id, title, status, created_at, updated_at) \
             VALUES (?1, ?2, 'active', ?3, ?3)",
            rusqlite::params![id, title, now],
        )?;
        Ok(())
    }

    /// Record a message row; returns its row id.
    pub fn insert_message(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
        now: &str,
    ) -> Result<i64, StoreError> {
        self.conn.execute(
            "INSERT INTO messages (session_id, role, content, created_at) \
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![session_id, role, content, now],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Record a tool-call row; returns its row id.
    pub fn insert_tool_call(
        &self,
        message_id: i64,
        name: &str,
        args_json: &str,
        status: &str,
        now: &str,
    ) -> Result<i64, StoreError> {
        self.conn.execute(
            "INSERT INTO tool_calls (message_id, name, args_json, status, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![message_id, name, args_json, status, now],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Record an approval decision for a tool call.
    pub fn insert_approval(
        &self,
        tool_call_id: i64,
        decision: &str,
        decided_by: &str,
        note: &str,
        now: &str,
    ) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO approvals (tool_call_id, decision, decided_by, note, decided_at) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![tool_call_id, decision, decided_by, note, now],
        )?;
        Ok(())
    }

    /// Grant a capability; `expires_at` is `None` for no expiry.
    pub fn grant_capability(
        &self,
        tool_name: &str,
        scope_json: &str,
        granted_at: &str,
        expires_at: Option<&str>,
    ) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO capability_grants (tool_name, scope_json, granted_at, expires_at) \
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![tool_name, scope_json, granted_at, expires_at],
        )?;
        Ok(())
    }

    /// Append an audit event.
    pub fn record_audit_event(
        &self,
        ts: &str,
        actor: &str,
        action: &str,
        detail_json: &str,
    ) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO audit_events (ts, actor, action, detail_json) \
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![ts, actor, action, detail_json],
        )?;
        Ok(())
    }

    /// Upsert a setting value (JSON text).
    pub fn set_setting(&self, key: &str, value_json: &str, now: &str) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO settings (key, value_json, updated_at) VALUES (?1, ?2, ?3) \
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, \
             updated_at = excluded.updated_at",
            rusqlite::params![key, value_json, now],
        )?;
        Ok(())
    }

    /// Read a setting value, if present.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>, StoreError> {
        use rusqlite::OptionalExtension as _;
        let hit: Option<String> = self
            .conn
            .query_row(
                "SELECT value_json FROM settings WHERE key = ?1",
                rusqlite::params![key],
                |row| row.get(0),
            )
            .optional()?;
        Ok(hit)
    }

    /// Count messages in a session.
    pub fn count_messages(&self, session_id: &str) -> Result<i64, StoreError> {
        let n: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE session_id = ?1",
            rusqlite::params![session_id],
            |row| row.get(0),
        )?;
        Ok(n)
    }

    /// Count tool calls by tool name.
    pub fn count_tool_calls_by_name(&self, name: &str) -> Result<i64, StoreError> {
        let n: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM tool_calls WHERE name = ?1",
            rusqlite::params![name],
            |row| row.get(0),
        )?;
        Ok(n)
    }

    /// The `CREATE` statement for a table or index, if present. Used for
    /// schema assertions and dumps.
    pub fn table_sql(&self, name: &str) -> Result<Option<String>, StoreError> {
        use rusqlite::OptionalExtension as _;
        let hit: Option<String> = self
            .conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type IN ('table', 'index') AND name = ?1",
                rusqlite::params![name],
                |row| row.get(0),
            )
            .optional()?;
        Ok(hit)
    }

    /// Index names present in the database (auto-indexes excluded — they
    /// have no SQL text of their own).
    pub fn index_names(&self) -> Result<Vec<String>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name",
        )?;
        let names = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(names)
    }

    /// Table names present in the database (for schema assertions).
    pub fn table_names(&self) -> Result<Vec<String>, StoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")?;
        let names = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(names)
    }
}
