# Report P009-R — Identity-Confirmed Public Root

- **Date (UTC):** 2026-11-22
- **Remote:** `https://github.com/oneatelier/project-one.git` (main @ `2d1b9dd`, junk root — never fetched, never merged)
- **Commit identity (repo-local only):** `PROJECT ONE Maintainers <359786796+oneatelier@users.noreply.github.com>` — the ONLY accepted identity (enforced by `scan-author.mjs` exact match against `.hygiene/identity.json`).

## Phase 1 — Leak audit (full history, all blobs)

| Vector | Result |
|---|---|
| OS account name (`shubh`, any case) | **4 hits** — `artifacts/machine-profile.json` blobs in the P000–P003-era commits only. Purged in Phase 2. |
| Gmail addresses | **hits, all synthetic** — `jane.doe@gmail.com` in the P004 hook-demo transcript and as split literals in `tests/hygiene/scanners.spec.ts`. No real personal Gmail exists anywhere in the tree (verified: no other address-shaped string in any blob). Rewritten to `contoso.com` anyway (canonical fictional domain; test intent preserved since it stays non-reserved). |
| Home-dir paths | Only `C:\Users\<you>` / `/home/<you>` placeholders and the `scan-paths.mjs` regex itself — constitutive, not leaks. |
| Tokens / private keys | Only detector regexes (`scan-secrets.mjs`, `scan-fixtures.mjs`) — constitutive, not secrets. |
| Real personal names | **Zero.** All authors are org-voice or pre-publish automation identities. |
| Credential-store contents | Never read into files; `cmdkey` listing used for names only. The owner handle observed there is not recorded in any tracked file. |
| `oneatelier` / placeholder noreply | Only template strings (`<owner-provided>`, `<org-id>+<handle>`); the real numeric identity lands in Phase 2/3 below. |

## Phase 2 — History rewrite (2 passes, `git-filter-repo`)

Pass 1: `regex:C:\\\\Users\\\\Shubh==>%USERPROFILE%` — redacts the OS
account name from the 4 affected blobs (same redaction the live tree
already carried since P004). Pass 2: `jane.doe@gmail.com`→
`jane.doe@contoso.com`, `'gmail.com'`→`'contoso.com'` — eliminates every
gmail.com string while keeping the fixtures test meaningful.
Post-rewrite audit: **zero hits** for account name and gmail across all
blobs; `validate-artifacts`, `detect-placeholders`, full test suite and
`tsc` all green on the rewritten tree (14/14 hygiene incl. 2 new
pinned-identity tests; full suite re-run pre-commit).

## Old → new SHA mapping (10 commits, messages unchanged)

| # | Before (scrubbed) | After (public root) | Subject |
|---|---|---|---|
| 1 | `8170752174e8e2c92361dc75262439467dacb977` | `a46da9b11159da60738adf4c9e68e997d180ca8f` | chore(P000) |
| 2 | `891490cea7992b187d7483cce18559466ef355f7` | `a499b7138203d31b02b5b5be669e526bd3c2b742` | feat(P001) |
| 3 | `e2fba8c4b8ce1f6a90df7b49b85d6540deba2e8c` | `8a1db0ae8e51813aa446a0d2aa71180438065bc6` | chore(P002) |
| 4 | `a6b067f6f0da0cdc5b54545650fa1d5cfb1b8df3` | `2d58f28eae30126161a78f61c60203791406fbbb` | feat(P003) |
| 5 | `61d87572958179824d1465c415225cb18494fe7e` | `3aab753487acac9b1f1d09049a539a084af75d4b` | feat(P004) |
| 6 | `a2be811b527c88994ac7a7ff68b8eec0077aac36` | `5e49a797133f990e500487ebacfd2c8cac9ba03f` | ci(P005) |
| 7 | `3f6625b47c86b200f0c18e2dd80e123dff9d9cba` | `52fb0e9370511614e3c71eb9b8f4c8ab9be46ef9` | feat(P006) |
| 8 | `1aa5a2ec14057d234da88bd5c8c4208269085c39` | `a19fdda08978aa8d70bff938fd14f6e787557c6f` | feat(P007) |
| 9 | `d1763866b32e9203079f82bbcb42cb1dc44c4519` | `d6dd1f8feeb3d51743e5f5f96c03d9917d4f05d8` | feat(P008) |
| 10 | `5ca4b8ba1d6a02aa74516dc3394000671d5f6a75` | `f5a902867b14efd9e2714c7687842f153ba77384` | feat(P009) |

(All SHAs full-length above. Every SHA changed because the root blob
changed — expected. Paired by commit message order.)

## Phase 3 — Publish (junk root replaced, never merged)

- Remote added (no fetch, no merge, no rebase — per instruction).
- Pre-push verification: working tree clean, hook green, full gate chain
  green on the exact bytes being pushed.
- First attempt via GCM-stored credential: **HTTP 403** (wrong account —
  recorded, not retried blindly).
- Owner unblocked with `gh` auth (`oneatelier`, scopes `repo` +
  `workflow` verified); stale GCM credential deleted; `gh` wired as the
  sole git credential helper.
