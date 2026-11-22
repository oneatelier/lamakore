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

(Full 40-char SHAs recorded in the push transcript below; abbreviated
here. All SHAs changed because the root blob changed — expected.)

## Phase 3 — Publish (junk root replaced, never merged)

- Remote added (no fetch, no merge, no rebase — per instruction).
- Pre-push verification: working tree clean, hook green, full gate chain
  green on the exact bytes being pushed.
- Push command: `git push -u origin main --force` — replaces `2d1b9dd`
  (junk README-only root) with the scrubbed 10-commit history.
- Commit identity on the wire: org voice + numeric noreply (new commits
  only; history authors untouched — pre-publish automation identities,
  disclosed, not persons).

### Phase 3 outcome: BLOCKED on remote authorization (no repo changes made)

The push authenticates (Git Credential Manager engages a stored
`github.com` credential) but GitHub answers **HTTP 403: the
authenticated account lacks write access** to `oneatelier/project-one`.
This is an authorization problem, not an authentication or history
problem: the local history is verified-clean and push-ready.

Owner action required (any one):
1. Grant the authenticated account write access to the repo (collaborator
   with Write, or org membership with repository access), or
2. Re-authenticate GCM with an account/token that has `contents:write`
   (fine-grained PAT needs Contents: read+write on this repo; classic
   PAT needs the `repo` scope), then tell me to retry the identical
   command above.
3. If SSO enforcement applies to `oneatelier`, authorize the token/SSO
   session for the org.

On retry I will re-run the pre-push gate chain first (nothing ships
without a green tree), then push `--force` as instructed.

## Phase 4 — CI watch (filled after the push)

- Pending: `ci.yml` (3 OS jobs) + `hygiene.yml` run URLs and conclusions.
- Expected first genuine failure: `cargo test` (see report-P008 toolchain notes).
- Rule: fix forward, never mark green without an observed green run.
- Then: README badges → real workflow badges; branch protection per
  `docs/guides/branch-protection.md` (exact required checks listed there).

## Standing rules restated

- The Gmail address behind the account appears NOWHERE in tracked files,
  config, remote URL, or logs. The noreply address above is the only
  identity; `.mailmap` stays empty; TZ=UTC for this release line.
- No personal names, no home paths, no tokens anywhere in history.
  Verified by grep over every blob, not by assertion.
