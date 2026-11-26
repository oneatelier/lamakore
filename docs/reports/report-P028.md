# Report P028 — cinematic product site on Cloudflare Pages (free tier)

- **Date (UTC):** 2026-11-25
- **Scope:** Astro static site (`apps/site`) reusing Brass & Void tokens;
  procedural Three.js r187 guardian hero (WebGL2 floor, WebGPU
  enhancement, tier-C poster); OFL latin subsets; budget gates in CI;
  `site.yml` (main deploy + PR previews); live verification; P027 home
  clause; publishBlocked flip decision with fresh registry evidence.
- **Head:** PR #20 (`feat/p028-site → main`), merged as `caf27ef`
  (2026-11-26T09:30:15Z). Docs: this report + P028 flip, follow-up docs
  PR (P022 precedent: code first, docs with all URLs after).

## 1. What was built (and what was deliberately not)

`apps/site` (workspace package `@lamakore/site`, private): three
routes — home (3D guardian hero, pre-alpha banner, link grid), security
model (tiers, tokens, vault, wire protocol, hygiene, PVR link),
quickstart (exact contributor commands). All copy is honest factual
lines; no lorem anywhere (`detect-placeholders` full run: same 4
pre-existing advisory hits, zero new).

Deliberate omissions (documented, not deferred silently):

- **No binary 3D assets.** The hero is 100% procedural Three.js
  geometry — no glTF, no Draco, no KTX2, nothing to scrub. The pipeline
  requirement is satisfied vacuously and the budget script asserts the
  invariant (only `.woff2` binaries allowed, all sha-pinned in
  `public/fonts/fonts.json` with per-family OFL text).
- **No email contact.** `security@lamakore.dev` is NOT published
  anywhere: the apex still has no DNS (NXDOMAIN, §6) and advertising a
  mailbox on an unregistered domain would bounce today and could leak
  reports to a future registrant. Private channel = GitHub PVR only.
- **No trackers, no cookies, no analytics.** Nothing to consent to;
  nothing exfiltrated. CSP has no `connect-src` beyond `'self'`.
- **No COOP/COEP.** No threaded WASM is shipped, so cross-origin
  isolation would only break things. Recorded in `public/_headers`.

## 2. Hero engineering (three r187, pinned `three@0.187.0`)

- Floor: WebGL2 (`THREE.WebGLRenderer`). Enhancement: when
  `navigator.gpu` exists, `three/webgpu` is dynamically imported and
  `WebGPURenderer` renders the same scene graph (verified live: tier A
  engaged in headless Chrome with a real GPU, §4).
- Lazy-load: `IntersectionObserver` on `#hero-wrap` pulls the hero
  chunk (~723 KiB raw, ~150 KiB Brotli) only in viewport; the Three.js
  core rides a separate chunk, WebGPU a third.
- Tier C: reduced-motion, save-data, or no WebGL2 → static scrubbed
  SVG poster (868 bytes, hand-authored vectors, no fonts embedded, no
  EXIF by construction). The poster ships IN the HTML (not injected),
  so it is the LCP element and paints on the first round trips.
- Budget probe reads `document.documentElement.dataset.heroTier`
  (`a`/`b`/`c`) and `window.__heroFps` (median of 120 frames).

## 3. Budgets (CI gates — `scripts/site-budgets.mjs`, blocking in site.yml)

| Budget | Limit | Measured (CI run 45617206354) | Local |
|---|---|---|---|
| initial route (Brotli) | ≤2 MiB | 4.4 KiB | 4.4 KiB |
| lazy 3D chunk (Brotli) | ≤2.5 MiB | 308.0 KiB | 308.0 KiB |
| file cap (raw) | <25 MiB | hero 722.6 KiB | same |
| fonts | sha+OFL, woff2-only | GREEN (2 files) | GREEN |
| axe WCAG 2.1 AA ×3 routes | 0 violations | 0/0/0 | 0/0/0 |
| LCP Fast 3G+4xCPU Moto-G4 | <2500 ms | 1432 ms | 1568–1576 ms (poster path) |
| FPS hero tier A/B | median ≥55 | SKIP (SwiftShader: scene runs tier A, NOT asserted) | 119–120 fps, tier A (Iris Xe) |

