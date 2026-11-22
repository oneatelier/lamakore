# ADR-006 — Wire Protocol v1 (`wire/1`)

- **Status:** Accepted
- **Date:** 2026-11-22
- **Scope:** Daemon ↔ shell IPC for PROJECT ONE
- **Inputs:** `crates/core-protocol/src/wire.rs`, `crates/core-protocol/src/events.rs`,
  `crates/cored/src/server.rs`, `docs/reports/report-P008.md`

## 1. Context

Renderer is untrusted, the daemon is trusted, and tools are sandboxed
(ADR-000). The boundary needs a contract that is local-only, versioned,
authenticated per session, and lossless under backpressure.

## 2. Decision — `wire/1`

- **Transport:** Unix domain socket (macOS/Linux), Windows named pipe.
  NO TCP listener anywhere — verified by `netstat` in report-P008.
- **Framing:** 4-byte big-endian length + UTF-8 JSON. 8 MiB cap; larger
  frames are protocol errors.
- **Handshake:** first frame MUST be
  `{protocol:"wire/1", version:1, build, token}`. The daemon checks all
  four against its own build and the per-session token (passed via
  `PONE_WIRE_TOKEN`, never logged). Any mismatch is refused and the
  connection is closed; the client treats refusal as fatal.
- **Methods:** JSON-RPC 2.0. v1 exposes exactly `system.health` and
  `system.info` (brand constants from P003). Unknown methods get -32601;
  both sides enforce the allowlist.
- **Events:** daemon → client notifications with per-connection sequence
  numbers; the client acks cumulatively. Bounded in-flight buffer with a
  **10,000-event ring that spills to disk** rather than dropping silently;
  spill counts surface in `system.health` (and degrade the shell status).
- **Lifecycle:** single instance (bind wins; a live peer means a second
  daemon exits), graceful shutdown on SIGTERM/Ctrl-C, and exit on parent
  death (stdin EOF — the parent holds the pipe open and never writes).

## 3. Consequences

- Method growth requires a protocol-minor bump proposal, never silent
  extension — the allowlist is the audit surface.
- The spill file is diagnostics, not storage: operators monitor it, the
  daemon replays nothing automatically.
- Dev builds share the build tag `0.0.0-dev`, so the token is the real
  per-session discriminator in dev; releases discriminate on all four
  fields.

## 4. Reversal triggers

- If a method needs streaming request bodies, revisit framing (chunked
  frames) in a `wire/1.1` proposal.
- If named-pipe ACLs prove insufficient on locked-down Windows tenants,
  add a token-binding review — still no TCP.
