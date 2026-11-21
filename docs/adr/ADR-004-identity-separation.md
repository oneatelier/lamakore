# ADR-004 — Identity Separation

- **Status:** Accepted
- **Date:** 2026-11-21
- **Scope:** Who this repository speaks as, and what it may never contain
- **Inputs:** `scripts/hygiene/*.mjs`, `.githooks/pre-commit`,
  `docs/guides/identity-and-opsec.md`, `docs/reports/report-P004.md`

## 1. Context

From P004 the repository is public-bound and every commit is visible.
The Owner's real identity must never enter it — yet the project needs
accountable authorship, signed commits, and a working key story. This ADR
draws the line between operational anonymity and honesty.

## 2. Decision

- **Org voice, always.** Commits, sign-offs, and contact addresses use
  the project voice (`PROJECT ONE Maintainers` + noreply address),
  configured repo-locally. `.mailmap` stays empty: no individual is ever
  mapped, aliased, or credited by name.
- **Enforcement, not habit.** Six scanners (`author`, `paths`,
  `metadata`, `secrets`, `names`, `fixtures`) run in `pre-commit` via
  `core.hooksPath`. Each fails closed with file:line and a hint.
- **Owner seed.** `scan-names` enforces `.hygiene/blocklist.local.json`
  (gitignored, never committed). Until the Owner seeds it, the scanner
  reports `ARMED — awaiting Owner seed` and passes — the example file
  carries synthetic values only.
- **Redaction over rewrite.** Pre-P004 evidence files that captured the
  inventory machine's OS username were redacted in place
  (`C:\Users\<name>` → `%USERPROFILE%`, mapping recorded in report-P004).
  Committed history blobs predate the baseline and are disclosed, not
  rewritten: rewriting signed history would destroy the evidence chain
  the hygiene system exists to protect.

## 3. The ethical line

Silence about tooling and process is permitted: we do not disclose which
models, prompts, or automation produced a change unless it matters to the
change itself. What is NOT permitted, ever:

- false claims about authorship (a machine voice is a machine voice);
- invented headcount, personas, reviewers, or endorsements;
- credentials, keys, or access presented as belonging to someone they do not.

No fabricated personas appear in this tree — not as authors, not as
reviewers, not as users in fixtures (sample data uses reserved domains
and synthetic names only).

## 4. Consequences

- `commit.gpgsign` stays deferred to the Owner key ceremony; the P004
  commit is DCO-signed (`-s`) under the org voice in the meantime.
- Media and fixtures carry a verification burden (strip + scan), which
  slows contributions involving images — accepted deliberately.
- Video containers are rejected until a verifier exists; that gap is
  tracked, not hidden.

## 5. Reversal triggers

- If the Owner seeds the blocklist, `scan-names` moves from ARMED to
  enforcing with no code change; record the date in the next report.
- If the project adopts individual attribution (e.g. a foundation
  requires it), this ADR is superseded by a new one — the scanners'
  expected-identity rule changes in the open, never silently.
