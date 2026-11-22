//! core-store behaviour tests: fresh migrate, idempotent re-open, WAL
//! checkpoint, crash recovery, concurrent read/write, FK enforcement and
//! owner-only file permissions. Every test uses a fresh directory under the
//! OS temp dir; nothing touches the real user-data directory.

use core_store::Store;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const TS: &str = "2026-11-22T00:00:00Z";

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn fresh_dir(tag: &str) -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("core-store-{}-{n}-{tag}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn fresh_db(tag: &str) -> (PathBuf, PathBuf) {
    let dir = fresh_dir(tag);
    (dir.clone(), dir.join("test.db"))
}

fn scrub(dir: &Path) {
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn fresh_migrate_schema_and_pragmas() {
    let (dir, path) = fresh_db("fresh");
    let store = Store::open(&path).unwrap();

    assert_eq!(store.schema_version().unwrap(), core_store::SCHEMA_VERSION);
    let mut tables = store.table_names().unwrap();
    tables.sort();
    for want in [
        "approvals",
        "audit_events",
        "capability_grants",
        "messages",
        "migrations",
        "sessions",
        "settings",
        "tool_calls",
    ] {
        assert!(tables.contains(&want.to_string()), "missing table {want}");
    }
    // No secret columns anywhere in v1 (vault owns credentials).
    for table in store.table_names().unwrap() {
        let sql = store.table_sql(&table).unwrap().unwrap_or_default();
        let lower = sql.to_lowercase();
        for banned in ["token", "secret", "password", "api_key", "private_key"] {
            assert!(
                !lower.contains(banned),
                "schema must not carry secret columns ({banned})"
            );
        }
    }
    // Engine posture, read back through the store itself (a bare connection
    // would report compile-time defaults, not the enforced pragmas).
    assert_eq!(store.pragma("journal_mode").unwrap().to_lowercase(), "wal");
    assert_eq!(store.pragma("synchronous").unwrap(), "1");
    assert_eq!(store.pragma("foreign_keys").unwrap(), "1");
    assert!(store.integrity_ok().unwrap());
    scrub(&dir);
}

#[test]
fn idempotent_reopen_keeps_version_and_data() {
    let (dir, path) = fresh_db("reopen");
    {
        let store = Store::open(&path).unwrap();
        store
            .insert_session("sess-reopen-1", "reopen probe", TS)
            .unwrap();
        store
            .insert_message("sess-reopen-1", "user", "hello", TS)
            .unwrap();
        store
            .set_setting("theme", "{\"mode\":\"dark\"}", TS)
            .unwrap();
    }
    {
        let store = Store::open(&path).unwrap();
        assert_eq!(store.schema_version().unwrap(), core_store::SCHEMA_VERSION);
        assert_eq!(store.count_messages("sess-reopen-1").unwrap(), 1);
        assert_eq!(
            store.get_setting("theme").unwrap().as_deref(),
            Some("{\"mode\":\"dark\"}")
        );
        store
            .set_setting("theme", "{\"mode\":\"light\"}", TS)
            .unwrap();
    }
    {
        let store = Store::open(&path).unwrap();
        assert_eq!(store.schema_version().unwrap(), core_store::SCHEMA_VERSION);
        assert_eq!(store.count_messages("sess-reopen-1").unwrap(), 1);
        assert_eq!(
            store.get_setting("theme").unwrap().as_deref(),
            Some("{\"mode\":\"light\"}")
        );
        assert!(store.integrity_ok().unwrap());
    }
    scrub(&dir);
}

#[test]
fn wal_checkpoint_truncate() {
    let (dir, path) = fresh_db("checkpoint");
    let store = Store::open(&path).unwrap();
    store
        .insert_session("sess-ckpt-1", "checkpoint probe", TS)
        .unwrap();
    for i in 0..50 {
        store
            .insert_message("sess-ckpt-1", "user", &format!("msg-{i:04}"), TS)
            .unwrap();
    }
    let (busy, log_frames, checkpointed) = store.checkpoint_truncate().unwrap();
    println!("checkpoint: busy={busy} log_frames={log_frames} checkpointed={checkpointed}");
    assert_eq!(busy, 0);
    assert_eq!(log_frames, 0);
    let mut wal = path.as_os_str().to_owned();
    wal.push("-wal");
    let wal_path = PathBuf::from(wal);
    if wal_path.exists() {
        assert_eq!(wal_path.metadata().unwrap().len(), 0);
    }
    assert_eq!(store.count_messages("sess-ckpt-1").unwrap(), 50);
    scrub(&dir);
}

#[test]
fn crash_recovery_no_partial_rows() {
    let (dir, path) = fresh_db("crash");
    let seed_msg: i64;
    {
        let store = Store::open(&path).unwrap();
        store
            .insert_session("sess-crash-1", "crash probe", TS)
            .unwrap();
        seed_msg = store
            .insert_message("sess-crash-1", "user", "committed-before-crash", TS)
            .unwrap();
        store
            .insert_tool_call(seed_msg, "read-file", "{\"path\":\"x\"}", "succeeded", TS)
            .unwrap();
    }
    // Sudden death mid-write: a second connection opens a write txn, inserts
    // poison rows, then is forgotten — no commit, no rollback, no close.
    // That is exactly what an OS kill leaves behind: uncommitted WAL frames.
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; \
             PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
        )
        .unwrap();
        conn.execute_batch("BEGIN IMMEDIATE").unwrap();
        for i in 0..3 {
            conn.execute(
                "INSERT INTO messages (session_id, role, content, created_at) \
                 VALUES ('sess-crash-1', 'tool', 'poison', 'x')",
                [],
            )
            .unwrap();
            let _ = i;
        }
        conn.execute(
            "INSERT INTO tool_calls (message_id, name, args_json, status, created_at) \
             VALUES (?1, 'poison-probe', '{}', 'pending', 'x')",
            [seed_msg],
        )
        .unwrap();
        let visible: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tool_calls WHERE name = 'poison-probe'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        println!("crash-test: poison rows visible inside dead txn: {visible}");
        assert_eq!(visible, 1);
        std::mem::forget(conn);
        println!("crash-test: connection forgotten without commit (simulated kill)");
    }
    // Reopen through the real path: recovery must discard the dead txn.
    let store = Store::open(&path).unwrap();
    let ok = store.integrity_ok().unwrap();
    let poison = store.count_tool_calls_by_name("poison-probe").unwrap();
    let kept = store.count_messages("sess-crash-1").unwrap();
    println!("crash-test: integrity_ok={ok} poison_tool_calls={poison} kept_messages={kept}");
    assert!(ok);
    assert_eq!(poison, 0, "uncommitted rows must not survive");
    assert_eq!(kept, 1, "committed rows must survive");
    scrub(&dir);
}

