# Identity & OPSEC Guide

Anonymity here is a CI-enforced invariant, not a manual habit. This guide
is the human half; `scripts/hygiene/` is the machine half. Both must agree.

## 1. The rule

The Owner's real identity never enters this repository — not in code,
paths, metadata, commit authorship, or fixtures. The repository speaks
only in the org voice:

- `user.name = "PROJECT ONE Maintainers"` (repo-local, never `--global`)
- `user.email` = the exact address pinned in `.hygiene/identity.json`
  (currently `359786796+oneatelier@users.noreply.github.com`). No other
  author or committer identity is accepted — the pre-commit hook enforces
  an exact match, not just a noreply shape.
- `.mailmap` stays empty by policy (see ADR-004).

## 2. Dedicated OS user

Work on this project under a dedicated OS account (e.g. `pone-dev`).
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
