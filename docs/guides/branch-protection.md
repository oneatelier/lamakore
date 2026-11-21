# Branch Protection (`main`)

Apply these settings once the repository is public (Settings → Branches →
Add rule for `main`). They are recorded here so the first push does not
ship without them.

## Required status checks (all must pass before merge)

- `ci / verify (ubuntu-latest)`
- `ci / verify (macos-latest)`
- `ci / verify (windows-latest)`
- `hygiene / hygiene`

## History rules

- **Linear history required** (rebase-merge or squash-merge only; the
  `ci(P005)`-style prompt commits stay readable in sequence).
- **No force-pushes** to `main`. Ever. (Scoreboard pushes fast-forward
  nightly commits; if a push is rejected, rebase and retry — never force.)
- **No deletions** of `main`.

## Signature rules

- DCO sign-off required on every commit from day one (`git commit -s`;
  enforced in review via the PR template checklist).
- **Signed commits required** (required-signatures) as soon as the Owner
  key ceremony completes (see `docs/guides/identity-and-opsec.md` §4).
  Until then this row stays intentionally OFF and the gap is tracked —
  do not enable it with a throwaway key just to tick a box.
- Dismiss stale reviews on new pushes; require review from the Maintainer
  of Record (see `GOVERNANCE.md`).

## Scope

Dependabot opens `chore`-prefixed PRs (see `.github/dependabot.yml`);
they go through the same checks and the same template.