#[test]
fn concurrent_read_write() {
    let (dir, path) = fresh_db("concurrent");
    {
        let store = Store::open(&path).unwrap();
        store
            .insert_session("sess-conc-1", "concurrency probe", TS)
            .unwrap();
    }
    let writer_path = path.clone();
    let writer = std::thread::spawn(move || -> Result<(), core_store::StoreError> {
        let store = Store::open(&writer_path)?;
        for i in 0..200 {
            store.insert_message("sess-conc-1", "user", &format!("msg-{i:04}"), TS)?;
        }
        Ok(())
    });
    let mut readers = Vec::new();
    for _ in 0..4 {
        let p = path.clone();
        readers.push(std::thread::spawn(
            move || -> Result<(), core_store::StoreError> {
                let store = Store::open(&p)?;
                for _ in 0..50 {
                    let _ = store.count_messages("sess-conc-1")?;
                    assert!(store.integrity_ok()?);
                }
                Ok(())
            },
        ));
    }
    writer.join().expect("writer panicked").unwrap();
    for r in readers {
        r.join().expect("reader panicked").unwrap();
    }
    let store = Store::open(&path).unwrap();
    assert_eq!(store.count_messages("sess-conc-1").unwrap(), 200);
    scrub(&dir);
}

#[test]
fn foreign_keys_enforced() {
    let (dir, path) = fresh_db("fk");
    let store = Store::open(&path).unwrap();
    let bad = store.insert_message("no-such-session", "user", "orphan", TS);
    assert!(bad.is_err(), "orphan message must violate the FK");
    let bad_call = store.insert_tool_call(999_999, "probe", "{}", "pending", TS);
    assert!(bad_call.is_err(), "orphan tool call must violate the FK");
    scrub(&dir);
}

#[test]
fn owner_only_permissions() {
    let (dir, path) = fresh_db("acl");
    let _store = Store::open(&path).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let dir_mode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
        let file_mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(dir_mode, 0o700, "data dir must be owner-only");
        assert_eq!(file_mode, 0o600, "database file must be owner-only");
    }
    #[cfg(windows)]
    {
        let user = std::env::var("USERNAME").unwrap_or_default();
        assert!(
            !user.trim().is_empty(),
            "USERNAME must be set on Windows CI"
        );
        let out = std::process::Command::new("icacls")
            .arg(&path)
            .output()
            .unwrap();
        assert!(out.status.success());
        let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
        assert!(
            text.contains(&user.to_lowercase()),
            "database ACL must grant the current user"
        );
    }
    scrub(&dir);
}

#[test]
fn default_db_path_shape() {
    let base = fresh_dir("shape");
    let db = Store::db_path_under(&base);
    assert_eq!(db.file_name().unwrap(), "store.db");
    assert_eq!(
        db.parent().unwrap().file_name().unwrap().to_str().unwrap(),
        core_store::TOKEN_DIR
    );
    let def = Store::default_db_path().unwrap();
    assert!(def.is_absolute());
    assert_eq!(def.file_name().unwrap(), "store.db");
    scrub(&base);
}
