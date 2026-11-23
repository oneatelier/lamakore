# Report — wire/1 approval.request deck card (P007 tokens, AA, keyboard-first)

- **Date (local):** 2026-11-22 IST
- **Scope:** `approval.request {tool, scope, reason, ttl}` → deck card; decision returns signed, persisted to `approvals`; edit may only narrow scope.
- **Visual gate:** **LIVE — passed.** 5 states × 2 themes screenshot-verified + programmatic checks.
- **STOP honored:** every state has a keyboard path (verified below); deny is exactly as prominent as approve.

## 1. What was built

**UI (P007 tokens only, no raw hex):**
- `packages/ui/src/approvals/approval.ts` — pure state machine: `pending / approved / denied / expired / edited`, `scopeCovers` / `scopeNarrowsOrEqual` mirroring `cored::capability`, countdown `tick()` → `expired` (DEFAULT DENY), `keyActionFor()` keyboard map, `KEYBOARD_PATHS` for the STOP gate.
- `packages/ui/src/approvals/ApprovalCard.tsx` — `role="dialog"` card on `var(--surface-raised)`; tool/scope/reason grid; `role="timer"` countdown + `progressbar`; Approve/Deny share one `ACTION_BTN` style object (`flex:1`, 44px, 600) — identical metrics by construction; Edit-scope (E) input narrows only; terminal states show result + Dismiss (Enter/Escape, autofocus); global keydown: A/D/E on pending/edited, Enter/Escape/Space dismiss on terminal.
- `apps/desktop/src/renderer/screens/Shell.tsx` — connected canvas now hosts the live card (`useDemoApproval`, 500ms tick).

**Daemon (wire/1):**
- `core-protocol/src/wire.rs` — `ALLOWED_METHODS` += `approval.request / approval.decide / approval.status` (+ allowlist test).
- `cored/src/capability.rs` — `PendingRequest` += `reason`, `expires_at`; `request_approval()` (`apr-` ids, `approval.requested` audit); `decide_approval()` (expiry first → DEFAULT DENY persisted `deny` + `approval.expired`; deny → `deny` + `approval.denied`; approve → `grant()` mint + persist `allow` / `allow_once` when narrowed + `approval.approved` / `approval.edited`); `approval_status()`; `persist_approval()` hosts an ephemeral `approval-<tool>-<now>` session/message/tool_call triple per decision (satisfies `approvals.tool_call_id` FK + `UNIQUE`); wire arms for all three methods in `handle_capability`; `ISSUANCE_METHODS` extended so the deck needs no token. 4 new `mock-keyring` tests: approve→authorize ok, deny→no token, timeout→expired, edit-narrow ok / widen refused.
- `cored/src/server.rs` — no change needed (issuance-plane dispatch already routes via `ISSUANCE_METHODS`).

## 2. Keyboard paths (STOP gate — all 5 pass)

| State | Keys |
|---|---|
| pending | `a → approve`, `d → deny`, `e → edit-scope` |
| edited | `a → approve (narrowed)`, `d → deny`, `e → narrow further` |
| approved | `Enter/Escape → dismiss` |
| denied | `Enter/Escape → dismiss` |
| expired | `Enter/Escape → dismiss (default deny)` |

Unit test `STOP: every state has a keyboard path` asserts each mapping programmatically; verify harness asserts E focuses the scope input and Enter dismisses a terminal card.

## 3. Tests

### Deck unit tests (8 passed)

`node --test tests/ui/approval.spec.ts`:

```text
✔ pending carries request fields and countdown
✔ approved: A key approves and decision is signed-shaped
✔ denied: D key denies and maps to CAPABILITY_DENIED
✔ expired: countdown hits zero -> DEFAULT DENY
✔ edited: E narrows scope, widening rejected
✔ scope helpers mirror Rust boundary rules
✔ STOP: every state has a keyboard path
✔ no dark patterns: deny exactly as prominent as approve
ℹ tests 8 · pass 8 · fail 0
```

### Contrast (24/24 pass, WCAG 2.2 AA)

`node --test tests/ui/approval-contrast.spec.ts` (selected lines; full log in CI):

