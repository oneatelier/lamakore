//! Audit-chain behaviour tests: verify ok, byte-flip tamper detection,
//! concurrent append serialization, export schema conformance, hashing
//! determinism (STOP gate), committed vector cross-check, purge-to-genesis.
//! Every test uses a fresh directory under the OS temp dir; nothing touches
//! the real user-data directory.

use core_store::Store;
use core_store::audit;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn fresh_dir(tag: &str) -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("core-audit-{n}-{tag}-{}", std::process::id()));
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

const TS0: &str = "2026-11-22T00:00:00Z";
const TS1: &str = "2026-11-22T00:00:01Z";
const TS2: &str = "2026-11-22T00:00:02Z";

#[test]
fn chain_verify_ok() {
    let (dir, path) = fresh_db("verify-ok");
    let store = Store::open(&path).unwrap();
    assert_eq!(store.schema_version().unwrap(), core_store::SCHEMA_VERSION);
    store
        .record_audit_event(
            TS0,
            "wire-client",
            "capability.requested",
            r#"{"request_id":"req-1","tool":"tool.exec"}"#,
        )
        .unwrap();
    store
        .record_audit_event(
            TS1,
            "wire-client",
            "capability.granted",
            r#"{"grant_id":7,"tool":"tool.exec"}"#,
        )
        .unwrap();
    store
        .record_audit_event(
            TS2,
            "deck",
            "approval.denied",
            r#"{"request_id":"apr-9","tool":"tool.exec"}"#,
        )
        .unwrap();
    let rows = store.audit_events(100).unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0].seq, 1);
    assert_eq!(rows[1].seq, 2);
    assert_eq!(rows[2].seq, 3);
    // Legacy aliases stay in sync with chain fields.
    assert_eq!(rows[0].action, rows[0].event);
    assert_eq!(rows[0].detail, rows[0].payload_json);
    for r in &rows {
        assert!(r.ts.ends_with('Z'), "ts must be UTC RFC3339");
        assert_eq!(r.ts.len(), 20);
    }
    let report = store.verify_audit_chain().unwrap();
    assert!(report.ok, "fresh chain must verify");
    assert_eq!(report.events, 3);
    assert_eq!(report.bad_seq, None);
    assert_eq!(report.head_hash, Some(rows[2].hash.clone()));
    println!(
        "verify-ok: events={} head={}",
        report.events,
        report.head_hash.unwrap()
    );
    scrub(&dir);
}

#[test]
fn byte_flip_payload_tamper_detected() {
    let (dir, path) = fresh_db("tamper-payload");
    {
        let store = Store::open(&path).unwrap();
        store
            .record_audit_event(
                TS0,
                "wire-client",
                "capability.requested",
                r#"{"request_id":"req-1","tool":"tool.exec"}"#,
            )
            .unwrap();
        store
            .record_audit_event(
                TS1,
                "wire-client",
                "capability.granted",
                r#"{"grant_id":7,"tool":"tool.exec"}"#,
            )
            .unwrap();
        store
            .record_audit_event(
                TS2,
                "deck",
                "approval.denied",
                r#"{"request_id":"apr-9","tool":"tool.exec"}"#,
            )
            .unwrap();
        assert!(store.verify_audit_chain().unwrap().ok);
    }
    // One byte flip in row 2's payload, bypassing the API (direct SQL).
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute(
            "UPDATE audit_events SET payload_json = ?1 WHERE seq = 2",
            ["{\"grant_id\":7,\"tool\":\"tool.exed\"}"],
        )
        .unwrap();
    }
    let store = Store::open(&path).unwrap();
    let report = store.verify_audit_chain().unwrap();
    assert!(!report.ok, "flipped payload must fail verify");
    assert_eq!(report.bad_seq, Some(2));
    assert_eq!(report.bad_reason.as_deref(), Some("payload-hash-mismatch"));
    println!(
        "tamper-payload: bad_seq={:?} reason={:?}",
        report.bad_seq, report.bad_reason
    );
    scrub(&dir);
}

