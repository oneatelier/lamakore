# Report P007 — Brass & Void Tokens, Themes, Visual Gate Live

- **Date (local):** 2026-11-22 IST
- **Visual gate:** **LIVE — this prompt. Passed, with evidence below.**

## 1. Objective

Install the visual identity as code on day one: tokens, six themes,
fonts, motion, a typed theme engine, and a real rendered TokenSheet —
never the purple/cyan gradient.

## 2. What was built

`artifacts/design-tokens.json` (every color hex+OKLCH, OKLCH converter
verified against white/black/red anchors) → `tokens-codegen.mjs` →
`generated.css` (per-theme vars, `@font-face`, focus ring, reduced-motion
swap) + `generated.ts` (frozen typed object). `themes.ts` (typed
accessors), `ThemeProvider.tsx` (system preference, persistence, typed
hook, reduced-motion), `TokenSheet.tsx` (every color/type/radius/
elevation/duration/easing with live labels + focus demo). Guards:
`no-raw-hex.mjs`, `check-fonts.mjs` (fonts.json SHA-pinned, OFL-only),
`contrast.spec.ts`, `tokens.spec.ts`, `render-verify.mjs`.

## 3. Visual evidence (reviewed by the engineer, not just asserted)

- `artifacts/token-sheet-brass-void.png` — dark void, brass accents,
  Fraunces display title, all sections legible, focus demo complete.
- `artifacts/token-sheet-parchment.png` — light theme, same layout, dark
  text on paper, olive-brass controls. No gradient anywhere.
- Title in both reads the live brand (`getProductName()`), satisfying the
  ADR-003 P007 obligation.
- `render-verify.mjs` (headless Chrome, real bundle): zero page errors;
  keyboard Tab walks 6 theme buttons + actions + link + input in order;
  focused element shows the 2px brass outline (`rgb(217, 180, 99)`);
  reduced-motion emulation yields `.reduced-motion`, opacity-only
  transitions at 0.12s, zero running animations.

## 4. Gate self-scores

| Gate | Result |
|---|---|
| [V] Sheet renders correctly in brass-void AND parchment | **PASS** — screenshots reviewed above; programmatic checks green |
| [V] Every text/bg pair passes WCAG 2.2 AA (≥4.5:1, ≥3:1 large) | **PASS** — `contrast.spec.ts` green (STOP honored: 8 parchment failures fixed by darkening tokens, never the bar) |
| [V] Focus ring visible on every interactive; keyboard-only traversal; no default outline | **PASS** — Tab walk + computed `2px solid` ring; `:focus{outline:none}` + `:focus-visible` ring in generated CSS |
| [V] Reduced-motion produces zero transform animations | **PASS** — opacity-only 0.12s, zero running animations |
| [E] no-raw-hex fails on planted `color:#ff0000` | **PASS** (spec test) and clean on the real tree |
| [E] Every bundled font has a matching OFL file; CI font check passes | **PASS** — 3 families, OFL-1.1 texts committed, SHA-pinned manifest, `check-fonts.mjs` clean |
| [E] tokens.spec.ts: CSS and TS in sync with the JSON | **PASS** |

## 5. Deviations

- **D1 — two new scripts beyond the deliverable list** (`check-fonts.mjs`,
  `tests/ui/render-verify.mjs`): the font gate and the visual harness the
  prompt demands but does not name. Both are lint-clean and documented here.
- **D2 — TypeScript 7 module split**: `require('typescript')` is a version
  stub; component and spec codebases import accordingly (specs use `.ts`
  specifiers + `allowImportingTsExtensions`; app code uses `.js` specifiers).
- **D3 — parchment palette darkened 4 rounds** (brass, all four signals,
  focus) to clear AA — the STOP working as designed. Dark themes passed
  untouched. OKLCH values recomputed per token, never interpolated.
- **D4 — `pnpm test` uses explicit spec paths** (directory arg does not
  resolve on this toolchain); all 19 tests green.

## 6. Next steps

- P008 consumes the RAM gate against this exact shell weight.
- Any UI change re-renders the sheet; screenshots stay committed evidence.
- Clearance work (ADR-003) is unaffected — the identity is provisional but rendered.
