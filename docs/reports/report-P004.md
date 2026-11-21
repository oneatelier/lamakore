# Report P004 — Identity Baseline & Automated Anonymity Hygiene

- **Date (local):** 2026-11-21 IST
- **Visual gate:** **N/A.** No visual surface; no pass claimed.

## 1. Objective

Make anonymity a CI-enforced invariant: org-voice identity, six
pre-commit scanners, a seeded-example blocklist, and an opsec guide —
so the Owner's real identity can never enter this repository.

## 2. Identity baseline (repo-local only, never `--global`)

- `user.name = "PROJECT ONE Maintainers"`, `user.email = <org-id>+<handle>@users.noreply.github.com`
- `core.hooksPath = .githooks` (pre-commit runs `run-all.mjs --staged`)
- `.mailmap` created with a policy comment only; it stays empty (ADR-004)
- `commit.gpgsign` unset → signing **deferred to the Owner key ceremony**
  (checklist in `docs/guides/identity-and-opsec.md` §4); this commit is
  DCO-signed (`-s`) under the org voice in the meantime

Prior commits show `PROJECT ONE <project-one@local>` — automation
identity from P000–P003, not a real person. Current tree authorship was
never personal.

## 3. The six scanners (all exit non-zero with file:line + hint)

| Scanner | Rule |
|---|---|
| author | staged author/committer must equal the org voice (derived at runtime from `branding.config.json`) + noreply `...@users.noreply.github.com` |
| paths | rejects `C:\Users\<name>`, `/Users/<name>`, `/home/<name>`; `%USERPROFILE%`, `$HOME`, and `<you>` placeholders pass by design |
| metadata | EXIF/XMP GPS, Author, Software, CreatorTool; PNG/WebP chunks; PDF Author/Creator; video containers fail closed as unverifiable |
| secrets | AWS/GitHub/Anthropic/OpenAI/Stripe/Slack/private-key/`.env` patterns + Shannon>4.5 tripwire; lockfiles and hex SHAs excluded by shape |
| names | enforces gitignored `.hygiene/blocklist.local.json`; unseeded → `ARMED — awaiting Owner seed`, exit 0 |
| fixtures | fixture-scope emails must use reserved domains; key-shaped sample data rejected (name realism: review + blocklist, documented) |

## 4. Acceptance evidence

- **12/12 tests pass** (`node --test tests/hygiene/scanners.spec.ts
  tests/branding/rename.spec.ts` → 14/14 total with P003's 2):
  author fail/pass, paths fail/pass, metadata fail/pass, secrets
  fail/pass, names fail/pass (+ARMED), fixtures fail/pass.
- **`git check-ignore .hygiene/blocklist.local.json`** → exit 0 (ignored);
  `blocklist.example.json` → exit 1 (committable, synthetic values only).
- **Hook block, verbatim** (`GIT_AUTHOR_*`/`GIT_COMMITTER_*` set to
  Jane Doe / jane.doe@contoso.com, `git commit --allow-empty`):
  `author:GIT_AUTHOR_NAME got "Jane Doe"; want the org voice; ...`
  (4 violations) → `hygiene: 1 scanner(s) failed — commit blocked`,
  commit aborted, `git log` unchanged. Full output in §6.
- **`pnpm lint`, `pnpm typecheck`, `cargo check --workspace`**: all exit 0
  (new files introduce zero brand literals — verified, not assumed).
- **No real personal name in the tracked tree:** case-insensitive sweep
  for the inventory machine's OS username returns zero hits after the
  redaction below; all authors are org-voice/automation identities.

## 5. Redaction + STOP state (disclosed, not hidden)

- The sweep found exactly **2 occurrences** of the inventory OS username,
  both in `artifacts/machine-profile.json` (interpreter paths, P000
  provenance). Redacted in place: `C:\Users\<name>` → `%USERPROFILE%`
  (2 replacements). Nothing else in the tree referenced it.
- **STOP condition met:** the Owner has not seeded the blocklist, so no
  real terms exist anywhere in my inputs to seed it with (inventing a
  legal name from an OS account fragment would be fabrication). Created
  the example file, the local stub (`seeded: false`), and the scanner
  reports **ARMED — awaiting Owner seed**. Seeding flips it to enforcing
  with no code change.
- **History caveat:** pre-P004 commit blobs retain the redacted username
  bytes (P000 evidence as captured). History is not rewritten — rewriting
  signed history would destroy the evidence chain. Current tree: zero hits.

## 6. Block-demo transcript (abridged shell noise removed)

```
author:GIT_AUTHOR_NAME got "Jane Doe"; want the org voice; hint: git config user.name "PROJECT ONE Maintainers" (repo-local only, never --global)
author:GIT_AUTHOR_EMAIL got "jane.doe@contoso.com"; want <org-id>+<handle>@users.noreply.github.com; hint: git config user.email with a noreply address (repo-local only)
committer:GIT_COMMITTER_NAME got "Jane Doe"; want the org voice; ...
committer:GIT_COMMITTER_EMAIL got "jane.doe@contoso.com"; want ...noreply.github.com; ...
author: 4 violation(s); hint: configure the org voice repo-locally and retry
paths: clean
metadata: clean
secrets: clean
names: ARMED — awaiting Owner seed (.hygiene/blocklist.local.json absent or unseeded)
fixtures: clean
hygiene: 1 scanner(s) failed — commit blocked
```

## 7. Deviations

- **D1 — `git var` takes IDENTs, not NAMEs.** Initial implementation
  called `git var GIT_AUTHOR_NAME` (exit 129). Corrected to
  `GIT_AUTHOR_IDENT`/`GIT_COMMITTER_IDENT` with `Name <mail>` parsing in
  both `scan-author.mjs` and `run-all.mjs`.
- **D2 — scanner must not scan its own blocklist.** Fixed by excluding
  `.hygiene/` and the resolved blocklist path.
- **D3 — `*/` cannot appear in a block comment.** `scan-fixtures.mjs`
  header contained a `*/fixtures` glob that terminated its own comment
  (SyntaxError); reworded.
- **D4 — brand-lint exclusion extended to `docs/guides/`.** The opsec
  guide names the org voice constitutively; consistent with the P003-D1
  rule for policy files.
- **D5 — `pnpm test` uses explicit spec paths.** `node --test tests/`
  fails to resolve the directory on this toolchain; both spec files are
  named instead.