- Push: `git push -u origin main --force` → **landed**:
  `52a3285..d3515f7 main -> main`. Remote `main` =
  `d3515f7` = local HEAD (verified via `git ls-remote`).
- Commit identity on the wire: org voice + numeric noreply (new commits
  only; history authors untouched — pre-publish automation identities,
  disclosed, not persons).

## Phase 4 — CI watch (observed, not asserted)

Push `d3515f7` (`fix(P009-R): CI adopts pinned identity`):
- `ci` run `45006644024` — **SUCCESS**: `verify (ubuntu-latest)` ✓ 42s,
  `verify (macos-latest)` ✓ 30s, `verify (windows-latest)` ✓ 1m20s.
  All 15 steps green on all three, including `cargo test --workspace`
  (the expected first genuine failure did NOT occur — MSVC is present
  on all CI images). https://github.com/oneatelier/project-one/actions/runs/45006644024
- `hygiene` run `45006643958` — **SUCCESS** after the pinned-identity
  fix. The initial hygiene run (`45006318241`) failed in 13s because
  the fresh checkout has no git identity configured — the fix makes CI
  adopt `.hygiene/identity.json` before scanning. No red remains.
  https://github.com/oneatelier/project-one/actions/runs/45006643958
- Dependabot is already active (setup-node 7.1.0 + checkout 7.0.1 PRs);
  its hygiene runs fail on the dependabot[bot] author as designed —
  follow-up policy decision, not a P009-R blocker (those PRs are not ours).
- Rule honored throughout: fix forward (`d3515f7`), re-watch to green,
  never claim unobserved runs.
- Scoreboard manual dispatch `45007127032` **failed as designed**: the bot's
  direct push was refused by branch protection ("4 of 4 required status
  checks are expected" — chicken-and-egg, since checks only run on push).
  Resolution (`9213018`): the workflow no longer commits; it uploads the
  scoreboard as a run artifact (`actions/upload-artifact` pinned
  `cf430e03…`), keeping `contents: read`. Re-dispatched as run
  `45007525795` — **SUCCESS**. The committed
  `artifacts/parity-scoreboard.md` stays the human-reviewed honest-empty
  baseline; nightly runs carry fresh evidence as artifacts.
  https://github.com/oneatelier/project-one/actions/runs/45007525795
- Branch protection applied via `gh api` (response verified): required
  checks `ci / verify (ubuntu-latest)`, `ci / verify (macos-latest)`,
  `ci / verify (windows-latest)`, `hygiene / hygiene` (strict, must pass);
  linear history required; force pushes and deletions blocked; no required
  reviews (would deadlock a solo maintainer — documented, not deferred
  lightly); no required signatures (key ceremony pending, per plan);
  `enforce_admins: false` so the owner can still push directly.
- README badges point at the live workflow runs
  (`actions/workflows/ci.yml/badge.svg`,
  `actions/workflows/hygiene.yml/badge.svg`).
Final verification pass (report commit `4188e8c`): `ci` run
[45007799144](https://github.com/oneatelier/project-one/actions/runs/45007799144)
— ubuntu ✓ 29s, macos ✓ 53s, windows ✓ 1m27s, all 15 steps green;
`hygiene` run
[45007799072](https://github.com/oneatelier/project-one/actions/runs/45007799072)
— SUCCESS. No red anywhere.

- Post-mapping commits (same org-voice identity, DCO-signed, TZ=UTC):
  `6161eb8` feat(P009-R: owner identity), `3d83f87` docs(P009-R:
  phase 1-3 outcome), `52a3285` fix(P009-R: brand-lint exemption),
  `d3515f7` fix(P009-R: CI identity adoption), `086590d`
  docs(P009-R: badges + green phase 4), `9213018` fix(P009-R:
  scoreboard uploads artifact). Final public root: 16 commits.

## Standing rules restated

- The Gmail address behind the account appears NOWHERE in tracked files,
  config, remote URL, or logs. The noreply address above is the only
  identity; `.mailmap` stays empty; TZ=UTC for this release line.
- No personal names, no home paths, no tokens anywhere in history.
  Verified by grep over every blob, not by assertion.

## Appendix — cargo test summary, ci run 45006644024 (push `d3515f7`)

- Run: https://github.com/oneatelier/project-one/actions/runs/45006644024 —
  SUCCESS (ubuntu ✓ 42s, macos ✓ 30s, windows ✓ 1m20s; all 15 steps green
  on all three, including `cargo test --workspace`).
- `cargo test --workspace` verbatim `test result` lines (all `ok`, 0 failed):
  - ubuntu: `test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out` (1 suite) + 8 × `test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`.
  - macos: `test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out` (1 suite) + 8 × `test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`.
  - windows: `test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out` (1 suite) + 8 × `test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`.
- The 6 passing tests (identical on all three OSes):
  `wire::tests::allowlist_gates_methods`, `events::tests::cumulative_ack_forgets_prefix`,
  `wire::tests::frames_round_trip`, `wire::tests::handshake_accepts_exact_match`,
  `wire::tests::handshake_refuses_each_mismatch`,
  `events::tests::overflow_spills_to_disk_instead_of_dropping`.
