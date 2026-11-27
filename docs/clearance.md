# Clearance record — "Shedu" (ABANDONED) and "Lamakore" (owner-confirmed; registries claimed, domain deferred)

- **Owner confirmation on record:** LAMAKORE (2026-11-24). Publisher stays
  One Atelier. Publisher mark (bull) unchanged; product mark separate.
- **Self-clearance disclaimer:** this file documents staff-level
  marketplace and registry checks only. It is **not a counsel opinion,
  not legal advice, and not a trademark search**. No USPTO/EUIPO/WIPO
  database search was performed here; formal search and any filing
  decision belong to counsel at entity formation (see §5 of the Shedu
  record and the Lamakore record below).

## Record A — "Shedu" (ABANDONED, owner ruling 2026-11-24)

- **Date of sweep:** 2026-11-24 (UTC)
- **Verdict:** **REJECTED — name abandoned per owner ruling 2026-11-24.**
  Live-product collisions in adjacent AI space (see §2, steps 1 and 4).
  No rename, no registry claim, no token flip, and no domain purchase was
  performed and none is authorized under this name. Registries reading
  free is recorded as **not sufficient** for clearance.

## 1. Decision

"Shedu" fails ADR-003 clearance step 1 (product search): the name is in
use by shipping products in the same field (AI agents/automation). The
four-step gate (ADR-003 §3) is ordered and conjunctive — a step-1 failure
blocks steps downstream. Concretely: no repo rename
(`oneatelier/project-one` → `oneatelier/shedu`), no npm/crates.io/PyPI
claims, no `branding.config.json` token flip, and no domain purchase was
performed. Owner ruling 2026-11-24 (§4): name abandoned. Nothing
in the tree was renamed; `clearance.publishBlocked` stays `true`.

## 2. Sweep evidence (ADR-003 §3 order)

| Step | Check (2026-11-24) | Finding |
|---|---|---|
| 1. Product search | Web search for shipping products named "Shedu" | **COLLISION.** `shedu.io` — live B2B product "Shedu builds AI systems that do real work under real governance" (workflow automation, governed AI execution, data protection), operated by **Wood Vault Inc. dba Shedu**, Terms effective 2026-03-01 asserting platform IP ownership. `shedu.app` — live AI product "Shedu — Multiply yourself. The second brain for the AI native" (agent memory/orchestration, waitlist onboarding). Both are adjacent to an agent desktop. Also active: Shedu Technology Group (`shedugroup.com`, fintech/ATM/aviation, Dubai — less adjacent, same name) and GitHub org `Shedu-ai` (owns `shedu-promotion-kernel`). |
| 2. Trademark search | USPTO / EUIPO / WIPO databases | **Pending — not performed here.** No counsel opinion is offered. Supporting fact for the block: the `shedu.io` operator publicly asserts IP ownership of its platform (Terms §10, © 2026 Wood Vault Inc. dba Shedu). A formal database search is required before any revisit. |
| 3. Phonetic / malware screen | Confusables, homoglyphs, malicious-package association | No exact-name package exists on npm, crates.io, or PyPI (all 404 on 2026-11-24 — also the malware-association negative). Etymology note: *shedu* (Akkadian protective spirit, cf. lamassu) is a dictionary/archaeology term, which cuts toward descriptiveness, not toward clearance. The step-1 collisions dominate regardless. |
| 4. Registries + domains | `npm shedu`, `crates.io shedu`, `PyPI shedu`; `shedu.dev` / `.app` / `.io` | Package names **appear unclaimed** (registry metadata 404 on all three, 2026-11-24; recheck at any future claim time — squat race possible). **All three domains taken:** `shedu.io` and `shedu.dev` serve the Wood Vault Inc product (DNS A records resolve; `.dev` serves identical Shedu content); `shedu.app` serves the second-brain product (DNS resolves). No domain purchase is possible on the brief's list; no alternative TLD was authorized. |

DNS confirmation (2026-11-24, host resolver): `shedu.io` → A 162.159.143.30,
172.66.3.26; `shedu.app` → A 104.21.34.109, 172.67.159.164; `shedu.dev` →
A 216.150.1.1 with live Shedu product content over HTTP.

## 3. Rejected-candidate table

Prior candidates from `artifacts/naming-matrix.csv` (all rejected
pre-clearance), plus the current proposal:

