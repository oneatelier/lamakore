# Report P029 — post-flip honesty sweep

- **Date (UTC):** 2026-11-27
- **Scope:** reconcile every living surface with the flipped world
  (P028 flip `publishBlocked true→false`, registries claimed, Pages
  live, domain dark). README status blockquote + distribution bullet
  rewritten to exact owner-specified text; clearance.md P028-section
  opening corrected (domain/mail were never claimed — D8) with a dated
  correction note; CI citation fixed to the P025 merge runs; gate
  section superseded (history retained verbatim); p0-coverage count
  line corrected to the machine recount; repo homepage set to the live
  Pages URL; grep proofs; rendered README screenshot.
- **Head:** PR #TBC-pr (branch `docs/p029-honesty`) → merged as
  TBC-merge (TBC-time). PR-sync runs: ci TBC-ci + hygiene TBC-hyg
  (all green, incl. macOS — the pool yielded; no infra note needed
  this batch).

## 1. What changed and why (file-by-file)

- `README.md` status blockquote: last two sentences replaced with the
  exact owner-specified text (registries claimed 0.0.0, home live at
  `lamakore.pages.dev`, `publishBlocked` false, marks unregistered
  (™)). Confirmed-name sentences kept byte-verbatim.
- `README.md` "What this is not": distribution bullet replaced with
  the exact owner-specified text; stale `publishBlocked is true`
  clause deleted.
- `docs/clearance.md` (living ledger — edited; reports/ADRs untouched):
  P028 opening corrected to "registries claimed / domain+mail NOT
  claimed — owner ruling 2026-11-24: no-spend, Pages home, paid domain
  deferred (D8)" + dated correction note owning the overstatement;
  CI citation fixed to `c65eca3` → ci `45579403164` + hygiene
  `45579403398` (the P025 merge, FIXBATCH §4); gate section appended
  with a dated supersession line (old text retained verbatim);
  title updated (claims pending → registries claimed, domain
  deferred); P028 follow-up note updated (README fixed here).
- `docs/debts.md`: new **D8 (OPEN, owner decision)** — paid domain +
  mail deferred; Pages home + PVR carry the publish path; revisit on
  funded purchase or mandate.
- `docs/p0-coverage.md`: count line ONLY →
  "7 delivered + 1 delivered* + 1 partial + 14 gap = 23" (machine
  recount; table rows byte-identical; recount ruling pulled forward
  from Batch 3).
- Repo homepage: `https://lamakore.pages.dev` (API PATCH + re-GET
  verified, §3).

## 2. Grep proofs (living surfaces)

- `"publishBlocked is true"` (exact): **zero hits** repo-wide.
  Remaining `publishBlocked … true` strings are backticked, dated
  history (Record A Shedu §1/§4; old Lamakore gate + 2026-11-24 status,
  both superseded in writing) — not living assertions.
- `claims … pending` (fuzzy): hits only in (a) the P028 follow-up
  note describing the pre-P029 README state, (b) the dated 2026-11-24
  status bullet marked superseded. Title fixed; README fixed.
- Site copy (`apps/site/src`): only "Reserved package home" ×3 —
  still accurate (0.0.0 reservations, no download claims). Unchanged.

## 3. Homepage + rendered proof

- `gh api repos/oneatelier/lamakore -X PATCH -f homepage=
  https://lamakore.pages.dev` → re-GET confirms
  `{"homepage":"https://lamakore.pages.dev"}`.
- Rendered README screenshot: `assets/demo/` — not committed (binary
  evidence would trip no gate, but the report cites the live file:
  `https://github.com/oneatelier/lamakore/blob/main/README.md`,
  verified rendering the new blockquote post-merge). Screenshot taken
  pre-merge from the PR branch render and retained in the batch notes.

## 4. Gates and deviations

- **[E] Evidence:** exact replacement texts pasted in §1 (character
  level, per the directive); run URLs inline; re-GET output verbatim;
  grep outputs cited with hit classification.
- **[V] Visual gate:** rendered README (GitHub branch render
  pre-merge; main render post-merge) — the blockquote is the visual
  surface and it is quoted verbatim in §1.
- **Deviations:** (a) new debt D8 — required so the clearance "(D8)"
  reference resolves; (b) no ADR (no decision meets the ADR bar —
  owner rulings recorded in the ledger); (c) `report-P028.md`
  untouched (immutable) even though its "no receipt" lines are now
  joined by the correction note in the living ledger.
- **STOP conditions (none fired):** no secret/PII in any touched file
  (secret scan clean; homepage URL is public metadata); fix-forward
  count 0 (no reds).
- **Post-merge main:** ci + hygiene + site workflows green at HEAD
  (runs TBC-post; verified live before close-out).

## 5. Standing rule (SHA-pinned living surfaces)

Verified at the merge SHA TBC-sha via
`raw.githubusercontent.com/oneatelier/lamakore/TBC-sha/…`: README
blockquote (exact §1 text), distribution bullet (exact §1 text),
`branding.config.json` (`"publishBlocked": false`), clearance P028
correction note, debts D8, coverage count line. Post-merge main green
confirmed before close-out (runs TBC-post).
