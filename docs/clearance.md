# Clearance record — proposed name "Shedu" (token `shedu`)

- **Date of sweep:** 2026-11-24 (UTC)
- **Verdict:** **REJECTED — name abandoned per owner ruling 2026-11-24.**
  Live-product collisions in adjacent AI space (see §2, steps 1 and 4).
  No rename, no registry claim, no token flip, and no domain purchase was
  performed and none is authorized under this name. Registries reading
  free is recorded as **not sufficient** for clearance.
- **Self-clearance disclaimer:** this file documents staff-level
  marketplace and registry checks only. It is **not a counsel opinion,
  not legal advice, and not a trademark search**. No USPTO/EUIPO/WIPO
  database search was performed here; a formal search and any filing
  decision belong to counsel at entity formation (see §5).

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