| Candidate | Verdict | Reason |
|---|---|---|
| Forge | rejected | Dictionary word, heavy dev-tool collision |
| Relay | rejected | Live product in adjacent automation space |
| Hearth | rejected | Phonetic overlap with an existing assistant mark |
| Anvil | rejected | Used by multiple build/security products |
| Northstar | rejected | Crowded navigation/analytics field |
| Porthole | rejected | Maritime marks cluster + weak CLI ergonomics |
| Workbench | rejected | Dominant editor feature association |
| Console | rejected | Generic, unregistrable |
| Pilot | rejected | Aviation marks + existing AI products |
| Sidekick | rejected | Existing assistant/companion-app marks |
| **Shedu** | **rejected — abandoned (owner ruling 2026-11-24)** | **Live adjacent products in our space on all three brief domains: `shedu.io` + `shedu.dev` = Wood Vault Inc (asserts platform IP); `shedu.app` = AI second-brain; all three domains taken. Registries reading free held NOT sufficient. Fails step 1.** |

## 4. Owner ruling 2026-11-24 (this section closed)

**Abandon "Shedu" — taken.** Rejection recorded with evidence: `shedu.io`
+ `shedu.dev` = Wood Vault Inc (asserts platform IP); `shedu.app` = AI
second-brain; all three domains taken; live adjacent products in our
space. Registries reading free explicitly held NOT sufficient. No rename,
no claim, no token flip, no purchase was performed under this name.

Re-entry path for the next candidate: return through the naming matrix
plus this same four-step sweep, with fresh evidence in a new clearance
record. Retained for future candidates (not this one): counsel review
(formal USPTO/EUIPO/WIPO search + recorded opinion) before any mutation,
and written owner risk-acceptance with contingency named — counsel review
still required before any filing or paid spend.

Until a future candidate clears, `clearance.publishBlocked` stays
`true`, no repo rename, no registry claims, no token flip, no domain buy.

## 5. Trademark filing (deferred)

Filing is **deferred to entity formation** (recorded 2026-11-24); no
application exists and none is authorized by this record. House rule from
the brief, recorded here: use **™** (unregistered claim of use) where a
mark is asserted, **never ®** before an actual registration. This section
does not assert any mark — it only records the deferral.

## 6. Registry/domain ledger (for the record, not claims)

| Name | Status 2026-11-24 | Evidence |
|---|---|---|
| npm `shedu` | appears unclaimed (404) | `https://registry.npmjs.org/shedu` → 404 |
| crates.io `shedu` | appears unclaimed (404) | `https://crates.io/api/v1/crates/shedu` → 404 |
| PyPI `shedu` | appears unclaimed (404) | `https://pypi.org/pypi/shedu/json` → 404 |
| `shedu.dev` | TAKEN (live product) | DNS + HTTP content = Wood Vault Inc Shedu |
| `shedu.app` | TAKEN (live product) | DNS + live second-brain site |
| `shedu.io` | TAKEN (live product) | DNS + live Wood Vault Inc site |

No registry publish was performed, no transaction exists, no txid to record.
The task STOP condition ("registry name actually taken at claim time")
was not met by the letter (registries read free), but step-1 collision
halted the claim flow first — claiming a colliding name to squat-proof it
would itself create the conflict the sweep exists to prevent.

---

## Record B — "Lamakore" (current candidate, owner-confirmed 2026-11-24)

- **Date of sweep:** 2026-11-24 (UTC). Re-verified same-day per P021-R
  (strategist pre-verification noted, independently re-checked below).
- **Verdict:** **NO BLOCKING COLLISION FOUND — proceed with flags.**
  No live product named Lamakore; registries read free; domains show no
  DNS; bare GitHub handle free. Near-miss trademark records (AKORE Cl.9,
  LACORE Cl.42) and an adjacent-field Lamalo product are recorded below
  for counsel — they are flags, not blocks. Formal USPTO/EUIPO/WIPO
  search remains pending (no counsel, no direct DB access from here).

### Four-step sweep (ADR-003 §3), Lamakore, 2026-11-24

