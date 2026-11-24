# Report P020 — rename clearance sweep for "Shedu": STOP, name blocked

- **Date (UTC):** 2026-11-24
- **Scope:** P020 rename/clearance flow for confirmed name "Shedu"
  (publisher: One Atelier). Sweep per ADR-003 §3, then the rename,
  registry, token-flip, domain, and PR steps — in that order.
- **Head:** `f482614` on `feat/p013-sandbox` + working tree (prior batch
  work still uncommitted; this report and `docs/clearance.md` only).

## 1. Commands run (all read-only; exit 0 unless noted)

- `GET https://registry.npmjs.org/shedu` → **404** (name never published)
- `GET https://crates.io/api/v1/crates/shedu` → **404** (no such crate)
- `GET https://pypi.org/pypi/shedu/json` → **404** (no such project)
- `Resolve-DnsName shedu.io/.app/.dev` → all resolve (see §2)
- `GET http://shedu.dev` → serves Wood Vault Inc "Shedu" product content
- Web product search "Shedu trademark product software" → live collisions
- `git status`, `gh auth status` (repo `oneatelier/project-one`,
  logged in as `oneatelier`), branding/ADR/naming-matrix reads

No write commands were issued: no `gh repo rename`, no `npm/cargo/pypi
publish`, no domain purchase, no token flip, no branch, no PR.

## 2. Findings (detail in `docs/clearance.md`)

1. **Product search fails the gate.** `shedu.io` is a live B2B AI
   automation/governance product (Wood Vault Inc. dba Shedu, Terms
   2026-03-01 claiming platform IP); `shedu.app` is a live AI
   second-brain/memory product on a waitlist. Both sit in our field.
   Supporting same-name activity: Shedu Technology Group (fintech/ATM,
   Dubai) and GitHub org `Shedu-ai`.
2. **Domains: 3/3 taken.** `shedu.dev` and `shedu.io` serve the Wood Vault
   product; `shedu.app` serves the second-brain product. The brief's
   buy-one-of-three step has no available target.
3. **Registries: 3/3 read free** (404s above) — but unclaimed is not
   cleared, and claiming a colliding name to squat-proof it would create
   the conflict the sweep exists to prevent.
4. **Formal trademark databases unsearched** (no counsel, no API key);
   recorded as pending, not as passed.

## 3. STOP evaluation

- **Task STOP ("registry name actually taken at claim time"): not met by
  the letter** — the registries read free, and no claim was attempted.
- **Clearance STOP (triggered):** ADR-003's gate is ordered and
  conjunctive; the step-1 live-product collision blocks everything
  downstream. I halted before all irreversible or public steps: no repo
  rename (redirects would still advertise the collision), no registry
  publishes (no txids exist), no `branding.config.json` flip
  (`productName`/`codeToken`/`cliBinary`/`daemonBinary`/`configDirName`
  untouched), `clearance.publishBlocked` stays `true`, no domain order,
  no `p020/rename` branch, no PR. The "NAME CONFIRMED" premise is
  contradicted by the sweep evidence above; the contradiction is
  recorded, not overridden.
- **Trademark filing:** stays deferred to entity formation (clearance §5);
  ™/® house rule recorded; no filing, no opinion offered.

## 4. Gates and deviations

- **[E] Evidence gate:** machine-checkable outputs above (HTTP 404s, DNS A
  records, fetched page content naming the operator, dated search
  results). Formal DB search is the known evidence gap, stated openly.
- **[V] Visual gate:** deferred — no visual surface (no rename landed;
  social preview, `assets/brand/`, profile README, and badges intentionally
  untouched; several of those paths do not exist in this tree).
- **Deviations:** (a) No PR flow was executed — there is nothing to merge
  (only `docs/clearance.md` + this report were written; both are new,
  untracked, and consistent with the halt). (b) Report numbering: P020 is
  the rename prompt's own number, used here for the clearance outcome
  rather than a completed rename. (c) `scan-author` correctly untouched
  (identity is org voice, independent of product name).

## 5. Next step (owner ruling recorded 2026-11-24: abandon "Shedu")

Per `docs/clearance.md` §4 the name is rejected and no mutations were
performed under it. Re-entry is a new candidate through matrix + sweep.
CI was not re-run for this report: no code changed, and the Batch 2
matrix stands.
