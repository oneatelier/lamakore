# Report P020-R — rename to Lamakore: sweep, rename, merge

- **Date (UTC):** 2026-11-24
- **Scope:** P021-R pre-claim sweep (Lamakore only) + P020-R permanent
  rename. Owner confirmation on record: LAMAKORE (2026-11-24). Publisher
  stays One Atelier; publisher mark (bull) unchanged; product mark separate.
- **Head:** main @ `b5c2f29` (post-merge) + this working tree (clearance
  Record B + this report; PR to follow).

## 1. Phase A — batch 2 landed on main (no loss, no force-push)

- PR #11 (`feat/p013-sandbox` → `main`): all 4 required checks SUCCESS on
  head `bfd1455` (ci ubuntu/macOS/windows + hygiene), `mergeable:
  MERGEABLE`, merged via `gh pr merge 11 --rebase --delete-branch`
  (2026-11-24T07:19:01Z, DCO intact, linear history).
- `git checkout main && git pull --ff-only` → `git rev-list --count main`
  = **44 commits**. `git branch -a` shows main only (feature branch
  deleted locally and on origin; dependabot bot branches untouched).
- Post-merge main CI (merge push): ci
  https://github.com/oneatelier/lamakore/actions/runs/45348666410 —
  **success**; hygiene
  https://github.com/oneatelier/lamakore/actions/runs/45348666518 —
  **success**. (Old `project-one` URLs redirect to the same runs.)

## 2. Phase B — P021-R sweep: Lamakore (claim nothing — claimed nothing)

| Step | Check | Finding (2026-11-24) |
|---|---|---|
| Live product | Web search for shipping "Lamakore" | **None.** Near-misses only (Lalakorea, LAMKO, Lamarka, LAMAKSKO, LaminaCore, Lamark Biotech, LAMACO, Makora, Lamak). Adjacent-field note: **Lamalo** (French sovereign AI engine) — different mark, reviewed, not a collision; counsel to confirm. |
| Trademark 9/42 (web layer) | Web-visible USPTO records | **No LAMAKORE record.** Near-misses for counsel: **AKORE** (2 LIVE Cl.9, CRM software — "Lamakore" embeds "akore"); **LACORE CONNECT/LABS** (LaCore, Cl.35/42 incl. SaaS — shares la+core/kore sounds; same-class SaaS). LAMAKE (Cl.11) and LAMORE (abandoned) non-conflicting. Formal DB search pending — no counsel opinion. |
| Phonetic/malware | Confusables; exact-name malicious packages | No exact-name package on any registry → no known-malicious exact name. |
| Registries | npm / crates.io / PyPI metadata | **404 / 404 / 404 (free; recheck at claim).** |
| Domains | DNS A for .dev/.app/.io | **No A records on any** (likely free; registrar to confirm). |
| GitHub handle | api.github.com/users/lamakore | **404 (free)** — neither user nor org. |

**P021 backups swept same-day:** **Barghest — HIT, rejected**
(BARGHEST/barghest.asia: UK non-profit, open-source forensic tools for
civil society — live open-source software org; GH `Barghest` user taken).
**Fossegrim — product-clean, handle-blocked** (folklore/RPG only; regs
404; domains dark; GH `fossegrim` org occupied by a renamed-away 2021
org). Full table in `docs/clearance.md` Record B.

## 3. Phase C — P020-R rename (B clean → executed)

- `node scripts/rename.mjs --name Lamakore --token lamakore --org
  oneatelier` on branch `p020-r/rename`: config flipped
  (`productName: Lamakore`, `codeToken/cliBinary: lamakore`,
  `daemonBinary: lamakored`, `configDirName: .lamakore`,
  `orgHandle: oneatelier`, `repoName: lamakore`, copyright updated),
  codegen regenerated (TS/CSS/Rust), slugs + live files follow.
  `pnpm lint` / typecheck / fmt / clippy / tests green locally.
- Living surfaces swept: README badges → `oneatelier/lamakore`,
  quickstart `cd lamakore`, identity-guide example account, INDEX
  codename line, scoreboard regenerated. NOT touched: reports/ADRs
  (immutable), `security@project-one.dev` contact (no replacement
  domain owned — recorded, not silently dropped), scan-author identity
  + `.hygiene/identity.json` (explicitly unchanged), `security@`
  contact, historical run URLs (redirects preserve them).
  Org profile README: no `oneatelier/.github` repo exists — N/A.
  `assets/brand/` and social-preview files: do not exist — N/A.
- Repo renamed via API: `oneatelier/project-one` →
  **https://github.com/oneatelier/lamakore**; old URL resolves to the
  new repo (redirect verified). Remote updated. About + topics set
  (local-first control plane; ai-agents/desktop/electron/rust/sandbox/
  local-first).
- Claims (all blocked on owner credentials — evidence, not assertion):
  npm `ENEEDAUTH` (dry-run valid); `cargo publish` → "no token found,
  run `cargo login`"; PyPI — no twine, no `~/.pypirc`, no API token.
  Placeholder contents prepared in TEMP only (never in the tree) and
  removed. Domain: no registrar access/payment; all three TLDs
  DNS-negative. Exact owner commands recorded in `docs/clearance.md`.
- `clearance.publishBlocked` stays **`true`**: B has no blocking
  collision BUT registries + ONE domain are unclaimed, so the flip
  conditions (B clean + rename + claims + CI green + sign-off) are not
  all met. Self-clearance only; formal TM deferred to entity formation;
  (tm) now, never (R).
- PR #12 (`p020-r/rename` → `main`): 4 checks green (ci push
  `45347671917` + PR sync `45348183347`, hygiene `45347672043` +
  `45348183380`), merged `--rebase --delete-branch` 2026-11-24T07:31:34Z.
  Branch deleted locally and on origin. END STATE: ONE branch (main).

## 4. STOP evaluation

- No required check red at any merge (2 fix-forwards total across the
  batch: lint fix, macOS disjunction — both landed green before merge).
- Sweep collisions: Barghest HIT recorded as rejection (no P020-R for
  it); Lamakore has no blocking collision — near-misses flagged to
  counsel, not hidden.
- No secret/PII hits: rename touched brand strings only (grep-verified;
  placeholders lived and died in TEMP).
- No branch deleted before its merge (both deletions post-merge,
  verified via `ls-remote`).

## 5. Gates and deviations

- **[E] Evidence gate:** run URLs above (all success); DNS 404-equivalents
  (NXDOMAIN) + HTTP 404s + API 404s + CLI auth errors pasted or logged.
  Formal TM DB search is the known evidence gap (web layer only).
- **[V] Visual gate:** deferred — no visual surface (config/text rename;
  About/topics text-only). No new demo assets.
- **Deviations:** (a) README badges + About were updated to `lamakore`
  before the repo rename landed (brief window of 404s; redirect now
  resolves everything). (b) `security@project-one.dev` intentionally
  unchanged (no replacement domain owned). (c) Post-merge main CI is the
  merge authority for the rename commit itself.
