# Report P022 — org voice flip to Lamakore Maintainers

- **Date (UTC):** 2026-11-24
- **Scope:** P022 identity flip. (1) Local git voice to the new org
  identity (email unchanged). (2) Single coordinated commit flipping
  `.hygiene/identity.json` + CONTRIBUTING DCO example + identity guide.
  (3) scan-author hardening: both roles pinned, two new failing
  fixtures (gmail committer; retired voice author). (4) Guide: canonical
  handles, hidden-Gmail rule, ACCEPTED-RISK entry, X watchlist.
- **Head:** main @ `4e362f9` + this working tree (this report; PR to follow).

## 1. Coordinated flip (single commit, hook-clean)

`git config --local user.name "Lamakore Maintainers"` (email unchanged:
`359786796+oneatelier@users.noreply.github.com`). One commit `f9fc926`
flips all four surfaces together so the hook never sees a half-flipped
tree: `.hygiene/identity.json`, CONTRIBUTING DCO example trailer,
`docs/guides/identity-and-opsec.md` (voice line + §1b handles + §1c
Gmail rule + §1d ACCEPTED-RISK + §4b watchlist), and the two new
fixtures in `tests/hygiene/scanners.spec.ts`. The flip commit itself
passed the hook (`hygiene: all scanners clean` at commit time) — the
new-identity commit passes, per ACCEPT.

Old voice ("PROJECT ONE Maintainers") now fails closed for new commits
(fixture-proven below); history is untouched (ADR-004). scan-author
logic unchanged: full author+committer pinned check by default,
`--author-only` for push events (P010 post-merge accommodation kept —
GitHub rewrites the committer to the merger), dependabot exemption
still gated on `github.actor` only (workflow untouched).

## 2. Hook blocks the gmail-committer fixture (verbatim)

Exact pre-commit code path (`.githooks/pre-commit` execs
`node scripts/hygiene/run-all.mjs --staged`, which hands `git var`
idents to `scan-author.mjs`), with the committer email overridden:

```text
$ GIT_COMMITTER_EMAIL=operator@gmail.com node scripts/hygiene/run-all.mjs --staged
committer:GIT_COMMITTER_EMAIL got "operator@gmail.com"; want exactly "359786796+oneatelier@users.noreply.github.com" (.hygiene/identity.json is the only accepted identity)
author: 1 violation(s); hint: configure the org voice repo-locally and retry
paths: clean
metadata: clean
secrets: clean
names: ARMED — awaiting Owner seed (.hygiene/blocklist.local.json absent or unseeded)
fixtures: clean
hygiene: 1 scanner(s) failed — commit blocked
```

Exit 1: the commit is blocked. The two new spec fixtures prove the same
denials in isolation (`author rejects any @gmail.com committer
identity` → `GIT_COMMITTER_EMAIL`; `author rejects the retired PROJECT
ONE org voice for new commits` → `GIT_AUTHOR_NAME`); suite 22/22 local,
24/24 with branding (`pnpm test`).

## 3. CI: PR green, merged, post-merge main green

- PR #14 (`identity/p022-voice` → `main`): all 4 required checks SUCCESS
  (ci ubuntu/macOS/windows + hygiene), `mergeable`, merged via
  `gh pr merge 14 --rebase --delete-branch` 2026-11-24T08:13:45Z (DCO
  intact, linear history). Branch deleted locally and on origin.
- Post-merge main: hygiene
  https://github.com/oneatelier/lamakore/actions/runs/45354287318 —
  **success**; ci
  https://github.com/oneatelier/lamakore/actions/runs/45354287237 —
  **success** (all 3 OSes, all 17 steps).

## 4. Guide deltas (living docs only; reports/ADRs immutable)

- Canonical handles table: GitHub `oneatelier`, X `one_atelier_`,
  Reddit `u/oneatelier`, Bluesky `oneatelier.bsky.social` (bio-links-out
  rule stated; no other handle speaks for the project).
- Hidden-Gmail rule restated: exactly one non-noreply address exists in
  operations; never in code/docs/metadata/fixtures; any Gmail elsewhere
  is a finding; hook blocks `@gmail.com` committers at commit time.
- ACCEPTED-RISK (factual, verified in log): early history carries
  pseudonymous Gmail (`oneatelier17@gmail.com`) in author/committer
  metadata. Accepted as-is — history immutable, no rewrite. Mitigations:
  pinned-identity hook blocks new occurrences; owner-side GitHub
  settings prevent recurrence. Revisit only on impersonation abuse.
- Watchlist: X `@one_atelier` (no underscore, unknown holder) vs our
  `one_atelier_`; check on every release, record hits in clearance.md.

## 5. Gates and deviations

- **[E] Evidence gate:** verbatim hook output (§2), suite counts,
  run URLs above — post-merge main ci + hygiene both green.
- **[V] Visual gate:** deferred — no visual surface (config/docs/tests).
- **Deviations:** (a) scan-author.mjs needed no logic change — the pinned
  exact-match on both roles already implemented the hardening; the fixtures
  are the proof. (b) `security@project-one.dev` contact and the
  pre-flip history intentionally untouched (no replacement domain owned;
  history immutable). (c) Report-P020-R run URLs keep the old
  `project-one` prefix — GitHub redirects preserve them.
