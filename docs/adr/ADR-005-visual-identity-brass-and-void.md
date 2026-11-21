# ADR-005 — Visual Identity: Brass & Void

- **Status:** Accepted
- **Date:** 2026-11-22
- **Scope:** Product visual identity (all themes, type, motion, fonts)
- **Inputs:** `artifacts/design-tokens.json`, `packages/ui/src/tokens/`,
  `packages/ui/src/theme/`, `apps/desktop/src/renderer/dev/TokenSheet.tsx`,
  `docs/reports/report-P007.md`

## 1. Context

The product needed an identity on day one, not as a retrofit: art
direction first, tokens as code, a rendered proof the same prompt.
Deliberate position: a warm brass instrument in a cold, dark void —
explicitly NOT the purple/cyan AI gradient every agent product ships.

## 2. Decision

- **Brass & Void.** Default dark theme `brass-void` (near-black blue void
  `#0B0D10`, brass `#C8A24A`), plus `graphite`, `parchment` (light),
  `ember`, `deep-sea`, and `high-contrast`. Six themes, one token shape.
- **Tokens as code.** `artifacts/design-tokens.json` holds every color in
  hex AND OKLCH (OKLCH computed with a verified converter, anchors
  white/black/red checked). Codegen emits CSS custom properties and a
  frozen typed TS object; components reference variables, never hex
  (`no-raw-hex.mjs` fails the build otherwise).
- **Type.** Display Fraunces (variable), UI Inter, mono JetBrains Mono —
  all SIL OFL. Scale 12→46.
- **Motion.** Durations 80–450ms, four easings; `settle` is overshooting
  by design and therefore capped at ≤120ms. Springs recorded as data for
  future physics animation. `prefers-reduced-motion` swaps everything to
  ≤120ms opacity cross-fades (verified computed-style, zero transform
  animations running).

## 3. Font licensing (binding)

- **ONLY OFL fonts may be bundled in the app.** Each family ships its
  upstream `OFL.txt`; `assets/fonts/fonts.json` pins every file's SHA256
  and `scripts/lint/check-fonts.mjs` fails CI on unlisted files, hash
  mismatches, missing license text, or non-OFL families.
- **Fontshare, ITF, and FFL families are forbidden** — in the app AND
  self-hosted on project infrastructure. Several are attractive and free
  for some uses, but app embedding requires a paid license we do not
  hold. Any proposal to use one must arrive with the paid license first,
  recorded in a new ADR. No exceptions by enthusiasm.

## 4. Consequences

- The TokenSheet is the visual gate from here on: `report-P007` carries
  both-theme screenshots; P007+ UI changes re-render it.
- Parchment contrast forced four token darkening rounds (STOP honored —
  tokens fixed, bar intact). The dark themes passed first try.
- Theme switching is a `data-theme` attribute + CSS variables: no
  framework lock-in, testable in any headless browser.

## 5. Reversal triggers

- If a theme fails AA after honest token work, the theme is cut or fixed —
  never the bar. If Fraunces/Inter/JetBrains Mono leave OFL (they cannot,
  OFL is irrevocable — but if a file's provenance is ever doubted), CI
  blocks the build until re-verified from upstream.
