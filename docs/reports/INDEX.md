# Report index — P010 to P019 (plus out-of-series evidence)

Reports P000–P019 were authored under the provisional codename PROJECT ONE;
the product name is Lamakore. (History is immutable; the codename stays in
those reports. Living surfaces were renamed; see the P020-R report.)

Seed topics from `artifacts/prompt-seed.json`; report topics are what the
report actually evidences. The P008+ report series diverged from seed
numbering early (reports are numbered by landing order, seeds by plan
order) — the table records both so nothing is silently redefined. Seed
P015 ("Dependency install inside the sandbox", `features.csv` F-COD-06)
has no report; the vault work lives out-of-series in `report-vault.md`
(it previously squatted the `report-P015.md` slot — renamed in P019-R).

| Prompt | Seed topic | Report (actual topic) | Evidence runs |
|---|---|---|---|
| P010 | File editing with apply-model diffs | `report-P010.md` — Dependabot flow, badges, branch protection | historical (see report); branch matrix below |
| P011 | Test running with failure reports | `report-P011.md` — core-store: bundled-SQLite daemon store | historical (see report); branch matrix below |
| P012 | Shell commands inside the sandbox | `report-P012.md` — capability gate (HMAC, keychain root) | historical (see report); branch matrix below |
| P013 | Multi-file refactor plans | `report-P013.md` — Tier-1 Windows sandbox | historical (see report); branch matrix below |
| P014 | Lint and format on save | `report-P014.md` — Tier-1 POSIX sandbox (Linux authority, macOS follow-up) | historical (see report, incl. run series 45042328406 → 45043307179); branch matrix below |
| P015 | Dependency install inside the sandbox | — no report (not started) | — |
| P016 | Build and package tasks | — no report (not started) | — |
| P017 | Code search across the workspace | — no report (not started) | — |
| P018 | Diff review before apply | — no report (not started) | — |
| P019 | Hostile page fetch (fetch as markdown) | — no report (not started) | — |

Out-of-series evidence (no P-number; listed so the P-series stays clean):
`report-fs-readonly.md`, `report-approval-deck.md`, `report-audit-ledger.md`,
`report-vault.md` (vault + secret plane + Settings panel),
`report-BATCH2.md` (full local matrix, perf, coverage ledger),
`report-P020.md` ("Shedu" clearance STOP — name abandoned).

Label-overload note: `report-fs-readonly.md` uses "P015" for the
approval-card work and "P016" for the audit chain — working-tree labels
from when it was written, not seed prompts and not reports. History is
immutable; the overload is recorded here, not rewritten.

## Latest branch matrix (`feat/p013-sandbox`, PR #11)

Post-fix runs (P019-R lint fix + macOS honest-disjunction, head `15271f7`),
all green on all three OSes:

- ci (ubuntu + windows + macos): https://github.com/oneatelier/project-one/actions/runs/45345517434 — **success**. The macOS workspace step carries the P014 Seatbelt evidence issue, resolved by the honest disjunction (write-deny passes via `shell-status` evidence; overhead probe prints its SKIP with reason; suite 4/4).
- ci (PR sync, same head): https://github.com/oneatelier/project-one/actions/runs/45345525438 — **success**.
- hygiene (push): https://github.com/oneatelier/project-one/actions/runs/45345517450 — **success**.
- hygiene (PR sync): https://github.com/oneatelier/project-one/actions/runs/45345525419 — **success**.