| Step | Check | Finding |
|---|---|---|
| 1. Live product | Web search for shipping products named "Lamakore" | **None found.** Results are near-misses only: Lalakorea (Korean ampoule exporter), LAMKO (Korean materials), Lamarka (venture studio), LAMAKSKO (Macedonian retail), LaminaCore (UK magnetics), Lamark Biotech, LAMACO machinery, Makora (renamed Mako), Lamak (Balinese ritual object). **Adjacent-field note:** Lamalo (French sovereign AI engine, +200 models/agents/tools) — different mark, same neighborhood; reviewed, not a collision; counsel to confirm. |
| 2. Trademark 9/42 (web layer) | Web-visible USPTO records for LAMAKORE | **None found.** Surfaced near-misses, all recorded for counsel: **AKORE** — two LIVE Class 9 marks (Reg. 3893849, 3609970, Innovative Software Solutions, CRM software; "Lamakore" embeds the string "akore"); **LACORE CONNECT** (Reg. 7038339) + **LACORE LABS** (Regs. 6827745/6820877/6820876) — LaCore Enterprises, Class 35/42 incl. SaaS facility-management software ("Lamakore" shares la+core/kore sounds; LACORE CONNECT is same-class SaaS). LAMAKE (Cl.11 lighting) and LAMORE (abandoned, cosmetics) reviewed as non-conflicting. Formal USPTO/EUIPO/WIPO database search **pending** — no counsel opinion offered here. |
| 3. Phonetic / malware | Confusables; malicious packages under the exact name | No exact-name package exists on npm, crates.io, or PyPI (all 404 below) → no known-malicious exact-name package. Confusables reviewed in step 2; Lamalo/Akore/Lacore are distinct marks (counsel confirms). |
| 4. Registries + domains + handle | npm/crates.io/PyPI metadata; DNS A for .dev/.app/.io; api.github.com handle | **npm `lamakore`: 404 (free). crates.io `lamakore`: 404 (free). PyPI `lamakore`: 404 (free).** `lamakore.dev` / `.app` / `.io`: **no DNS A records** (likely free; registrar to confirm at purchase). **GitHub bare handle `lamakore`: 404 (free)** — neither user nor org holds it. **Claimed nothing in this sweep** (read-only). |

### Rejected-candidate table (prior names + P021 backups)

| Candidate | Verdict | Basis |
|---|---|---|
| Forge | rejected | Dictionary word, heavy dev-tool collision (naming matrix) |
| Relay | rejected | Live product in adjacent automation space (naming matrix) |
| Hearth | rejected | Phonetic overlap with an existing assistant mark (naming matrix) |
| Anvil | rejected | Used by multiple build/security products (naming matrix) |
| Northstar | rejected | Crowded navigation/analytics field (naming matrix) |
| Porthole | rejected | Maritime marks cluster + weak CLI ergonomics (naming matrix) |
| Workbench | rejected | Dominant editor feature association (naming matrix) |
| Console | rejected | Generic, unregistrable (naming matrix) |
| Pilot | rejected | Aviation marks + existing AI products (naming matrix) |
| Sidekick | rejected | Existing assistant/companion-app marks (naming matrix) |
| Shedu | rejected — abandoned (owner ruling 2026-11-24) | Live adjacent products on all three brief domains (`shedu.io` + `shedu.dev` Wood Vault Inc, asserts platform IP; `shedu.app` AI second-brain); all three domains taken. Record A above. |
| Shedux | rejected | Prior owner/strategist record; no independent sweep in this tree |
| Aladex | rejected | Prior owner/strategist record; no independent sweep in this tree |
| Ziggurax | rejected | Prior owner/strategist record; no independent sweep in this tree |
| Barghest | rejected (P021 sweep 2026-11-24 — live-product HIT) | **BARGHEST (barghest.asia)**: UK non-profit, open-source forensic tools for civil society (WARD, MESHforensics), vuln research. Live open-source software org = same broad market. Registries 404 (free) and domains dark — irrelevant given the live org. GitHub `Barghest` user taken (2025, empty). |
| Aladynx | backup (not cleared, not swept) | Prior owner/strategist record only |
| Fossegrim | backup (P021 sweep 2026-11-24 — product-clean, handle taken) | No shipping software product (folklore + RPG/game references only). Registries 404, domains dark. **GitHub `fossegrim` org handle occupied** (renamed-away 2021 org, 0 repos). Formal TM search pending. Usable only with a handle variant + counsel sign-off. |

### Claims + domain ledger (Lamakore — pending owner credentials)

| Item | Status 2026-11-24 | Evidence / next command |
|---|---|---|
| npm `lamakore` 0.0.0 name reservation | **BLOCKED — no npm auth** (`npm publish` → ENEEDAUTH; dry-run valid). Owner: `npm login` (oneatelier), then `npm publish` from a prepared scratch dir (TEMP, removed). URL on success: `https://www.npmjs.com/package/lamakore`. | dry-run ok; auth error logged |
| crates.io `lamakore` 0.0.0 | **BLOCKED — no token** (`cargo publish` → "no token found, run `cargo login`"). Owner: `cargo login <token>`, then `cargo publish`. URL on success: `https://crates.io/crates/lamakore`. | dry-run verify ok; token error logged |
| PyPI `lamakore` 0.0.0 | **BLOCKED — no twine, no `~/.pypirc`, no API token.** Owner: install twine, set API token, `twine upload`. URL on success: `https://pypi.org/project/lamakore/`. | toolchain + creds absent |
| Domain (ONE of `.dev`/`.app`/`.io`) | **BLOCKED — no registrar access/payment.** All three show no DNS (likely free); registrar to confirm at purchase. Forward `hello@<domain>` to the hidden Gmail at purchase. | DNS-negative 2026-11-24 |

