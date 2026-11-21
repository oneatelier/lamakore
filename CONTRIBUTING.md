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
