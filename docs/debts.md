# Debt ledger (pre-alpha, local-only)

Short, honest, dated. Every entry names the risk, the current mitigation,
and the fix condition. Nothing here blocks the Batch 2 acceptance — each
item is either covered by CI as authority or has an explicit revisit date.
A debt is closed only by the fix landing, never by prose.

## D1 — TS7 `any`-check weakening (fix-by: Batch 3 start)

- **Status (P025, CLOSED 2026-11-24):** the token-stream check built on
  `typescript/unstable/ast` is gone. `scripts/detect-placeholders.mjs`
  now walks the TypeScript 5 compiler AST (`typescript5` alias,
  `npm:typescript@5.9.3`, pinned exact) for `AnyKeyword` nodes, so
  comments (trivia) and strings (literal tokens) cannot match by
  construction and every type position is covered — annotations,
  generics, unions, arrays, `as`/`satisfies`, angle assertions, return
  types, aliases. The only exemption is a `deferred:#NNN` marker on the
  SAME line that resolves to an open issue (root-aware registry lookup;
  fail closed otherwise). `ci.yml` runs
  `node scripts/detect-placeholders.mjs --any-only` as a blocking step
  (named "explicit-any AST gate"). Evidence: 5/5
  `tests/explicit-any/explicit-any.spec.ts` green (fail fixture: 5 hits
  in bad.ts at lines 1, 2, 3, 3, 4 plus 1 in bad.tsx; pass fixture with
  comment/string/identifier-only `any` clean, deferred-exempt +
  deferred-unresolvable controls), `--any-only` clean on the full tree (zero explicit `any`
  exists), `pnpm test` 34/34. Word rules stay advisory-only: 4
  pre-existing hits (two genuine React input-attribute names no honest
  reword can remove — the attribute name itself trips the naive rule —
  plus two prose uses in Rust docs) — recorded, not wired.
  This entry is closed; the advisory word-rule gap is noted in
  report-P025 and is NOT a debt (no silent any-rule remains to mask).

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

## D5 — Server-side DCO check (CLOSED 2026-11-24, P025)

- **Status (P025, CLOSED):** the gap is implemented, not just recorded.
  `scripts/hygiene/check-dco.mjs` requires a
  `Signed-off-by: <author-name> <author-email>` trailer matching the
  commit author on every non-merge commit in `--base..--head` (merge
  commits skipped — they record a merge, not authorship; bad ranges fail
  closed). `hygiene.yml` runs it on every `pull_request` as a blocking
  step, actor-gated (`github.actor != 'dependabot[bot]'`, the same
  pattern as the author check — never commit-string gated), with
  `fetch-depth: 0` on checkout so the full PR range resolves. Push
  events are not re-checked: linear rebase-merges land exactly the gated
  PR commits. Evidence: 5/5 `tests/hygiene/dco.spec.ts` green (unsigned
  fails, signed passes, mismatched trailer fails, merge-skip + bad-range
  controls, workflow-gating assertion); the last 5 real commits verify
  `dco: clean` (the `git commit -s` convention was already practice —
  16 of the last 20 carry trailers — the gate now enforces it).
  Client-side practice (CONTRIBUTING + `commit -s`) is unchanged.

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
  fallback; bounded retries at both layers (concurrent creates;
  whole-sequence respawn on first-spawn FILE_NOT_FOUND).
  Verified: profile auto-registers on a wiped host, real enforcement
  shows zero SKIP lines with verbatim denials, e2e fs-tools 10/10 green.
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