#[test]
fn byte_flip_hash_tamper_detected() {
    let (dir, path) = fresh_db("tamper-hash");
    let head_before: String;
    {
        let store = Store::open(&path).unwrap();
        store
            .record_audit_event(
                TS0,
                "wire-client",
                "capability.requested",
                r#"{"request_id":"req-1","tool":"tool.exec"}"#,
            )
            .unwrap();
        store
            .record_audit_event(
                TS1,
                "wire-client",
                "capability.granted",
                r#"{"grant_id":7,"tool":"tool.exec"}"#,
            )
            .unwrap();
        head_before = store.verify_audit_chain().unwrap().head_hash.unwrap();
    }
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        let hash: String = conn
            .query_row("SELECT hash FROM audit_events WHERE seq = 2", [], |r| {
                r.get(0)
            })
            .unwrap();
        let mut flipped = hash.clone();
        let first = flipped.remove(0);
        flipped.insert(0, if first == '0' { '1' } else { '0' });
        assert_ne!(flipped, hash);
        conn.execute("UPDATE audit_events SET hash = ?1 WHERE seq = 2", [flipped])
            .unwrap();
    }
    let store = Store::open(&path).unwrap();
    let report = store.verify_audit_chain().unwrap();
    assert!(!report.ok, "flipped hash must fail verify");
    assert_eq!(report.bad_seq, Some(2));
    assert_eq!(report.bad_reason.as_deref(), Some("hash-mismatch"));
    // The reported head is the last good hash before the break.
    assert_ne!(report.head_hash.unwrap(), head_before);
    scrub(&dir);
}

#[test]
fn concurrent_appends_serialized() {
    let (dir, path) = fresh_db("concurrent");
    {
        let store = Store::open(&path).unwrap();
        store
            .record_audit_event(
                TS0,
                "wire-client",
                "capability.requested",
                r#"{"tool":"tool.exec"}"#,
            )
            .unwrap();
    }
    let mut handles = Vec::new();
    for t in 0..8 {
        let p = path.clone();
        handles.push(std::thread::spawn(
            move || -> Result<(), core_store::StoreError> {
                let store = Store::open(&p)?;
                for k in 0..25 {
                    let payload =
                        serde_json::json!({"n": k, "t": t, "tool": "tool.exec"}).to_string();
                    store.record_audit_event(TS1, "wire-client", "capability.granted", &payload)?;
                }
                Ok(())
            },
        ));
    }
    for h in handles {
        h.join().expect("writer panicked").unwrap();
    }
    let store = Store::open(&path).unwrap();
    let report = store.verify_audit_chain().unwrap();
    assert!(report.ok, "concurrent appends must still verify");
    assert_eq!(report.events, 201);
    let rows = store.audit_events(10_000).unwrap();
    assert_eq!(rows.len(), 201);
    for (i, row) in rows.iter().enumerate() {
        assert_eq!(row.seq, i as i64 + 1, "seq must be contiguous 1..=N");
    }
    println!(
        "concurrent: events={} contiguous seq 1..=201",
        report.events
    );
    scrub(&dir);
}

#[test]
fn export_schema_conformance() {
    let (dir, path) = fresh_db("export");
    let store = Store::open(&path).unwrap();
    store
        .record_audit_event(
            TS0,
            "wire-client",
            "capability.requested",
            r#"{"request_id":"req-1","tool":"tool.exec"}"#,
        )
        .unwrap();
    // Hostile payload: secret keys, free text, PII-shaped values. None of
    // it may survive the allowlist.
    store
        .record_audit_event(
            TS1,
            "deck",
            "capability.denied",
            r#"{"method":"tool.exec","reason":"expired","token":"SHOULD-NEVER-EXPORT","secret":"nope","note":"Call name@example.com","tool":"tool.exec"}"#,
        )
        .unwrap();
    store
        .record_audit_event(
            TS2,
            "wire-client",
            "capability.granted",
            r#"{"grant_id":7,"tool":"tool.exec","password":"hunter2"}"#,
        )
        .unwrap();
    let jsonl = store.export_audit_jsonl(100).unwrap();
    let lines: Vec<&str> = jsonl.lines().collect();
    assert_eq!(lines.len(), 3);
    let banned = [
        "token",
        "secret",
        "password",
        "api_key",
        "private_key",
        "authorization",
        "bearer",
        "cookie",
        "email",
        "@",
    ];
    for (i, line) in lines.iter().enumerate() {
        let v: serde_json::Value = serde_json::from_str(line).unwrap();
        let obj = v.as_object().unwrap();
        let mut keys: Vec<&str> = obj.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "actor",
                "event",
                "hash",
                "payload",
                "payload_hash",
                "prev_hash",
                "seq",
                "ts"
            ],
            "line {i} envelope keys must match exactly"
        );
        assert_eq!(obj["seq"], (i as u64 + 1) as u64);
        let payload = obj["payload"].as_object().unwrap();
        for key in payload.keys() {
            assert!(
                audit::ALLOWED_PAYLOAD_KEYS.contains(&key.as_str()),
                "payload key {key} is not allowlisted"
            );
        }
        let lower = line.to_lowercase();
        for b in banned {
            assert!(
                !lower.contains(b),
                "export line {i} leaks banned material ({b})"
            );
        }
    }
    // The hostile line kept only its allowlisted keys.
    let hostile: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
    assert_eq!(
        hostile["payload"],
        serde_json::json!({"method": "tool.exec", "reason": "expired", "tool": "tool.exec"})
    );
    println!("export: 3 lines, envelope exact, hostile keys dropped");
    scrub(&dir);
}

