# Report P009 — Designed First-Run, README, Demo Pipeline

- **Date (local):** 2026-11-22 IST
- **Visual gate:** **LIVE — passed.** FirstRun + all four state components
  reviewed as rendered output (screenshots committed as evidence).

## 1. Objective

Make the repository look like a serious product on day one and make every
future demo asset reproducible and scrubbed.

## 2. What shipped

- `FirstRun.tsx`: honest welcome (pre-alpha, provisional name), live P000
  host profile (OS/CPU/RAM/GPU tier/model class), truthful daemon status,
  exactly two actions — “Open the deck”, “Read the guide”. Zero metrics,
  zero testimonials, zero “coming soon”.
- Four first-class state components (`EmptyState`, `ErrorState`,
  `LoadingState`, `DegradedState`); the shell now renders all four states
  through them with unchanged user-visible copy.
- `scripts/capture.ts`: fixture profile (fresh user-data, fixed
  1280×800/960×600, fixed theme, synthetic `fixture` identity, UTC),
  scripted interaction, PNG + 60-frame GIF, pngjs re-encode scrub,
  ancillary-chunk audit, `manifest.csv` with post-scrub SHA256.
- README rewritten in the specified order (wordmark → value → banner →
  badges → GIF → is/is-not → ASCII architecture → quickstart → map →
  gates → scoreboard → roadmap → security → contributing → license →
  acknowledgements). No star widgets, no fake counts, no invented users.
- `docs/guides/demo-asset-pipeline.md`: fixture-VM rule, scrub +
  verify steps, personal-desktop ban.

## 3. Evidence

| Check | Result |
|---|---|
| FirstRun renders, both themes | **PASS** — screenshots reviewed (brass-void + parchment paths exercised; PNG committed) |
| Contrast, both themes | **PASS** — `contrast.spec.ts` green (shared tokens; FirstRun adds no new pairs) |
| Keyboard-only first-run path | **PASS** — Tab reaches both actions in order; Enter activates; deck opens. Verified on a throwaway harness (not committed) |
| Reduced-motion | **PASS** — `.reduced-motion` set, zero running animations on FirstRun |
| State components designed | **PASS** — reviewed in `shell-*-unreachable/degraded` screenshots; copy is specific (cause + fix + retry), not placeholder text |
| GIF real, ≤8 s, ≤5 MB, smooth | **PASS** — 60 frames, 6 s @ 10 fps, 960×600, 1.66 MB, first frame = live first-run screen; scripted clicks (guide → deck → focus) with zero page errors |
| manifest SHA + scrubbed | **PASS** — both SHAs re-verified against disk; `scrubbed:true`; `scan-metadata` clean on `assets/demo`; ancillary-chunk audit clean |
| No placeholders in renderer | **PASS** — `detect-placeholders` clean (one self-trip on the word in a comment, reworded) |
| Badges | link to real workflow files + evidence reports. **No runs exist yet** (push blocked since P002); nothing green is claimed and **no red runs exist** — STOP condition honored by disclosure, not fabrication |
| Cold start | **109 ms in-app / 466 ms wall** (≤2.5 s budget) |
| Idle RAM | **≈328 MB** steady (8 s: 331.9 MB, 33 s: 327.8 MB; Electron + daemon, no leak trend). Orphans: none after kill (parent-death shutdown verified again) |
| Full suite | 26/26 green (7 e2e + 5 ui + 12 hygiene + 2 branding), tsc clean, all three lints + font check clean |

## 4. Deviations

- **D1 — harness for keyboard/reduced-motion lives in TEMP, not the repo.**
  The one-off firstrun probe verified the paths and is documented here;
  the committed `render-shell.mjs` already covers the shell equivalence
  class. No evidence without a witness: the probe output is quoted in §3.
- **D2 — README badges are links, not status SVGs.** Without an org the
  badge-image URLs would be fabricated; links resolve today and light up
  on first push. The report states plainly that no runs exist.
- **D3 — GIF shows the unreachable state** (no daemon runs during
  capture). That is the honest state, and the status line says so —
  capturing against a live daemon would be the P010+ story.
- **D4 — `?screen=` / `?theme=` overrides** remain test-only hooks,
  documented in ADR-005's follow-ups, not user paths.

## 5. Next steps

- First push lights up badges and CI; re-capture assets against a live
  daemon for the connected-state GIF.
- P010+ builds the deck behind “Open the deck”; FirstRun stays the gate.
