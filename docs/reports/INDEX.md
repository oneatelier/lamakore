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
| P022 | Sandboxed downloads | `report-P022.md` — org voice flip to Lamakore Maintainers (seed diverged: no browser tooling yet, voice work landed instead) | PR #14 post-merge main: [hygiene 45354287318](https://github.com/oneatelier/lamakore/actions/runs/45354287318) + [ci 45354287237](https://github.com/oneatelier/lamakore/actions/runs/45354287237) (3 OSes, 17 steps, success) |
| P023 | Search engine adapters | — no report (not started) | — |
| P024 | Per-session cookie jar | — no report (not started) | — |
| P025 | Readability extraction | `report-P025.md` — D1 real AST any-detector + D5 server-side DCO gate (seed diverged: debt closure landed instead) | PR #18: [ci 45463003991](https://github.com/oneatelier/lamakore/actions/runs/45463003991) (head `3a43187`, 4/4 incl. macOS) + [hygiene 45463003821](https://github.com/oneatelier/lamakore/actions/runs/45463003821); post-merge main [ci 45579403164](https://github.com/oneatelier/lamakore/actions/runs/45579403164) + [hygiene 45579403398](https://github.com/oneatelier/lamakore/actions/runs/45579403398) (head `c65eca3`, all success) |
| P026 | Blocked-domain policy | `report-FIXBATCH.md` — P025-COMPLETE + P026 gate: macOS infra fix-forward, merge, full matrix at HEAD (seed diverged: policy not implemented; the P026 label here is the landing sequence) | docs PR #19 — run URLs in `report-FIXBATCH.md` §§1,4 |

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