```text
ok brass-void text-primary on surface-raised (card title/body) = 14.50:1, needs 4.5:1
ok brass-void text-secondary on surface-raised (field labels) = 7.64:1, needs 4.5:1
ok brass-void text-primary on surface-overlay (approve button label) = 13.02:1, needs 4.5:1
ok brass-void text-primary on surface-overlay (deny button label (equal)) = 13.02:1, needs 4.5:1
ok parchment text-primary on surface-overlay (deny button label (equal)) = 16.86:1, needs 4.5:1
ok brass-void signal-danger on surface-raised (deny alert text) = 4.85:1, needs 4.5:1
...
✔ approval card pairs pass WCAG 2.2 AA
```

Field labels use `text-secondary` (not `text-disabled`) so body copy holds 4.5:1 in both themes.

### Playwright flow (`tests/ui/approval-verify.mjs` — all pass)

```text
ok flow approve -> tool proceeds — FLOW: approved -> tool proceeds (token mock-ok)
ok flow deny -> CAPABILITY_DENIED — FLOW: denied -> CAPABILITY_DENIED (-32001)
ok flow timeout -> deny — FLOW: timeout -> deny (DEFAULT DENY)
ok expired copy names default deny — Countdown reached zero — default deny applied and audited.
ok keyboard E focuses scope edit — true
ok keyboard Enter dismisses terminal — FLOW: dismissed via keyboard
ok keyboard Tab reaches approve/deny/edit — BUTTON:approve | BUTTON:deny | BUTTON:edit | ...
ok focus ring visible (2px) — {"width":"2px","color":"rgb(217, 180, 99)"}
ok deny exactly as prominent as approve — {"aw":274,"dw":274,"ah":44,"dh":44,"af":"600","df":"600"}
approval-verify: all deck checks passed
```

Screenshots (10, committed evidence):

- `artifacts/approval-pending-brass-void.png`, `approval-approved-brass-void.png`, `approval-denied-brass-void.png`, `approval-expired-brass-void.png`, `approval-edited-brass-void.png`
- `artifacts/approval-pending-parchment.png`, `approval-approved-parchment.png`, `approval-denied-parchment.png`, `approval-expired-parchment.png`, `approval-edited-parchment.png`

Each state asserted via `data-status` + `data-testid="approval-card-<state>"` before capture; zero page errors in all 10.

### Rust

- `cargo fmt -p cored -p core-protocol -- --check`: clean.
- `cargo check -p core-protocol --target x86_64-pc-windows-gnu`: clean (6 allowlist tests intact + 3 new).
- `cored --features mock-keyring` full `cargo test`: **not run owner-local** — this host has no MSVC linker and no GNU C compiler (`gcc.exe` missing, so `libsqlite3-sys` build script cannot run). The new code parses (fmt clean) and the 4 new tests are written to the existing `mock_tests` harness; **CI (MSVC) is the authority** and must show `16 + 4 = 20 passed` for `cargo test -p cored --features mock-keyring`.
- `npx tsc --noEmit`, `no-raw-hex`, `no-hardcoded-brand`, existing `contrast.spec.ts` + `tests/hygiene + branding` (22 passed): all green owner-local.

## 4. Deviations

- **D1 — approvals persist via ephemeral tool_call hosts** (`approval-<tool>-<now>` session/message/tool_call per decision) instead of a schema migration: the v1 `approvals.tool_call_id UNIQUE … REFERENCES tool_calls` FK is honored with zero migration risk; decisions are queryable via `audit_events` (`approval.requested/approved/denied/expired/edited`) + `approvals` (`allow` / `allow_once` for narrowed / `deny`).
- **D2 — token TTL = approval TTL** (`expires_at = requested_at + ttl_secs` doubles as decision deadline and grant TTL): one knob for the card countdown and the minted token; a separate token-TTL field can land without breaking the wire shape.
- **D3 — Shell shows a live demo card** on the connected canvas (local state, same component the daemon drives): proves deck wiring without faking a daemon round-trip.
- **D4 — footer hint copy uses `text-secondary`** (not `text-disabled`): the keyboard hint is meaningful text and must hold 4.5:1; disabled remains for truly inactive controls only.
