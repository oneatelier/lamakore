//! Append-only hash-chained audit log.
//!
//! Every audit row carries `seq`, `ts` (UTC RFC3339, seconds precision),
//! `actor`, `event`, `payload_hash`, `prev_hash`, and `hash`, where
//!
//! * `payload_hash = SHA256(canonical_json(payload))`
//! * `hash = SHA256("audit-v1\n{seq}\n{ts}\n{actor}\n{event}\n{payload_hash}\n{prev_hash}")`
//! * the first row's `prev_hash` is the fixed genesis [`GENESIS_PREV_HASH`].
//!
//! `canonical_json` sorts object keys recursively and emits compact JSON,
//! so the same logical payload hashes identically regardless of key order
//! (see the determinism STOP-gate test). Hashing is total over the event
//! universe: any UTF-8 JSON payload and any event name hash; there is no
//! event type that cannot be hashed. Appends reject non-JSON payloads and
//! non-UTC timestamps fail-closed before the transaction commits.
//!
//! Verification ([`verify_rows`]) recomputes every link and reports the
//! first broken sequence number. Export ([`filter_payload`],
//! [`EXPORT_KEYS`], [`ALLOWED_PAYLOAD_KEYS`]) emits JSONL whose envelope
//! keys are fixed and whose payload keys are allowlisted: free-text fields
//! (reasons, notes) and key material never leave the device through export.

use serde_json::Value;
use sha2::{Digest, Sha256};

/// Previous-hash of the first row in a chain. Fixed for all time.
pub const GENESIS_PREV_HASH: &str =
    "0000000000000000000000000000000000000000000000000000000000000000";

/// Domain separator for the event hash. Bumped only with a schema version.
const HASH_DOMAIN: &str = "audit-v1";

/// Exact envelope keys of one exported JSONL line, in no significant order.
pub const EXPORT_KEYS: &[&str] = &[
    "seq",
    "ts",
    "actor",
    "event",
    "payload",
    "payload_hash",
    "prev_hash",
    "hash",
];

/// Payload keys that may appear in an export. Everything else is dropped.
/// Free-text fields (`reason` bodies except fixed slugs, `note`), token or
/// key material, and identity fields are never in this list.
pub const ALLOWED_PAYLOAD_KEYS: &[&str] = &[
    "decision",
    "expires_at",
    "grant_id",
    "method",
    "reason",
    "request_id",
    "scope",
    "tool",
];

/// One chain row, as read back for verification or export.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChainRow {
    /// Monotonic sequence, 1-based after a purge, strictly +1 per row.
    pub seq: i64,
    /// UTC timestamp, `YYYY-MM-DDTHH:MM:SSZ`.
    pub ts: String,
    /// Who acted (token id when presented, else a fixed label).
    pub actor: String,
    /// What happened (`capability.granted`, `capability.denied`, ...).
    pub event: String,
    /// Machine-readable detail, JSON text.
    pub payload_json: String,
    /// Lowercase hex SHA-256 of the canonical payload.
    pub payload_hash: String,
    /// Lowercase hex hash of the previous row (genesis for the first).
    pub prev_hash: String,
    /// Lowercase hex hash of this row.
    pub hash: String,
}

/// Outcome of [`verify_rows`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifyReport {
    /// Rows examined.
    pub events: u64,
    /// True only when every link recomputes and sequencing is exact.
    pub ok: bool,
    /// First broken sequence number, if any.
    pub bad_seq: Option<i64>,
    /// Machine-readable break reason (`seq-gap`, `ts-invalid`,
    /// `payload-invalid`, `payload-hash-mismatch`, `prev-hash-mismatch`,
    /// `hash-mismatch`), if any.
    pub bad_reason: Option<String>,
    /// Hash of the last row, if any rows exist.
    pub head_hash: Option<String>,
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(char::from_digit(u32::from(*b >> 4), 16).unwrap_or('?'));
        out.push(char::from_digit(u32::from(*b & 0x0f), 16).unwrap_or('?'));
    }
    out
}

/// SHA-256 of UTF-8 text, lowercase hex.
pub fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hex_encode(&hasher.finalize())
}

/// Deterministic JSON: object keys sorted recursively, compact, no
/// whitespace. Scalars use standard `serde_json` rendering. The same
/// logical value always renders identically, however its keys were ordered
/// when constructed or parsed.
pub fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {
            serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
        }
        Value::Array(items) => {
            let parts: Vec<String> = items.iter().map(canonical_json).collect();
            format!("[{}]", parts.join(","))
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let parts: Vec<String> = keys
                .iter()
                .map(|k| {
                    let rendered_key =
                        serde_json::to_string(k).unwrap_or_else(|_| "\"\"".to_string());
                    format!("{rendered_key}:{}", canonical_json(&map[k.as_str()]))
                })
                .collect();
            format!("{{{}}}", parts.join(","))
        }
    }
}

/// Hash a JSON payload document. Fails closed on non-JSON input.
pub fn payload_hash(payload_json: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(payload_json)
        .map_err(|e| format!("payload is not valid JSON: {e}"))?;
    Ok(sha256_hex(&canonical_json(&value)))
}

/// Hash one chain link. Pure and total: every input hashes.
pub fn event_hash(
    seq: i64,
    ts: &str,
    actor: &str,
    event: &str,
    payload_hash: &str,
    prev_hash: &str,
) -> String {
    sha256_hex(&format!(
        "{HASH_DOMAIN}\n{seq}\n{ts}\n{actor}\n{event}\n{payload_hash}\n{prev_hash}"
    ))
}

