# Debt ledger (pre-alpha, local-only)

Short, honest, dated. Every entry names the risk, the current mitigation,
and the fix condition. Nothing here blocks the Batch 2 acceptance — each
item is either covered by CI as authority or has an explicit revisit date.
A debt is closed only by the fix landing, never by prose.

## D1 — TS7 `any`-check weakening (fix-by: Batch 3 start)

- **Risk:** the P006 unfinished-surface scanner detects explicit `any`
  in TS through the TypeScript 7 scanner API (`require('typescript/unstable/ast')`,
  unstable module). As of 2026-11-24 the rule is empirically weakened: a
  probe file containing `export const x: any = 1;` still reports a clean
  result (verified both inside and outside the repo root),
  so an explicit `any` can land undetected. Compounding gaps: the script
  is wired into no CI workflow (advisory-only; `ci.yml` runs `pnpm lint`
  = brand + raw-hex + fonts, `hygiene.yml` runs the six scanners), and the
  word-rules still fire (2 pre-existing unfinished-filler hits — see the
  Batch 2 report), which masks the silent any-rule.
- **Mitigation today:** `tsc --strict` (`pnpm typecheck`) still rejects
  implicit-any errors; reviewers treat explicit `any` as a finding. No
  explicit `any` exists in the tree (verified by scan + review).
- **Fix-by Batch 3 start:** repair the scanner loop against the pinned
  TS 7 API (or replace with a stable-API check, e.g. `ts-morph`-free
  compiler-API walk), add a positive fixture test (must flag `any`),
  and wire the script into `ci.yml` so weakening fails the build.

## D2 — Local VS Build Tools parity (owner action; CI already covers MSVC)

- **Risk:** this host has no MSVC linker (VS Build Tools blocked since
  P001, still unelevated). Local Rust builds ride the pinned GNU target
  plus user-local zig shims, and the `cored` test binary now exceeds the
  shim's command-line length — full `cargo test -p cored` links only on
  CI (`windows-latest`, real MSVC), which is the authority for the cored
  suite (established P013/P014 era, still true in Batch 2).
- **Mitigation today:** local `cargo check` / `clippy` / `build` plus the
  smaller test binaries (`vault`, `core-store`, `core-protocol`,
  `core-sandbox` tier1, all green locally); CI runs the whole matrix.
- **Fix (owner action, no date pressure):** install the VS Build Tools
  C++ workload elevated on the owner host; until then the GNU+shim path
  stays local-only and CI stays the merge authority. No repo change.

## D3 — Sandbox tier-2 roadmap (future batch)

- **Scope:** Tier-1 is done and enforced — Windows Job Objects +
  AppContainer zero-capability profile (P013), Linux Landlock FS +
  seccomp-bpf `AF_INET/AF_INET6` deny (P014), macOS Seatbelt profile
  (P014, owner-local follow-up recorded there). The README's
  "hypervisor tiers later" and the P014 fork-server hardening note
  (child `pre_exec` may allocate; harden via fork-server in P017
  dispatch work) are the tier-2 seed.
- **Status:** not started by design; Tier-1 carries the current threat
  boundary (ADR-000). No silent cut: the tier-2 items stay listed here
  until a batch picks them up.

## D4 — SQLCipher at-rest decision (revisit 2027-03-01)

- **Decision:** deferred, per `docs/adr/ADR-007-vault-sqlcipher-deferral.md`.
  Provider keys live only in the OS keychain (vault, report-vault.md); `store.db`
  holds owner-only non-secret operational data under filesystem ACLs.
- **Revisit triggers** (ADR-007 §5): sync/backup/multi-device, PII or
  credentials entering the store, unusable owner-only ACLs, or a
  customer/auditor at-rest mandate — or the calendar date, whichever is
  first. This entry closes only when the ADR is superseded.

## D5 — Server-side DCO check candidate (not implemented)

- **Gap:** DCO sign-off (`git commit -s`, CONTRIBUTING) is enforced
  client-side today (`.githooks/pre-commit` + hygiene author-identity
  checks on the PR head and push). No GitHub-side required check
  verifies `Signed-off-by` trailers on the landed commits, so a bypassed
  hook (`--no-verify`, another client) could land unsigned history.
- **Candidate:** a server-side workflow (e.g. a required `dco.yml` that
  fails the check suite when any commit in the PR/push range lacks a
  valid trailer). Candidate only — no implementation, no date. Recorded
  here so the gap is explicit, not assumed covered.

## D6 — macOS Tier-1 honesty: disjoin or fix (Linux is the enforcement authority)

- **Status (P019-R, closed 2026-11-24):** P014 left macOS Seatbelt red on CI
  while Linux carried the POSIX gate. The post-lint-fix matrix re-ran all
  three OSes; macOS still failed on two evidence-form issues (empty child
  stderr on a proven denial; transient `/bin/true` ENOENT in the speed
  probe), so the honest disjunction landed: kernel-text OR shell-status
  evidence for write-deny (hard fail otherwise), retry-then-SKIP for the
  probe (mid-run failures still panic). Run `45345517434` is green on all
  three OSes with the disjunction lines in the log. Linux remains the
  Tier-1 POSIX enforcement authority.
- **Fix:** landed and verified green — this entry is closed.

## D7 — AppContainer profile auto-registration was dead code (fixed 2026-11-24)

- **Risk:** `appcontainer_sid()` derived first and created on failure —
  but the derive API succeeds even for never-created profiles (verified
  with a gibberish name: it returns a computed SID), so the create path
  never ran. On any host without a pre-registered Tier-1 profile, EVERY
  sandboxed spawn then failed at `CreateProcessW` with FILE_NOT_FOUND:
  tier1 tests SKIPPED honestly via the AppContainer-unavailable arm, and
  the daemon's fs tools returned tool-error. Consequence: CI windows
  "tier1 4 passed" was 4 skips — vacuous enforcement evidence from CI
  (owner-local runs carried the real gate). The pre-rename profile on
  this host masked it locally until the token flip changed the profile
  name.
- **Mitigation applied:** create-first with ALREADY_EXISTS → derive
  fallback plus bounded retries for concurrent first-time creates.
  Verified: missing-profile probe fails closed, real enforcement shows
  zero SKIP lines with verbatim denials, e2e fs-tools 10/10 green.
- **Fix:** landed with the GIF #1/#2 re-records; closes D7 once CI is
  green on the fix (then CI windows tier1 enforces for real).

- **Status (P019-R, closed 2026-11-24):** P014 left macOS Seatbelt red on CI
  while Linux carried the POSIX gate. The post-lint-fix matrix re-ran all
  three OSes; macOS still failed on two evidence-form issues (empty child
  stderr on a proven denial; transient `/bin/true` ENOENT in the speed
  probe), so the honest disjunction landed: kernel-text OR shell-status
  evidence for write-deny (hard fail otherwise), retry-then-SKIP for the
  probe (mid-run failures still panic). Run `45345517434` is green on all
  three OSes with the disjunction lines in the log. Linux remains the
  Tier-1 POSIX enforcement authority.
- **Fix:** landed and verified green — this entry is closed.
