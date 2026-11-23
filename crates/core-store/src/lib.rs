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
//! `capability_grants`, `audit_events` and `settings`. Schema v2 extends
//! `audit_events` with the append-only hash chain (`seq`, `event`,
//! `payload_json`, `payload_hash`, `prev_hash`, `hash`; see [`audit`]).
//! There are deliberately NO secret columns anywhere: credentials stay in
//! the vault.
//!
//! The database lives in the OS user-data directory under the provisional
//! token directory (see [`default_db_path`]).

#![deny(clippy::unwrap_used)]
#![deny(clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::time::Duration;

pub mod audit;

include!(concat!(env!("OUT_DIR"), "/brand_token.rs"));

#[cfg(not(any(unix, windows)))]
compile_error!(
    "core-store: owner-only ACL lockdown is implemented for unix and windows targets only"
);

const DB_FILE_NAME: &str = "store.db";
/// Current schema version (maximum migration version in `migrations/`).
pub const SCHEMA_VERSION: u32 = 2;
const BUSY_TIMEOUT: Duration = Duration::from_millis(5000);

const MIGRATIONS: &[(&str, u32, &str)] = &[
    (
        "0001_init.sql",
        1,
        include_str!("../migrations/0001_init.sql"),
    ),
    (
        "0002_audit_chain.sql",
        2,
        include_str!("../migrations/0002_audit_chain.sql"),
    ),
];

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
    /// The audit hash chain could not be built or read.
    #[error("audit chain error: {0}")]
    Chain(String),
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

