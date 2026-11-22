# Demo Asset Pipeline

Every pixel in `assets/demo/` is reproducible and scrubbed. No exceptions.

## 1. Fixture rule: never capture from a personal desktop

- Captures run in a **fixture profile**: fresh browser user-data dir,
  fixed viewport, fixed theme, synthetic identity (`fixture`), UTC clock,
  `en-US` locale. Nothing personal is on screen because nothing personal
  is in the profile.
- The app under capture shows only fixture content: the P000 reference
  profile, synthetic states, no real files, no real names.
- **Capturing anything from a personal desktop, personal home directory,
  or logged-in account is forbidden.** The hygiene scanners enforce the
  aftermath; this rule prevents the cause.

## 2. Deterministic capture (`node scripts/capture.ts`)

1. Build the production bundle (`node scripts/build-desktop.mjs`).
2. `node scripts/capture.ts` serves the repo over loopback, drives the
   scripted interaction (fixed sleeps, fixed clicks — no human timing),
   and records:
   - `P009-first-run.png` — still, 1280×800, brass-void.
   - `P009-shell.gif` — 960×600, 6 s at 10 fps (60 frames), interaction:
     first-run → read the guide → open the deck → keyboard focus.
3. Filenames encode prompt + scene + theme + version:
   `P<NNN>-<scene>[-<theme>][-vN].<ext>`.

## 3. Scrub and verify (mandatory, not optional)

- Every PNG is re-encoded through `pngjs` (IHDR/PLTE/IDAT/IEND only):
  EXIF, XMP, tEXt/iTXt/zTXt, and all other ancillary chunks are dropped
  by construction, not by stripping after the fact.
- GIFs carry no metadata model; the script asserts magic, dimensions,
  duration (≤8 s), and size (≤5 MB).
- `scripts/hygiene/scan-metadata.mjs` must pass on every committed asset.
- `manifest.csv` records file, prompt, scene, theme, dimensions,
  duration, sha256 (post-scrub), captured_at, and `scrubbed: true`.
  A row with anything but `true` fails review.

## 4. What gets committed

Still PNGs, scrubbed GIFs, and `manifest.csv` (hashes included, so any
later byte change is detectable). Never commit: raw captures, fixture
VM disks, screen recordings with audio, or anything containing a real
hostname, username, path, or face.
