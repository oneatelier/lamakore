# Report P006 — Spec Registry, Rubric, Validators

- **Date (local):** 2026-11-21 IST
- **Visual gate:** **N/A.** No visual surface; no pass claimed.

## 1. Objective

Install the machine-readable blueprint every later prompt and every audit
is measured against — and fix the known count errors by recounting from
the actual rows, never by copying a number.

## 2. True counts (computed, not copied)

`node scripts/validate-artifacts.mjs` prints from the rows themselves:

```
counts: P0=23 P1=29 P2=13 (recounted from rows)
```

- 65 features: code 9, browse 9, os 6, orchestration 9, memory 7,
  models 8, platform 11, enterprise 6 (all exact).
- 130 prompts P000–P129, DAG acyclic, 45 multi-dep forks and
  45 multi-dependent joins (a real DAG, not a linear chain).
- 42 risks, every severity equals likelihood×impact.
- Rubric weights sum to exactly 100 (asserted in code).
- Roadmap counts match the recount byte-for-byte (validator cross-check).

## 3. Blueprint discrepancy (STOP honored)

The prior blueprint claimed **28** P0 items while its catalog actually
held **37**. This registry rebuilds the catalog and recounts **23/29/13**.
Per the STOP rule I trust the recount, log the discrepancy here, and
flag it for the Owner: the 28-vs-37 gap suggests the old catalog was
counted by hand against a stale definition of P0. The recount stands
until the Owner rules otherwise — no number in `roadmap.json` was
adjusted to match any prior claim.

## 4. Acceptance evidence

| Gate | Result |
|---|---|
| [E] validate-artifacts exits 0; cross-refs resolve | **PASS** — `artifacts: ALL CHECKS PASSED` (65 rows, 130 entries, DAG acyclic, 42 severities, weights 100, roadmap match) |
| [E] Rubric weights sum to 100 in code | **PASS** — `sum !== 100` fails the run; observed sum exactly 100 |
| [E] All 42 severities equal likelihood×impact | **PASS** — checked per row, zero mismatches |
| [E] DAG acyclic; true P0/P1/P2 printed | **PASS** — Kahn's algorithm visits all 130; counts §2 |
| [E] detect-placeholders clean here, fails on planted TODO | **PASS** — `placeholders: clean` on the tree; planted `// TODO` fixture → exit 1 with file:line + hint |
| [V] | **N/A** |

Supporting runs: brand lint clean; hygiene run-all clean (names ARMED,
Owner seed still pending); `tsc --noEmit` exit 0; both spec files 14/14.

## 5. Deviations and incidents

- **D1 — TypeScript 7 has no monolithic compiler API.** `require('typescript')`
  now resolves to a version stub; the parser lives behind `typescript/unstable/*`
  with no `createSourceFile` export. The `any` check uses the exported TS 7
  **scanner** (`typescript/unstable/ast`): comments are trivia and strings are
  string tokens, so neither can match — the no-false-positive property holds
  without a full parse. Documented in the script header.
- **D2 — scanner loop hung the first run.** The EOF guard assumed a token
  identity the new API does not guarantee; the process was killed and the
  loop rewritten with a progress guard (breaks on no token advance). The
  kill is disclosed here; no output from the hung run is cited anywhere.
- **D3 — detector excludes history + itself.** `docs/reports`, `docs/adr`,
  CHANGELOG, and the detector's own source are out of scope (history is
  immutable; the rule must not flag its own definition). Three live
  "placeholder" wordings were reworded instead.
- **D4 — `deferred:#NNN` fails closed.** Resolution tries a local
  `artifacts/issues.json` registry, then `gh`; absent both, the marker is a
  violation. The tree carries zero markers, so the run is clean by construction.
- **D5 — naming matrix is a pre-clearance screen.** Candidates are rejected
  on structural grounds with the ADR-003 step that would reject them; formal
  USPTO/EUIPO searches are pending and no serial numbers are invented.
- **D6 — scoreboard.yml now calls `gen-scoreboard.mjs`.** Single
  implementation instead of inline duplication; the committed scoreboard is
  the honest-empty baseline the workflow regenerates nightly.

## 6. Next steps

1. Owner ruling on the 28-vs-37-vs-23 discrepancy (counts stand as recounted until then).
2. P007+ prompts execute against `features.csv` owners; `validate-artifacts`
   runs in CI before any prompt lands (wire into `ci.yml` when the P005
   follow-up for validator wiring is scheduled).
3. Owner seeds `.hygiene/blocklist.local.json`; naming clearance runs ADR-003 steps 1–4.
