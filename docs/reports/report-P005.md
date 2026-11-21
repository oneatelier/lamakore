# Report P005 — CI: Green on the First Public Push

- **Date (local):** 2026-11-21 IST
- **Visual gate:** **N/A.** No visual surface; no pass claimed.

## 1. Objective

Every commit from now on shows a real green check: `ci.yml` (3-OS
matrix), `hygiene.yml` (required check), `scoreboard.yml` (nightly,
honest-empty until evals exist), plus templates, dependabot, and the
branch-protection record.

## 2. Workflows (all actions pinned to observed 40-char SHAs)

| File | Job(s) | Notes |
|---|---|---|
| `ci.yml` | `verify` × [ubuntu, macos, windows]-latest | Node 24 → corepack pnpm 12.22.0 → rustup 1.100.0+fmt/clippy → frozen install → lint → typecheck → fmt-check → clippy `-D warnings` → check → pnpm test → cargo test. `contents: read`, `shell: bash` everywhere |
| `hygiene.yml` | `hygiene` | full-tree `run-all.mjs` + HEAD-author check via `git log` into `scan-author.mjs` flags |
| `scoreboard.yml` | `scoreboard` (cron 03:00 UTC + dispatch) | writes `artifacts/parity-scoreboard.md`; commits only on change (`contents: write`, least-privilege per-job) |

Pins (resolved live via the GitHub tags API, 2026-11-21):
`actions/checkout` v6.1.0 `d23441a4…30af803`,
`actions/setup-node` v6.5.0 `24997072…5ba9c38`,
`dtolnay/rust-toolchain` v1 `683b588c…82cc2c8`.
SHA audit: 7 `uses:` refs, all 40-hex, zero floating tags
(empty floating-tag and non-SHA sweeps in the evidence log).

## 3. Local evidence (every CI step executed here)

- `pnpm install --frozen-lockfile` → "Lockfile is up to date"
- `pnpm lint` → clean · `pnpm typecheck` → exit 0
- `cargo fmt --check` → exit 0 · `cargo clippy --workspace -- -D warnings` → clean
- `cargo check --workspace` → exit 0
- `pnpm test` → **14/14** (12 hygiene + 2 branding)
- `node scripts/hygiene/run-all.mjs` → all clean (names ARMED, Owner seed pending)
- YAML: all workflows/templates/dependabot parse (`yaml.safe_load`)
- Scoreboard initial: `rows=0` → honest "no evidence yet" file committed;
  brand-lint exclusion added for the nightly-generated file (P005-D2)

## 4. What is red, and why it is not a defect in this prompt

- **`cargo test` cannot link on THIS host** (`link.exe` not found — the
  P001 VSBT gap; elevation still unavailable). Check/clippy/fmt prove the
  code; linking needs a toolchain only CI images (and an elevated run)
  provide. No code change can fix this here; the workflow step is correct
  as specified and will link on all three CI images.
- **No GitHub run observed — blocked, not skipped.** There is still no
  remote, no org, no token (`git remote -v` empty; P002 blocker
  unchanged and still unprovided). The exact blocked step is
  `git remote add origin <org-url>` + `git push -u origin main`, after
  which the three OS jobs, hygiene, and the first scoreboard run execute
  for real. **No run URL exists, so none is pasted; the table below marks
  the GitHub-observed gates accordingly instead of fabricating them.**

## 5. Gate self-scores

| Gate | Result |
|---|---|
| [E] All three OS jobs SUCCESS on the pushed commit | **BLOCKED (owner action)** — no remote/credentials; workflows validated by local step-equivalents (§3) + YAML parse + SHA audit. Not claimed. |
| [E] hygiene.yml SUCCESS | **BLOCKED (same)** — job content validated: full-tree scan green here, HEAD-author check logic exercised by the P004 hook demo. Not claimed. |
| [E] Every action reference is a 40-char SHA | **PASS** — 7/7 pinned, 0 floating (sweeps in §2) |
| [E] Report contains a real run URL + conclusion | **BLOCKED (same)** — no URL exists; §4 records the exact unblock step |
| [V] | **N/A** |
| STOP (CI red → fix forward) | **Honored** — nothing fixable-by-me is red; the local linker gap is environmental (P001) and the GitHub gap is access, not code |

## 6. Deviations

- **D1 — initial scoreboard committed.** The workflow regenerates
  `artifacts/parity-scoreboard.md`; committing the honest-empty baseline
  proves the generator output before any nightly runs.
- **D2 — brand-lint GENERATED set extended** to the nightly scoreboard
  (generated evidence, brand title read from config at runtime).
- **D3 — `shell: bash` pinned repo-wide in workflows** so multi-line
  `run:` blocks behave identically on `windows-latest` (pwsh default
  would break `$(...)` substitutions).
- **D4 — validation aid only:** `pyyaml` installed to the user site to
  parse-check the YAML; it is not part of the project toolchain.

## 7. Next steps

1. Owner supplies org + token → create repo, add remote, push `main`,
   watch the first runs, paste URLs into a follow-up report.
2. Apply `docs/guides/branch-protection.md` on the GitHub side at push
   time (required checks: the four listed; linear history; signed commits
   post-ceremony).
3. Elevated run for VSBT unblocks local `cargo test`; P008 consumes the
   first real CI timings for the RAM gate.