/// Backfill the v2 audit chain over rows written before the chain
/// existed. Runs inside `Store::open` after migrations: rows whose `hash`
/// is empty are hashed in `id` order with `seq = id`, continuing the
/// previous hashed prefix (or genesis). Legacy timestamps (epoch seconds)
/// are normalized to UTC RFC3339 in place; unparseable legacy payloads
/// are wrapped, never dropped. Fails the open fail-closed when a legacy
/// timestamp cannot be represented (delete the local store file to reset;
/// see the retention guide).
fn backfill_audit_chain(conn: &rusqlite::Connection) -> Result<(), StoreError> {
    let pending: i64 = conn.query_row(
        "SELECT COUNT(*) FROM audit_events WHERE hash IS NULL OR hash = ''",
        [],
        |row| row.get(0),
    )?;
    if pending == 0 {
        return Ok(());
    }
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result: Result<(), StoreError> = (|| {
        use rusqlite::OptionalExtension as _;
        let last: Option<String> = conn
            .query_row(
                "SELECT hash FROM audit_events \
                 WHERE hash IS NOT NULL AND hash != '' ORDER BY seq DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()?;
        let mut prev_hash = last.unwrap_or_else(|| audit::GENESIS_PREV_HASH.to_string());
        let mut stmt = conn.prepare(
            "SELECT id, ts, actor, action, detail_json FROM audit_events \
             WHERE hash IS NULL OR hash = '' ORDER BY id",
        )?;
        let rows: Vec<(i64, String, String, String, String)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        for (id, ts, actor, action, detail) in rows {
            let ts_utc = audit::normalize_ts(&ts)
                .map_err(|e| StoreError::Chain(format!("legacy audit ts unusable: {e}")))?;
            let payload_json = audit::coerce_legacy_payload(&detail);
            let payload_hash = audit::payload_hash(&payload_json)
                .map_err(|e| StoreError::Chain(format!("legacy audit payload unusable: {e}")))?;
            let hash = audit::event_hash(id, &ts_utc, &actor, &action, &payload_hash, &prev_hash);
            conn.execute(
                "UPDATE audit_events SET seq = ?1, ts = ?2, event = ?3, \
                 payload_json = ?4, payload_hash = ?5, prev_hash = ?6, hash = ?7 \
                 WHERE id = ?8",
                rusqlite::params![
                    id,
                    ts_utc,
                    action,
                    payload_json,
                    payload_hash,
                    prev_hash,
                    hash,
                    id
                ],
            )?;
            prev_hash = hash;
        }
        Ok(())
    })();
    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT")?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
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

/// A persisted capability grant row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Grant {
    /// Row id; referenced by issued tokens as `grant_id`.
    pub id: i64,
    /// Tool (method) the grant covers.
    pub tool: String,
    /// Scope document, JSON text (`{"prefix": "<path>"}`).
    pub scope_json: String,
    /// Grant time, epoch seconds as text.
    pub granted_at: String,
    /// Expiry, epoch seconds as text, or `None` for no expiry.
    pub expires_at: Option<String>,
}

/// An audit event row: one link of the append-only hash chain (see
/// [`audit`]). `action` mirrors `event` and `detail` mirrors
/// `payload_json`; both pairs are written in sync for readers that predate
/// the chain.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuditEvent {
    /// Row id.
    pub id: i64,
    /// Monotonic chain sequence (strictly +1 per row).
    pub seq: i64,
    /// Event time, UTC RFC3339 (`YYYY-MM-DDTHH:MM:SSZ`).
    pub ts: String,
    /// Who acted (token id when presented, else a fixed label).
    pub actor: String,
    /// What happened (`capability.granted`, `capability.denied`, ...).
    /// Pre-chain alias of [`AuditEvent::event`].
    pub action: String,
    /// What happened (`capability.granted`, `capability.denied`, ...).
    pub event: String,
    /// Machine-readable detail, JSON text. Pre-chain alias of
    /// [`AuditEvent::payload_json`].
    pub detail: String,
    /// Machine-readable detail, JSON text.
    pub payload_json: String,
    /// Lowercase hex SHA-256 of the canonical payload.
    pub payload_hash: String,
    /// Lowercase hex hash of the previous row (genesis for the first).
    pub prev_hash: String,
    /// Lowercase hex hash of this row.
    pub hash: String,
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
        backfill_audit_chain(&conn)?;
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

    /// Append an audit event to the hash chain.
    ///
    /// The write is serialized with `BEGIN IMMEDIATE`: the sequence number
    /// and previous hash are read and the row inserted atomically, so
    /// concurrent writers from separate handles cannot fork the chain
    /// (the loser blocks on the busy timeout, then retries against the new
    /// head). `ts` accepts epoch seconds (the historical writer format) or
    /// UTC RFC3339; `detail_json` must be valid JSON. Failures roll back
    /// and report [`StoreError`]; nothing partial is left behind.
    pub fn record_audit_event(
        &self,
        ts: &str,
        actor: &str,
        action: &str,
        detail_json: &str,
    ) -> Result<(), StoreError> {
        let ts_utc =
            audit::normalize_ts(ts).map_err(|e| StoreError::Chain(format!("audit ts: {e}")))?;
        let payload_hash = audit::payload_hash(detail_json)
            .map_err(|e| StoreError::Chain(format!("audit payload: {e}")))?;
        self.conn.execute_batch("BEGIN IMMEDIATE")?;
        let result: Result<(), StoreError> = (|| {
            use rusqlite::OptionalExtension as _;
            let head: Option<(i64, String)> = self
                .conn
                .query_row(
                    "SELECT seq, hash FROM audit_events ORDER BY seq DESC LIMIT 1",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let (seq, prev_hash) = match head {
                Some((s, h)) => (s + 1, h),
                None => (1, audit::GENESIS_PREV_HASH.to_string()),
            };
            let hash = audit::event_hash(seq, &ts_utc, actor, action, &payload_hash, &prev_hash);
            self.conn.execute(
                "INSERT INTO audit_events \
                 (seq, ts, actor, action, event, detail_json, payload_json, \
                  payload_hash, prev_hash, hash) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                rusqlite::params![
                    seq,
                    ts_utc,
                    actor,
                    action,
                    action,
                    detail_json,
                    detail_json,
                    payload_hash,
                    prev_hash,
                    hash
                ],
            )?;
            Ok(())
        })();
        match result {
            Ok(()) => {
                self.conn.execute_batch("COMMIT")?;
                Ok(())
            }
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }

    /// Verify the audit hash chain from genesis. Pure read: recomputes
    /// every payload hash and link, checks sequencing is exactly +1.
    /// Tampering reports `ok: false` with the first broken `seq`; a broken
    /// chain never errors, only reports.
    pub fn verify_audit_chain(&self) -> Result<audit::VerifyReport, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT seq, ts, actor, event, payload_json, payload_hash, prev_hash, hash \
             FROM audit_events ORDER BY seq",
        )?;
        let rows: Vec<audit::ChainRow> = stmt
            .query_map([], |row| {
                Ok(audit::ChainRow {
                    seq: row.get(0)?,
                    ts: row.get(1)?,
                    actor: row.get(2)?,
                    event: row.get(3)?,
                    payload_json: row.get(4)?,
                    payload_hash: row.get(5)?,
                    prev_hash: row.get(6)?,
                    hash: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(audit::verify_rows(&rows))
    }

    /// Export the chain as JSONL, one object per line in `seq` order.
    /// Envelope keys are exactly [`audit::EXPORT_KEYS`]; payloads carry
    /// only [`audit::ALLOWED_PAYLOAD_KEYS`]. Free-text fields and key
    /// material can never appear: they are dropped, not redacted.
    pub fn export_audit_jsonl(&self, limit: i64) -> Result<String, StoreError> {
        if limit < 1 {
            return Err(StoreError::Config("export limit must be >= 1".to_string()));
        }
        let mut stmt = self.conn.prepare(
            "SELECT seq, ts, actor, event, payload_json, payload_hash, prev_hash, hash \
             FROM audit_events ORDER BY seq LIMIT ?1",
        )?;
        let rows: Vec<audit::ChainRow> = stmt
            .query_map(rusqlite::params![limit], |row| {
                Ok(audit::ChainRow {
                    seq: row.get(0)?,
                    ts: row.get(1)?,
                    actor: row.get(2)?,
                    event: row.get(3)?,
                    payload_json: row.get(4)?,
                    payload_hash: row.get(5)?,
                    prev_hash: row.get(6)?,
                    hash: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut out = String::new();
        for row in &rows {
            out.push_str(&audit::export_line(row));
            out.push('\n');
        }
        Ok(out)
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

    /// Narrow (or refresh) a grant's scope and expiry in place. The grant
    /// id is stable, so outstanding wider tokens deny via scope-narrowing.
    pub fn update_grant(
        &self,
        grant_id: i64,
        scope_json: &str,
        granted_at: &str,
        expires_at: &str,
    ) -> Result<(), StoreError> {
        self.conn.execute(
            "UPDATE capability_grants SET scope_json = ?1, granted_at = ?2, \
             expires_at = ?3 WHERE id = ?4",
            rusqlite::params![scope_json, granted_at, expires_at, grant_id],
        )?;
        Ok(())
    }

    /// Delete a capability grant row by id. Returns rows removed (0 or 1).
    pub fn delete_grant(&self, grant_id: i64) -> Result<i64, StoreError> {
        let n = self.conn.execute(
            "DELETE FROM capability_grants WHERE id = ?1",
            rusqlite::params![grant_id],
        )?;
        Ok(n as i64)
    }

    /// Look up a capability grant row by id.
    pub fn grant_by_id(&self, grant_id: i64) -> Result<Option<Grant>, StoreError> {
        use rusqlite::OptionalExtension as _;
        let hit: Option<Grant> = self
            .conn
            .query_row(
                "SELECT id, tool_name, scope_json, granted_at, expires_at \
                 FROM capability_grants WHERE id = ?1",
                rusqlite::params![grant_id],
                |row| {
                    Ok(Grant {
                        id: row.get(0)?,
                        tool: row.get(1)?,
                        scope_json: row.get(2)?,
                        granted_at: row.get(3)?,
                        expires_at: row.get(4)?,
                    })
                },
            )
            .optional()?;
        Ok(hit)
    }

    /// Look up a capability grant row by tool name.
    pub fn grant_by_tool(&self, tool: &str) -> Result<Option<Grant>, StoreError> {
        use rusqlite::OptionalExtension as _;
        let hit: Option<Grant> = self
            .conn
            .query_row(
                "SELECT id, tool_name, scope_json, granted_at, expires_at \
                 FROM capability_grants WHERE tool_name = ?1",
                rusqlite::params![tool],
                |row| {
                    Ok(Grant {
                        id: row.get(0)?,
                        tool: row.get(1)?,
                        scope_json: row.get(2)?,
                        granted_at: row.get(3)?,
                        expires_at: row.get(4)?,
                    })
                },
            )
            .optional()?;
        Ok(hit)
    }

    /// All capability grant rows, ordered by id.
    pub fn list_grants(&self) -> Result<Vec<Grant>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, tool_name, scope_json, granted_at, expires_at \
             FROM capability_grants ORDER BY id",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Grant {
                    id: row.get(0)?,
                    tool: row.get(1)?,
                    scope_json: row.get(2)?,
                    granted_at: row.get(3)?,
                    expires_at: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Recent audit events, newest last, up to `limit` rows, in chain
    /// order. `action`/`detail` mirror `event`/`payload_json`.
    pub fn audit_events(&self, limit: i64) -> Result<Vec<AuditEvent>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, seq, ts, actor, action, event, detail_json, payload_json, \
                    payload_hash, prev_hash, hash \
             FROM audit_events ORDER BY seq LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(rusqlite::params![limit], |row| {
                Ok(AuditEvent {
                    id: row.get(0)?,
                    seq: row.get(1)?,
                    ts: row.get(2)?,
                    actor: row.get(3)?,
                    action: row.get(4)?,
                    event: row.get(5)?,
                    detail: row.get(6)?,
                    payload_json: row.get(7)?,
                    payload_hash: row.get(8)?,
                    prev_hash: row.get(9)?,
                    hash: row.get(10)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
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
