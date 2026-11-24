# Identity & OPSEC Guide

Anonymity here is a CI-enforced invariant, not a manual habit. This guide
is the human half; `scripts/hygiene/` is the machine half. Both must agree.

## 1. The rule

The Owner's real identity never enters this repository — not in code,
paths, metadata, commit authorship, or fixtures. The repository speaks
only in the org voice:

- `user.name = "Lamakore Maintainers"` (repo-local, never `--global`)
- `user.email` = the exact address pinned in `.hygiene/identity.json`
  (currently `359786796+oneatelier@users.noreply.github.com`). No other
  author or committer identity is accepted — the pre-commit hook enforces
  an exact match, not just a noreply shape.
- `.mailmap` stays empty by policy (see ADR-004).

## 1b. Canonical handles (One Atelier voice, everywhere)

| Surface | Handle | Notes |
|---|---|---|
| GitHub | `oneatelier` (org) | Sole code home; `git@github.com:oneatelier/...` never a personal fork |
| X | `one_atelier_` | Bio links `github.com/oneatelier`; see watchlist below |
| Reddit | `u/oneatelier` | Announcements only, no support DMs |
| Bluesky | `oneatelier.bsky.social` | Mirror of release notes |

No other handle speaks for the project. A new surface gets a row here
first (docs PR), then a bio link back — never the reverse.

## 1c. Hidden-Gmail rule (restated)

Exactly one non-noreply address exists in operations: a hidden Gmail
that receives `hello@<domain>` forwards and GitHub security mail. It
never appears in code, docs, commit metadata, or fixtures; it is not a
commit author or committer anywhere. Any Gmail address anywhere else in
the tree or in commit metadata is a finding (L1 if staged, L2/L3 per
§5), and the pre-commit hook blocks `@gmail.com` committer identities
at commit time.

## 1d. ACCEPTED-RISK: pre-flip Gmail in committer metadata

Early history (pre-identity-baseline) carries a pseudonymous Gmail
(`oneatelier17@gmail.com`) in author/committer metadata on a small
number of commits. This is accepted as-is: history is immutable, no
rewrite (rewriting signed history would destroy the evidence chain the
hygiene system exists to protect — see ADR-004). Mitigations in force:
the pinned-identity hook blocks any NEW non-noreply identity, and
owner-side GitHub settings (no personal emails on the org profile,
noreply enforcement) prevent recurrence. Revisit only if the address is
abused for impersonation (then L3: rotate, disclose, do not rewrite).

## 2. Dedicated OS user

Work on this project under a dedicated OS account (e.g. `lamakore-dev`).
That account holds no personal logins: no personal email, no personal
GitHub session, no personal cloud drives. The project checkout lives
under that account's home so a stray absolute path leaks nothing
identifying. `scan-paths.mjs` rejects `C:\Users\<you>`, `/Users/<you>`,
and `/home/<you>` with a real username component; angle-bracket
Angle-bracket stand-ins like these are ignored by design, so use them in examples.

## 3. Media capture in a fixture VM

Screenshots, screen recordings, and sample photos are captured inside a
fixture VM whose OS username is `fixture`, timezone UTC, locale `en-US`.
Before any image or PDF enters the tree, `scan-metadata.mjs` must pass:
no EXIF/XMP GPS, Author, Software, or CreatorTool tags; no PDF Author or
Creator entries. Strip with `exiftool -all= --icc_profile:all` and
re-verify. Video containers cannot be verified and are rejected outright.

## 4. Key ceremony checklist (Owner)

Signing and publishing credentials come from a single Owner ceremony:

1. Offline medium prepared (air-gapped machine or live USB, networking off).
2. Diceware passphrase generated (7+ words, written on paper, never typed
   into a networked host).
3. Two hardware keys initialized (primary + backup, stored apart).
4. Commit signing key created; `commit.gpgsign` stays deferred until this
   step is done (currently recorded as pending).
5. Verify by signing a test artifact and checking the signature from a
   second machine before the keys touch the repo.

Until the ceremony completes, no release is cut and no publish-blocking
flag is lifted.

## 4b. Brand watchlist (impersonation)

- X `@one_atelier` (no trailing underscore) is held by an unknown
  party; our canonical X handle is `one_atelier_` (with underscore) per
  §1b — watch the bare handle for impersonation once we post publicly. Check on every release: search X,
  Reddit, and PyPI/npm/crates.io for the product name; record hits in
  `docs/clearance.md`.
- Any impersonating account or package is L3 (treat as compromised
  trust surface): document, report to the platform, warn users from a
  canonical handle. Never engage from a personal account.

## 5. Leak-response playbook
- **L1 — staged but uncommitted:** unstage, clean the file, re-run
  `node scripts/hygiene/run-all.mjs --staged`. No history exists; no
  further action.
- **L2 — committed locally, not pushed:** remove the material in a new
  commit (never amend shared history silently), record the incident in
  the next report, rotate any exposed credential.
- **L3 — pushed or otherwise public:** treat as compromised. Rotate
  credentials immediately, rewrite the public branch only with an ADR
  recording why, notify downstream mirrors, and file the post-mortem.
  Speed beats tidiness at L3.