/// Normalize a timestamp to UTC RFC3339 (`YYYY-MM-DDTHH:MM:SSZ`).
/// Accepts all-digit epoch seconds (the historical writer format) or an
/// already-canonical RFC3339 string. Anything else fails closed.
pub fn normalize_ts(ts: &str) -> Result<String, String> {
    if !ts.is_empty() && ts.bytes().all(|b| b.is_ascii_digit()) {
        let secs: u64 = ts
            .parse()
            .map_err(|_| format!("timestamp out of range: {ts}"))?;
        return Ok(epoch_to_rfc3339(secs));
    }
    if is_valid_rfc3339(ts) {
        return Ok(ts.to_string());
    }
    Err(format!(
        "timestamp is not UTC RFC3339 or epoch seconds: {ts}"
    ))
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

/// Strict `YYYY-MM-DDTHH:MM:SSZ` check with real calendar ranges.
pub fn is_valid_rfc3339(ts: &str) -> bool {
    let b = ts.as_bytes();
    if b.len() != 20 {
        return false;
    }
    for (i, byte) in b.iter().enumerate() {
        let digit = matches!(i, 0..=3 | 5 | 6 | 8 | 9 | 11 | 12 | 14 | 15 | 17 | 18);
        if digit && !byte.is_ascii_digit() {
            return false;
        }
    }
    if b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
        || b[19] != b'Z'
    {
        return false;
    }
    let num = |from: usize, to: usize| -> u32 { ts[from..to].parse().unwrap_or(999) };
    let year = num(0, 4) as i32;
    let month = num(5, 7);
    let day = num(8, 10);
    let hour = num(11, 13);
    let minute = num(14, 16);
    let second = num(17, 19);
    if year < 1970 || !(1..=12).contains(&month) {
        return false;
    }
    if day < 1 || day > days_in_month(year, month) {
        return false;
    }
    hour < 24 && minute < 60 && second < 60
}

/// Epoch seconds to `YYYY-MM-DDTHH:MM:SSZ` (Howard Hinnant's civil
/// algorithm; no date dependency, total over the u64 range).
pub fn epoch_to_rfc3339(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    year += i64::from(month <= 2);
    let hour = (rem / 3_600) as u32;
    let minute = ((rem % 3_600) / 60) as u32;
    let second = (rem % 60) as u32;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// Preserve unparseable legacy payloads without breaking the chain: wrap
/// the raw text under a fixed key. Deterministic and auditable.
pub fn coerce_legacy_payload(detail: &str) -> String {
    match serde_json::from_str::<Value>(detail) {
        Ok(_) => detail.to_string(),
        Err(_) => serde_json::json!({"_legacy_raw": detail}).to_string(),
    }
}

/// Recompute and relink every row. Pure: no I/O, total over row vectors.
/// The first row must chain to genesis; every later row must continue the
/// previous hash with `seq` exactly +1. The first break wins. `events`
/// always reports how many rows were examined.
pub fn verify_rows(rows: &[ChainRow]) -> VerifyReport {
    let total = rows.len() as u64;
    let mut prev = GENESIS_PREV_HASH.to_string();
    let mut expected_seq: Option<i64> = None;
    for row in rows {
        if let Some(want) = expected_seq
            && row.seq != want
        {
            return broken(total, prev, row.seq, "seq-gap");
        }
        if normalize_ts(&row.ts).map_or(true, |n| n != row.ts) {
            return broken(total, prev, row.seq, "ts-invalid");
        }
        let recomputed_payload = match payload_hash(&row.payload_json) {
            Ok(h) => h,
            Err(_) => return broken(total, prev, row.seq, "payload-invalid"),
        };
        if recomputed_payload != row.payload_hash {
            return broken(total, prev, row.seq, "payload-hash-mismatch");
        }
        if row.prev_hash != prev {
            return broken(total, prev, row.seq, "prev-hash-mismatch");
        }
        let recomputed = event_hash(
            row.seq,
            &row.ts,
            &row.actor,
            &row.event,
            &row.payload_hash,
            &row.prev_hash,
        );
        if recomputed != row.hash {
            return broken(total, prev, row.seq, "hash-mismatch");
        }
        prev = row.hash.clone();
        expected_seq = Some(row.seq + 1);
    }
    VerifyReport {
        events: total,
        ok: true,
        bad_seq: None,
        bad_reason: None,
        head_hash: rows.last().map(|r| r.hash.clone()),
    }
}

fn broken(events: u64, head: String, seq: i64, reason: &str) -> VerifyReport {
    VerifyReport {
        events,
        ok: false,
        bad_seq: Some(seq),
        bad_reason: Some(reason.to_string()),
        head_hash: Some(head),
    }
}

/// Drop every payload key outside [`ALLOWED_PAYLOAD_KEYS`]. Non-object
/// payloads become `{}`. Total: no input can smuggle a key through.
pub fn filter_payload(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for key in ALLOWED_PAYLOAD_KEYS {
                if let Some(v) = map.get(*key) {
                    out.insert((*key).to_string(), v.clone());
                }
            }
            Value::Object(out)
        }
        _ => Value::Object(serde_json::Map::new()),
    }
}

/// One exported JSONL line. Envelope keys are exactly [`EXPORT_KEYS`];
/// `payload` holds the allowlisted subset.
pub fn export_line(row: &ChainRow) -> String {
    let payload: Value = serde_json::from_str(&row.payload_json)
        .map(|v: Value| filter_payload(&v))
        .unwrap_or_else(|_| Value::Object(serde_json::Map::new()));
    serde_json::json!({
        "seq": row.seq,
        "ts": row.ts,
        "actor": row.actor,
        "event": row.event,
        "payload": payload,
        "payload_hash": row.payload_hash,
        "prev_hash": row.prev_hash,
        "hash": row.hash,
    })
    .to_string()
}
