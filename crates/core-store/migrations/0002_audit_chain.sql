-- 0002_audit_chain.sql — hash-chained audit log (forward-only).
--
-- Extends `audit_events` with the append-only chain fields:
-- seq, event, payload_json, payload_hash, prev_hash, hash.
-- Legacy columns (`action`, `detail_json`) are kept and written in sync
-- with (`event`, `payload_json`) so existing readers keep working.
-- Backfill of the chain (hash computation) happens in Rust inside
-- `Store::open` (see `backfill_audit_chain`); SQL cannot hash.
-- No UNIQUE index on seq: legacy rows would collide at the 0 default.
-- Append-only is enforced by `verify_audit_chain`, which rejects gaps,
-- duplicates, and broken links.

ALTER TABLE audit_events ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audit_events ADD COLUMN event TEXT NOT NULL DEFAULT '';
ALTER TABLE audit_events ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE audit_events ADD COLUMN payload_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE audit_events ADD COLUMN prev_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE audit_events ADD COLUMN hash TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_audit_seq ON audit_events(seq);
