# Report P010 — Dependabot flow, badges, branch protection

- **Date (UTC):** 2026-11-22
- **Scope:** the 7-item P010 batch (hygiene actor-gate, dependabot.yml groups,
  License badge, repo About, `enforce_admins=true` + PR-only docs, P009-R cargo
  appendix, dependabot PR re-runs + major closures).
- **Head:** `d92757a` on `main` (via PR #3 → `80196e7`, PR #5 → `d92757a`;
  both rebase-merged with all required checks green).

## 1. hygiene.yml — actor-gated author skip (content scans always run)

- The author-identity step is skipped ONLY when
  `github.actor == 'dependabot[bot]'` (`if: github.event_name ==
  'pull_request' && github.actor != 'dependabot[bot]'`); the full-tree
  content scan (`run-all.mjs`) runs unconditionally, including dependabot PRs.
- PR events check the PR **head SHA** (fetched explicitly — the checkout is
  the ephemeral merge commit, whose author is the merger, not the PR author).
  Push events (post-merge `main`) run an **author-only** landed check
  (`--author-only --allow-bot-author`): GitHub's rebase-merge preserves the
  author but rewrites the committer to the merger, so a pinned committer
  cannot hold there. The PR-event gate (author AND committer pinned) already
  vetted the identity pre-merge.
- Spoof test (human pushes git-author `dependabot[bot]`): `scan-author.mjs`
  rejects it — covered by `tests/hygiene/scanners.spec.ts`
  (`author rejects a spoofed dependabot[bot] git identity`,
  `author-only still rejects a spoofed dependabot[bot] author`,
  `hygiene workflow gates the author skip on github.actor...`). Local:
  `node --test tests/hygiene/scanners.spec.ts` → 20/20 pass (was 16).

## 2. .github/dependabot.yml — grouped weekly updates

- 3 ecosystems (npm, cargo, github-actions): `interval: weekly`,
  `open-pull-requests-limit: 5`, `commit-message.prefix: chore(deps)`, each
  with a minor+patch group (`*-minor-patch`: `update-types: [minor, patch]`;
  majors fall out as separate PRs by design).
- Live verification: after landing, Dependabot re-created both open PRs with
  the new prefix (`chore(deps): bump ...`, e.g. `bb1008c`, `749899d`).

## 3. License badge — static shields.io, encoded

- Was `[![License: Apache-2.0](LICENSE)](LICENSE)` (LICENSE used as image
  URL — broken). Now
  `[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)`
  (`Apache--2.0` double-dash encoding, blue).
- Renders: fetched SVG `License | Apache-2.0`
  (`https://img.shields.io/badge/License-Apache--2.0-blue.svg`); screenshot
  `artifacts/P010-license-badge.jpeg`.

## 4. Repo About — description + topics (gh api)

- `PATCH repos/oneatelier/project-one` → description:
  `Pre-alpha. One local-first desktop control plane for AI agents —
  sandboxed tools, BYOK, no telemetry. Provisional name.`
- `PUT repos/oneatelier/project-one/topics` →
  `ai-agents, byok, electron, local-first, rust, sandbox` (verified round-trip).
- Screenshot `artifacts/P010-about-populated.jpeg` (About panel with
  description + all six topics); page text independently fetched.

## 5. Branch protection — enforce_admins=true, PR-only flow

- `POST .../protection/enforce_admins` → `{"enabled":true}`; verified:
  `required_pull_request_reviews: null` (off), `required_signatures: false`
  (off), strict required checks, linear history, no force pushes/deletions.
- `CONTRIBUTING.md` documents the PR-only flow (no direct pushes, PR +
  4 green checks + rebase-merge, admins included), why reviews/signatures
  stay off (single maintainer → review requirement would deadlock every PR;
  signing key ceremony pending; DCO + pinned identity is the interim
  control), and the revisit trigger (first external contributor).
- P010 FINDING (blocked two merges, then fixed): the legacy protection
  `checks` list matches Actions check runs by **bare job name**
  (`hygiene`, `verify (ubuntu-latest)` …). The P009-R entries used
  workflow-qualified strings (`ci / verify (...)`, `hygiene / hygiene`),
  which the API accepts but never matches — every PR stayed unmergeable
  (`405 "4 of 4 required status checks are expected"` despite 8 green check
  runs on the head SHA; verified byte-clean, app-linked, PR-associated).
  Entries corrected to bare names (+ `app_id: 15368` github-actions);
  PR #3 merged immediately after. `CONTRIBUTING.md` records this.
- P010 FINDING #2: post-merge `main` went red once (`hygiene` push run
  `45018248506`): rebase-merge committer is the merger
  (`oneatelier <oneatelier17@gmail.com>`), not pinned. Fixed forward with
  the author-only landed check (PR #5 → `d92757a`); push run
  `45018658432` green. No bypasses used; `enforce_admins` stayed on.

## 6. report-P009-R.md — cargo appendix from ci run 45006644024

- Appended verbatim `test result` summary: all three OSes
  `6 passed; 0 failed` (one suite) + 8 × `0 passed; 0 failed`; the six
  tests enumerated
  (`wire::tests::{allowlist_gates_methods,frames_round_trip,handshake_accepts_exact_match,handshake_refuses_each_mismatch}`,
  `events::tests::{cumulative_ack_forgets_prefix,overflow_spills_to_disk_instead_of_dropping}`).
  Run: https://github.com/oneatelier/project-one/actions/runs/45006644024

## 7. Dependabot PRs — re-run green, majors closed with reason

- PR #1 `actions/setup-node 6.5.0 → 7.1.0` (major): hygiene green after the
  actor-skip fix —
  https://github.com/oneatelier/project-one/actions/runs/45018812344
  (PR event, Success, 7s, actor `dependabot[bot]`) and
  https://github.com/oneatelier/project-one/actions/runs/45018808986 ;
  all `verify` green on 3 OSes. Closed with recorded reason (major v7 ESM
  migration; grouped patch/minor auto-flow only; majors merged manually in
  a maintenance window): PR #1 comment `7078677403`.
- PR #2 `actions/checkout 6.1.0 → 7.0.1` (major): hygiene green —
  https://github.com/oneatelier/project-one/actions/runs/45018811905 and
  https://github.com/oneatelier/project-one/actions/runs/45018808870 ;
  all `verify` green. Closed with recorded reason (major v7 ESM + fork-PR
  blocking): PR #2 comment `7078678951`.
- Probe PR #4 (diagnostic only) closed with comment; branches removed.
- Open PRs at close of business: none.

## Standing state

- `main` = `d92757a`; push runs green (`hygiene` `45018658432`,
  `ci` `45018658430`). Full local gate green: `run-all.mjs` clean,
  `pnpm test` 20 hygiene + branding pass, `tsc --noEmit` clean.
- Evidence files: `artifacts/P010-about-populated.jpeg`,
  `artifacts/P010-license-badge.jpeg`.