/// STOP gate: every known event type must hash deterministically. A single
/// unhashable event type fails the suite loudly instead of shipping a hole.
#[test]
fn determinism_stop_gate() {
    const ALL_KNOWN_EVENTS: &[&str] = &[
        "capability.requested",
        "capability.granted",
        "capability.revoked",
        "capability.denied",
        "approval.requested",
        "approval.approved",
        "approval.denied",
        "approval.expired",
        "approval.edited",
    ];
    for event in ALL_KNOWN_EVENTS {
        let a = serde_json::json!({"tool": "tool.exec", "request_id": "req-1", "scope": "/proj"});
        let b = serde_json::json!({"scope": "/proj", "request_id": "req-1", "tool": "tool.exec"});
        let ha = audit::payload_hash(&a.to_string())
            .unwrap_or_else(|e| panic!("{event} unhashable: {e}"));
        let hb = audit::payload_hash(&b.to_string())
            .unwrap_or_else(|e| panic!("{event} unhashable: {e}"));
        assert_eq!(ha, hb, "{event}: key order must not affect the hash");
        let h1 = audit::event_hash(1, TS0, "wire-client", event, &ha, audit::GENESIS_PREV_HASH);
        let h2 = audit::event_hash(1, TS0, "wire-client", event, &ha, audit::GENESIS_PREV_HASH);
        assert_eq!(h1, h2, "{event}: same input must hash identically");
        println!("deterministic: {event} ok");
    }
}

#[test]
fn committed_vectors_cross_check() {
    let text = include_str!("../../../artifacts/audit-test-vectors.json");
    let doc: serde_json::Value = serde_json::from_str(text).unwrap();
    assert_eq!(doc["genesis"], audit::GENESIS_PREV_HASH);
    assert_eq!(doc["domain"], "audit-v1");
    // Epoch/UTC conversion agrees with the platform clock rendering.
    assert_eq!(
        audit::epoch_to_rfc3339(doc["epoch_example"]["epoch_secs"].as_u64().unwrap()),
        doc["epoch_example"]["rfc3339"].as_str().unwrap()
    );
    let vectors = doc["vectors"].as_array().unwrap();
    assert!(!vectors.is_empty());
    for v in vectors {
        let payload_str = serde_json::to_string(&v["payload"]).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&payload_str).unwrap();
        assert_eq!(audit::canonical_json(&parsed), v["canonical_payload"]);
        assert_eq!(
            audit::payload_hash(&payload_str).unwrap(),
            v["payload_hash"]
        );
        let recomputed = audit::event_hash(
            v["seq"].as_i64().unwrap(),
            v["ts"].as_str().unwrap(),
            v["actor"].as_str().unwrap(),
            v["event"].as_str().unwrap(),
            v["payload_hash"].as_str().unwrap(),
            v["prev_hash"].as_str().unwrap(),
        );
        assert_eq!(recomputed, v["hash"]);
    }
    // The tamper case really does change the payload hash.
    let tamper = &doc["tamper_case"];
    let flipped_str = serde_json::to_string(&tamper["flipped_payload"]).unwrap();
    assert_eq!(
        audit::payload_hash(&flipped_str).unwrap(),
        tamper["flipped_payload_hash"]
    );
    assert_ne!(tamper["flipped_payload_hash"], vectors[1]["payload_hash"]);
    println!("vectors: {} records cross-checked", vectors.len());
}

#[test]
fn purge_resets_to_genesis() {
    let (dir, path) = fresh_db("purge");
    {
        let store = Store::open(&path).unwrap();
        for ts in [TS0, TS1, TS2] {
            store
                .record_audit_event(
                    ts,
                    "wire-client",
                    "capability.granted",
                    r#"{"tool":"tool.exec"}"#,
                )
                .unwrap();
        }
        assert_eq!(store.verify_audit_chain().unwrap().events, 3);
    }
    // Purge (retention doc): quit, delete the store file, reopen.
    std::fs::remove_file(&path).unwrap();
    let store = Store::open(&path).unwrap();
    let report = store.verify_audit_chain().unwrap();
    assert!(report.ok);
    assert_eq!(report.events, 0);
    assert_eq!(report.head_hash, None);
    store
        .record_audit_event(
            TS0,
            "wire-client",
            "capability.requested",
            r#"{"tool":"tool.exec"}"#,
        )
        .unwrap();
    let rows = store.audit_events(10).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].seq, 1);
    assert_eq!(rows[0].prev_hash, audit::GENESIS_PREV_HASH);
    assert!(store.verify_audit_chain().unwrap().ok);
    println!("purge: fresh chain restarts at seq 1 from genesis");
    scrub(&dir);
}