Fix-forward ledger (2 used, 0 remaining — any further threshold red
is STOP): (1) footer contrast 3.25 → secondary color; replaced fragile
`waitUntil: commit` with `domcontentloaded`. (2) Poster moved into HTML
+ preloads (LCP 4104 → ~1570 ms); FPS read waits for the 120-frame
sample. CI-only follow-ups: `--disable-dev-shm-usage` (tiny runner
shm), `networkidle0` → `domcontentloaded`+readiness (unreproducible
90 s hang on ubuntu runners; local SwiftShader-forced runs settle in
<1 s). No threshold was relaxed at any point.

## 4. Live verification

- Preview (PR #20): `https://pr-20.lamakore.pages.dev` → **200**,
  `content-encoding: br`, exact authored CSP/frame/referrer/nosniff
  headers, hero markup + product name present (verified 2026-11-25
  pre-merge).
- Production: `https://lamakore.pages.dev` → **200** (verified
  2026-11-26 post-merge: `content-encoding: br`, exact authored CSP /
  frame / referrer / nosniff headers, hero markup + product name
  present, 9115-byte document). Production deploy run `45792565477`
  (main push, head `caf27ef`): "Uploaded 0 files (38 already uploaded)",
  "Deployment complete!", success. Project `lamakore` created by CI
  idempotently (`ensure Pages project exists` step, first run
  `45617206354`: "Successfully created the 'lamakore' project").

## 5. P027-AMENDED home clause

P027 (registry/domain claims) STOPped on 2026-11-24 with all four
names dark, so `report-P027.md` was never written — there is nothing
to amend in-tree; the clause is defined HERE instead:

- **Durable project home:** Cloudflare Pages, `lamakore.pages.dev`
  (live §4; apex `lamakore.dev` still dark — owner/registrar follow-up,
  not a site blocker since the home is the pages.dev URL).
- **Private security channel:** GitHub private vulnerability reporting
  ONLY (`/security/advisories`). The `security@` mailbox stays
  unpublished until the apex domain resolves AND mailbox receipt is
  demonstrated end-to-end (claims flow, not this batch).

## 6. publishBlocked flip decision (evidence, not assertion)

Gate inputs re-verified 2026-11-25/26 (this batch):

- Registries CLAIMED (reversal from the 2026-11-24 STOP): npm
  `lamakore` 200, maintainer `oneatelier`, created 2026-11-24,
  "Reserved name for Lamakore"; crates.io 200, same reservation
  description, created 2026-11-24; PyPI 200, created 2026-11-24.
  Triad dates + descriptions agree; npm authorship is owner-held. No
  squat.
- Pages live: production URL 200 (§4, verified 2026-11-26).
- P026 CI green: main head `f68e96f`, ci `45579403164` + hygiene
  `45579403398`, all success (FIXBATCH §4).
- Owner sign-off on file: LAMAKORE 2026-11-24 (clearance.md line 3).
- DNS: `lamakore.dev` NXDOMAIN (host + Google 8.8.8.8, 2026-11-25 and
  2026-11-26); no receipt/txid ever provided.

**Decision: FLIP EXECUTED** — `clearance.publishBlocked` is now
`false` (`branding.config.json` + regenerated TS/Rust brand outputs,
this docs batch).
the flip is recorded in `docs/clearance.md` (P028 verification
section: DNS-dark caveat, README "What this is not" follow-up flagged —
it still says claims are pending — for the claims flow).

## 7. Gates and deviations

- **[E] Evidence:** run URLs inline (§§4–6 + CI logs); budget table
  from the blocking CI step output, not local runs alone; hashes in
  `public/fonts/fonts.json`; asset sizes from Brotli bytes on disk.
- **[V] Visual gate:** LIVE preview verified by fetch (200 + headers +
  markup); hero motion verified locally (tier A, 120 fps); poster path
  verified headless (tier C). No screenshots shipped as evidence —
  markup + headers + budgets are the machine-checkable surface.
- **Deviations:** (a) fonts subset by local fonttools (not vendored
  tool) — command + manifest recorded, output deterministic;
  (b) `minimumReleaseAgeExclude` auto-entries for wrangler/miniflare
  accepted from pnpm (supply-chain policy check passes);
  (c) `tests/branding/rename.spec.ts` filter extended to nested
  `node_modules` (first nested set arrived with apps/site; drill intent
  unchanged).
- **STOP conditions (none fired):** no budget-threshold red after the
  two fix-forwards (CI browser hang was harness, fixed without touching
  thresholds); no secret in repo (secret scan + pre-commit clean;
  Cloudflare values exist only as Actions secrets, never printed);
  no non-OFL asset (woff2 subsets of OFL TTFs + hand SVG only).