No txids exist. Claim flow stopped at authentication/payment — all three
stops are owner-action, none is a sweep collision.

### P028 verification + publishBlocked flip (2026-11-26, UTC)

Owner claimed all three registries on 2026-11-25 (verified below). The
paid domain lamakore.dev and mail forwarding were NOT claimed — owner
ruling 2026-11-24: no-spend, Cloudflare Pages home, paid domain
deferred (D8).

*Correction 2026-11-27: the original opening sentence overstated the
owner claim (it listed the paid domain and mail forwarding as claimed).
Only the three registries were claimed and verified; domain and mail
were and remain unclaimed — recorded as such in the table below.*

| Item | Status 2026-11-26 | Evidence |
|---|---|---|
| npm `lamakore` | **CLAIMED, owner-held.** Package page 200; registry metadata: maintainer `oneatelier`, created 2026-11-24, version 0.0.0, "Reserved name for Lamakore…". | registry API 2026-11-25 |
| crates.io `lamakore` | **CLAIMED.** Crate page 200, created 2026-11-24, same reservation description. | API with UA header 2026-11-25 |
| PyPI `lamakore` | **CLAIMED.** Project page 200, created 2026-11-24. | JSON API 2026-11-25 |
| `lamakore.dev` | **DARK.** NXDOMAIN on host resolver AND Google 8.8.8.8 (2026-11-25 and 2026-11-26). No receipt/txid was ever provided, so nothing to record. | `nslookup` both resolvers |
| `hello@` / `security@` forwarding | **NOT verified — treated as not live.** Mailbox receipt cannot be demonstrated from here; owner claim alone is not evidence. Consequence: no `security@` address is published anywhere (the P028 site omits it by rule); private channel stays GitHub PVR only. | claim only, no mailbox proof |

No squat on any name (triad dates + descriptions agree; npm authorship
is owner-held). The 2026-11-24 STOP is lifted **for registries only**;
the domain/email half stays STOPped.

**Flip (this section is the record):** `clearance.publishBlocked`
`true` → **`false`** (`branding.config.json` + regenerated
`packages/branding/src/generated.ts` + `crates/core-protocol/src/brand.rs`,
P028 docs commit). Gate, all four inputs evidenced: (1) registries
claimed — table above; (2) Pages live —
`https://lamakore.pages.dev` 200 with authored headers (report-P028
§4); (3) P026 CI green — the P025 merge: main head `c65eca3`, ci
`45579403164` + hygiene `45579403398`, all success (report-FIXBATCH
§4; P026 gate evidence); (4) owner sign-off LAMAKORE
2026-11-24 (top of this file). Formal trademark search still pending
(TM only, never (R) — §5 stands).
**Known follow-ups (claims flow, not this batch):** README "What this
is not" corrected in P029 (registry/domain half rewritten to the flip
state); remaining: `security@` mailbox end-to-end proof; registrar
receipt for `lamakore.dev`.

### publishBlocked gate (Lamakore)

`clearance.publishBlocked` stays **`true`**. Flip requires ALL of: B
sweep with no blocking collision (this record — near-miss flags to
counsel noted) AND rename landed (P020-R, merged 2026-11-24) AND
registries + ONE domain claimed (pending above) AND CI green AND owner
sign-off (LAMAKORE, 2026-11-24 — recorded). Self-clearance only; formal
TM search deferred to entity formation; (tm) now, never (R) before
registration.

- **Status 2026-11-24 (post-rename):** repo renamed to
  `oneatelier/lamakore` (redirect verified); Lamakore live on all living
  surfaces. Claims + domain still pending owner credentials/payment;
  `publishBlocked` stays `true`. Sweep tables above unchanged.
- **Superseded 2026-11-26:** gate amended by owner ruling 2026-11-24
  (Cloudflare Pages home + GitHub PVR replace the paid domain as the
  publish path); flip executed 2026-11-26, see the P028 verification
  section above. Historical text above retained verbatim.
