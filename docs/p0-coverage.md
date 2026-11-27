# P0 coverage map (23 P0s × 5 competitor uninstall thresholds)

Method: the 23 P0 rows are recounted from `artifacts/features.csv`
(`priority_counts.P0 = 23`, enforced by `validate-artifacts.mjs`).
The 5 thresholds are derived from `artifacts/competitors.json` (10 rivals,
grouped by the job that would uninstall us) plus the vision-rubric pillars.
Status is tree-truth as of Batch 2 (report-BATCH2): `delivered` means code
plus green evidence exists; everything else is `gap` with an explicit
ruling in §3. No silent scope cuts — all 23 rows appear below.

## The 5 uninstall thresholds

- **T1 — Safe code execution.** Edit → test → shell → review, all inside
  the sandbox. Rivals: Cursor (tab/chat), Aider (diff+git), Codex (reasoning).
- **T2 — Hostile web without compromise.** Fetch-as-markdown, downloads
  into the sandbox, blocked-domain policy. Rivals: Gemini (free tier),
  OpenHands (docker sandboxes), Windsurf (agentic flows).
- **T3 — Lives in the OS.** Workspace files where the user works, plus
  native presence. Rivals: Zed (speed), VS Code+Copilot (ecosystem),
  JetBrains AI (depth).
- **T4 — Trust to delegate.** Capability tokens, approvals, audit, green
  matrix, hygiene, reproducible pins. Our edge vs all ten rivals; the
  enterprise/air-gap story depends on it.
- **T5 — Models + memory that persist.** Local 7B, remote path, streaming,
  working memory, forget/redact. Rivals: Claude Code (long-horizon),
  Copilot (models), Windsurf (cascade).

## Row map (all 23 P0s)

| P0 id | Capability (features.csv) | Threshold | Status | Evidence |
|---|---|---|---|---|
| F-COD-01 | Edit files with apply-model diffs | T1 | gap | — (owner prompt P010, not started) |
| F-COD-02 | Run tests and report failures | T1 | gap | — (P011, not started) |
| F-COD-03 | Shell commands inside the sandbox | T1 | gap | — (P012, not started; Tier-1 spawn exists, no shell tool) |
| F-COD-08 | Code search across the workspace | T1 | gap | — (P017, not started) |
| F-COD-09 | Diff review before apply | T1 | gap | — (P018, not started) |
| F-BRW-01 | Fetch pages as hostile markdown | T2 | gap | — (P019, no browser tooling) |
| F-BRW-04 | Download files into the sandbox | T2 | gap | — (P022, no browser tooling) |
| F-BRW-08 | Blocked-domain policy | T2 | gap | — (P026, policy not implemented) |
| F-OSS-01 | List and read files in the workspace | T3 | delivered | fs.list/fs.read e2e 10/10 + deck panel, report-BATCH2 §3 |
| F-ORC-01 | Tool dispatch with capability tokens | T4 | delivered | report-P012 (gate-matrix exhaustive) |
| F-ORC-02 | Plan-then-execute loop | T4 | gap | — (P035, no loop; approvals+tokens exist without a driver) |
| F-ORC-04 | Human approval gates | T4 | delivered | approval wire plane + deck card, report-approval-deck.md + report-BATCH2 §3 |
| F-MEM-01 | Working-memory scratchpad | T5 | gap | — (P043, no memory code) |
| F-MEM-05 | Forget and redaction commands | T5 | gap | — (P047, no memory code) |
| F-MOD-01 | Local 7B inference tier | T5 | gap | — (P050, no inference path) |
| F-MOD-02 | Remote inference path | T5 | gap | — (P051, keys now vaulted per report-vault.md; no path uses them) |
| F-MOD-04 | Streaming tokens to the UI | T5 | gap | — (P053, no inference path) |
| F-PLA-01 | Pinned reproducible toolchain | T4 | delivered | report-P001, evidence_status verified |
| F-PLA-02 | Monorepo scaffold and governance | T4 | delivered | report-P002, verified |
| F-PLA-04 | Anonymity hygiene enforcement | T4 | delivered | report-P004, six scanners green (Batch 2 matrix) |
| F-PLA-05 | Green CI on three OS images | T4 | delivered* | report-P005; *Batch 2 head is red at `pnpm lint` until the brand-token fix in this batch — fixed here, CI re-run is the merge authority |
| F-PLA-06 | Spec registry with validators | T4 | delivered | report-P006; `validate-artifacts.mjs` green in Batch 2 matrix |
| F-PLA-08 | RAM gate for the shell and models | T4 | partial | report-P008 (cold start 532 ms wall vs 2500 ms); model-side gate unmeasured — no model tier exists |

Count check: 23 rows, 7 delivered + 1 delivered* + 1 partial + 14 gap = 23. Matches the `P0=23` recount. (Ruling: recount pulled forward from Batch 3 into this honesty sweep — no P0 changes status.)

## Threshold verdicts (STOP: every uncovered threshold needs a ruling)

- **T1 — GAP (0/5 delivered). Ruling (accepted):** the write/execute half
  of the agent loop is not built; only read-only fs + Tier-1 sandbox
  exist as foundation. Sequenced as owner prompts P010–P018 (Batch 3+).
  Uninstall risk vs Cursor/Aider/Codex acknowledged until then.
- **T2 — GAP (0/3 delivered). Ruling (accepted):** no browser tooling of
  any kind; F-BRW-08 policy is the recorded pre-condition for fetch work.
  Sequenced as P019–P026 (Batch 3+). Uninstall risk vs Gemini/OpenHands
  acknowledged.
- **T3 — PARTIAL (1/1 P0 delivered; 4 P1 integrations open). Ruling
  (accepted):** read-only workspace access is the P0 bar and it is met;
  notifications, hotkey, clipboard gating, open-in-system (all P1) stay
  future. Speed/ecosystem parity with Zed/VS Code is explicitly out of
  pre-alpha scope.
- **T4 — PARTIAL (7/9 delivered). Ruling (accepted with two named gaps):**
  (a) F-ORC-02 plan-execute loop missing — tokens and approvals have no
  driver; (b) F-PLA-08 model-side RAM gate unmeasured. Both ride the
  models/memory phase (Batch 3+). The trust core itself (tokens,
  approvals, audit chain, hygiene, pins, matrix) is delivered.
- **T5 — GAP (0/5 delivered). Ruling (accepted):** no inference or memory
  code exists at all; provider keys are vaulted (report-vault.md) ahead of any path
  that uses them. Sequenced as P043–P057 (Batch 3+). Uninstall risk vs
  Claude Code/Copilot acknowledged.

Ledger: 5 thresholds, 5 rulings, 0 uncovered-without-ruling. STOP not triggered.
