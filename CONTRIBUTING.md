# Contributing to PROJECT ONE

## Developer Certificate of Origin (DCO) — required

Every commit MUST carry a `Signed-off-by` trailer (`git commit -s`).
A pull request without sign-off on every commit is not reviewed.
By signing off you certify the [Developer Certificate of Origin 1.1](https://developercertificate.org/):
you wrote the change, or you have the right to submit it under the
project's Apache-2.0 license.

## Commit format — Conventional Commits with a prompt scope

```
<type>(P0NN): <imperative subject>
```

- `type`: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `revert`.
- Scope is the prompt number that produced the change, e.g. `(P001)`,
  `(P002)`. One prompt = one scope; cross-prompt changes are split.
- Example: `feat(P001): pinned cross-platform toolchain bootstrap`.

## Definition of Done — the two gates

No change merges unless BOTH gates are evidenced in its report
(`docs/reports/report-P0NN.md`):

1. **[E] Evidence gate.** Every acceptance claim is backed by
   machine-checkable output recorded verbatim or by file reference:
   command lines, exit codes, version strings, hashes. A claim without
   evidence is a draft, not a result.
2. **[V] Visual gate.** Anything a human sees (UI, installer, rendered
   docs) is verified by a human and the verification is recorded. When
   a prompt has no visual surface, the report records the deferral
   explicitly (e.g. "deferred to P007") instead of claiming a pass.

## Further rules

- Rust code: `cargo check --workspace` and `cargo clippy --workspace` clean.
- JS/TS code: `pnpm install` green; no new dependency without a NOTICE entry.
- Never commit secrets (`.env*` is ignored and stays ignored).
- License headers: new source files carry the Apache-2.0 header naming
  "The PROJECT ONE Authors" — never a personal name.

## Branch protection — PR-only flow (enforced, including admins)

- `main` is protected: strict required status checks
  (`ci / verify (ubuntu-latest)`, `ci / verify (macos-latest)`,
  `ci / verify (windows-latest)`, `hygiene / hygiene`), linear history,
  no force pushes, no deletions, and `enforce_admins: true` — the owner
  cannot push directly either.
- Every change lands via a pull request with all four checks green and a
  rebase-merge; there are no direct pushes to `main`.
- Dependabot is the only bot author exempted from the author-identity rule,
  and the exemption is actor-gated (`github.actor == 'dependabot[bot]'` in
  `hygiene.yml`), never commit-string gated — a human pushing commits with
  git-author `dependabot[bot]` still fails `scan-author.mjs` (covered by
  `tests/hygiene/scanners.spec.ts`). All content scans still run on
  dependabot PRs.

## Why required reviews and signatures stay off (for now)

- Required reviews: off. With a single maintainer, requiring a review would
  deadlock every PR (including the owner's own and dependabot's) — no second
  human exists to approve. Recorded, not deferred lightly.
- Required signatures: off. The commit-signing key ceremony is still pending;
  DCO sign-off (`git commit -s`) plus the pinned author identity
  (`.hygiene/identity.json` + `scan-author.mjs`) is the interim provenance
  control.
- Revisit trigger: the arrival of the first external contributor. At that
  point enable at least one required approving review (and re-evaluate
  required signatures once the key ceremony is complete).
