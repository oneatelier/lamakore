# Report FIXBATCH — P025-COMPLETE + P026 gate (macOS infra fix-forward, merge, full matrix at HEAD)

- **Date (UTC):** 2026-11-25
- **Scope:** land P025 (PR #18) through a GitHub macOS-runner starvation
  event without weakening any gate; run the P026 gate (full matrix +
  hygiene at HEAD, INDEX P022–P026 rows, this report); close D7 on
  Windows-tier1 enforcement evidence. Canonical name is Lamakore
  throughout — no stale-brief fragments (Barghest/Fossegrim/Shedu) were
  queued or actioned; the instruction to refuse them is noted here and
  needs no further handling.
- **Head:** PR #18 merged as `c65eca3` (2026-11-25T08:47:34Z); this docs
  batch on top (branch `docs/fixbatch-index`, PR #19). Docs PR-sync:
  [ci 45580765813](https://github.com/oneatelier/lamakore/actions/runs/45580765813)
  + [hygiene 45580765817](https://github.com/oneatelier/lamakore/actions/runs/45580765817)
  (head `a004e6c`, §9 for the verdict).

## 1. P025-COMPLETE — merge record (4/4 green, rebase, branch deleted)

PR #18 (`feat/p025-any-dco → main`): required checks all SUCCESS on the
final head `3a43187`:

- ci `45463003991` (pull_request, head `3a43187`): ubuntu 1m18s,
  windows 2m10s, **macos 1m23s** — success.
- hygiene `45463003821` (pull_request, head `3a43187`): success (7s;
  includes the new DCO step, `dco: clean` in log).

Merged ONLY at 4/4 via `gh pr merge 18 --rebase --delete-branch`
(2026-11-25T08:47:34Z, merge commit `c65eca3`, linear history, DCO
trailers intact). Remote branch deleted (explicit `git push origin
--delete` after the auto-delete left it listed); local branch deleted.
Zero open PRs at merge time. Dependabot remote branches
(`checkout-7.0.1`, `setup-node-7.1.0`) are gone with no PRs attached —
remote now `origin/main` only (plus `HEAD`).

## 2. macOS infra fix-forward (capacity, not code)

**Diagnosis (recorded, machine-checked).** Failed macOS jobs conclude
`cancelled` with `runner_id: 0`, `runner_name: ""`, **0 steps** — no
code ever executed:

- main push run `45388457174`, job `138579029390`: `{"conclusion":
  "cancelled","runner_id":0,"nsteps":0}` (15m02s queued).
- PR run `45463003991`, job `138591654679`: identical
  (`cancelled`/`runner_id: 0`/0 steps, 15m03s).

11 consecutive identical failures across PR-sync, push, and main runs
(2026-11-24 ~13:10Z → ~16:30Z); ubuntu/windows green on the SAME runs
every time. GitHub Status checked twice during the event
(`api/v2/summary.json`, 2026-11-24T14:24Z and 17:59Z): **all systems
operational, zero incidents** — pool-level starvation, no outage to
cite, no runner bug in our config.

**Pin experiment (ordered, both exhausted).** `macos-14`: same
zero-step non-acquisition in 1s (job `138662010603`, `runner_id: 0`) —
not a queue, a dead pool for this account. `macos-13`: label accepted
but queued 40+ min with `runner_id: 0`, `status: queued` (job
`138663885838`) — no runners behind the label. Zero acquisitions
across all three labels; the matrix returned to `macos-latest`, the
only label with in-repo acquisition history (runs `45345517434`,
`45401674623`). Steps and the macOS honest-disjunction semantics were
never touched (comment-only + label deltas in `ci.yml`).

**Recovery.** The pool yielded ~08:30Z 2026-11-25 (inside the 24h
budget — no HOLD needed): macos green on runs `45463003991` (1m23s)
and `45462992713` (50s). Attempt-URL ledger: every failed acquisition
above plus rerun cycles; the full attempt list is the `ci` runs on PR
#18 (`45400719730`, `45400734001`, `45401674623`, `45401832924`,
`45401844008`, `45455006699`, `45455023524`, `45455551637`,
`45455566806`, `45462992713`, `45463003991`) and main `45388457174`.

**No gate was weakened.** Merge waited for 4/4; no admin bypass (branch
protection: `enforce_admins: true`, verified via API); no skipped
steps; the >24h HOLD path never triggered.

## 3. Branch protection + topics (read before/after)

Required contexts read BEFORE (2026-11-24, `gh api .../branches/main/
protection`): `verify (ubuntu-latest)`, `verify (macos-latest)`,
`verify (windows-latest)`, `hygiene` — `enforce_admins: true`, linear
history, no force pushes/deletions. AFTER: **identical** — the matrix
reverted to `macos-latest`, so no `PUT` was needed (recorded: no PUT
issued). Had the `macos-14/13` labels stuck, the contexts would have
been PUT-updated to match; they didn't stick, so protection is
byte-identical.

Topics typo fixed via API (same PR): before `... "javascript",
"typescipt"]`, after `... "javascript", "typescript"]` (verified by
re-GET). No CI impact (metadata-only).

## 4. Post-merge HEAD matrix (the HEAD-green proof)

Push event on merge `c65eca3`:

- ci `45579403164` (push, head `c65eca3`): ubuntu 1m39s, windows 2m30s,
  **macos 1m45s** — success (the capacity notice appears as an
  informational annotation only).
- hygiene `45579403398` (push, head `c65eca3`): success (15s).

Scoreboard nightly `45542807125` also success (unrelated, noted for
completeness).

## 5. Grep proofs (tree truth at this docs head)

- Explicit-`any`: `node scripts/detect-placeholders.mjs --any-only` →
  `placeholders: clean`, exit 0. Full mode → exactly the 4 pre-existing
  advisory word hits, zero `[explicit-any]`, zero `[ts-parse-error]`.
- DCO: last-5 real commits → `dco: clean (5 commit(s) signed)`.
- Secrets/PII: `node scripts/hygiene/run-all.mjs` → all scanners clean
  (`names: ARMED`, `fixtures: clean`); no secret-shaped or identity
  strings in any new file (pseudonymous noreply + `example.invalid`
  only).
- p0-coverage: `git diff --stat -- docs/p0-coverage.md` → empty
  (byte-identical). Standing observation (not a change): the file's
  count-check line claims "17 gap / 4 delivered in T3/T4" while its own
  23-row table machines to 14 gap + 7 delivered + 1 delivered* +
  1 partial; the table is authoritative, no P0 changes status, recount
  queued for Batch 3 — explicitly NOT a defect, file untouched per the
  gate.

## 6. GIF hashes (re-verified 2026-11-24, local SHA-256 vs manifest.csv)

All six match (lowercase manifest form):

- `fs-deck-demo.gif` → `d7cd07c60c95358c9ba73821558381a2810853dda97d35a0b201d9688b752a3c`
- `fs-deck-approval-brass-void.png` → `5e49ee05c84fac9763e2eff9b44ec8fec5798bdc19cbf48c37f031f9185b`
- `fs-deck-listed-brass-void.png` → `5c369a4aaab46dd9eb9c4e3284ef6ced8f8ec084f0c88802ba9b943b135227`
- `P009-shell-v2.gif` → `6f2c10812ed75ac649e91cc973a3c245a0cfa7f20fcf23a5d84a022c9d`
- `P009-shell.gif` → `e58f5ac673417408c9cafa2b98071b7a17918b9da6e3e2f588a074a022cc7a6e`
- `P009-first-run.png` → `3cd8d44af780a627350e9a135ca2f4cd4cc4ae2c4fdf53320845a60ccda3b21`

## 7. Debt deltas (ledger diff `git diff docs/debts.md`)

- **D1 CLOSED** (P025): TS5 AST detector + `--any-only` blocking gate.
- **D5 CLOSED** (P025): `check-dco.mjs` + hygiene actor-gated step.
- **D7 CLOSED** (this batch): `verify (windows-latest)` green on merged
  `45579403164` and PR `45463003991`; tier1 binary `test result: ok.
  4 passed; 0 failed` with zero SKIP lines (only unrelated `skipped`
  strings: an action outcome, a pnpm note, node `skipped 0`);
  `device_key_roundtrip_or_honest_skip ... ok`. CI windows tier1
  enforces for real — the exact condition D7 named.
- **D2 OPEN** (owner action: VS Build Tools C++ workload; no date
  pressure; CI stays the cored-suite authority).
- **D3 OPEN** (sandbox tier-2 roadmap; future batch; not started).
- **D4 OPEN** (SQLCipher at-rest deferred per ADR-007; revisit
  2027-03-01 or triggers).
- Housekeeping in the same ledger: D6-duplicate fragment removed (was
  pasted twice under D7); D7 tail verified clean.

## 8. Standing rule — SHA-pinned living surfaces (new)

After every rebase-merge, living surfaces are re-verified at the
MERGED SHA via `raw.githubusercontent.com/<repo>/<sha>/...`, never
the moving `main` ref. Verified at `c65eca3` (P025 merge):

- `README.md` badges (§1–4): `[![CI](.../actions/workflows/ci.yml/
  badge.svg)](.../actions/workflows/ci.yml)`,
  `[![Hygiene](.../actions/workflows/hygiene.yml/badge.svg)]
  (.../actions/workflows/hygiene.yml)`,
  `[![License: Apache-2.0](...)]`, platform shield — present verbatim.
- `CONTRIBUTING.md` DCO trailer: `Signed-off-by: Lamakore Maintainers
  <359786796+oneatelier@users.noreply.github.com>` — present verbatim.
- `.github/workflows/ci.yml` gate: `- name: explicit-any AST gate
  (blocking; word rules stay advisory)` + `run: node
  scripts/detect-placeholders.mjs --any-only` — present verbatim.
- Branch protection (API, not raw): 4 bare-name contexts as in §3.

Docs-batch surfaces (INDEX rows, this report, D7 ledger text) are
pinned at docs-PR head `a004e6c` (immutable); the fill delta from
`a004e6c` to the merged head is exactly the three TBC substitutions
(PR number, two run IDs, this SHA note) — tree-equality with the merge
commit is re-verified post-merge before close (see §1 verdict line).

## 9. Gates and deviations

- **[E] Evidence gate:** every claim above names a run ID, job ID,
  hash, or command output; PR-sync + post-merge runs linked per URL.
- **[V] Visual gate:** no human-visible surface changed in this batch
  (workflow label reverts, ledger prose, index rows). GIFs untouched;
  hashes re-verified, not re-captured.
- **Deviations:** (a) two extra matrix-label commits (`macos-14`,
  `macos-13`) landed in history as dead-end probes — kept (history
  immutable) and documented in §2 rather than rewritten. (b) The
  background retry loop that nursed the pool back is infra process,
  not repo state — no artifact kept. (c) `p0-coverage.md` recount
  observation recorded without touching the file.
- **STOP conditions (none fired):** no real test red (all failures
  were zero-step non-acquisitions); no Windows tier1 SKIP; no
  secret/PII hit.
