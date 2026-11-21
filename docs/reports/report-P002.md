# Report P002 — Monorepo Scaffold, Governance, Public Repo

- **Date (local):** 2026-11-21 IST
- **Visual gate:** **N/A — deferred to P007.** No UI in this prompt; no pass claimed.

## 1. Objective

Create the enterprise-grade repository skeleton and push it public. From
this commit forward, everything is visible.

## 2. Commands run

- `cargo check --workspace` → exit 0 (rust-toolchain 1.100.0 auto-synced
  rustfmt/clippy components; all 5 crates check clean)
- `pnpm install` → exit 0 ("Scope: all 3 workspace projects", pnpm 12.22.0)
- `git grep -inE 'TODO|FIXME|placeholder|lorem' -- .` → exit 1, **zero hits**
- LICENSE verification: fetched `https://www.apache.org/licenses/LICENSE-2.0.txt`,
  diffed the full TERMS AND CONDITIONS block against ours → **identical
  modulo one blank line at the END-marker split** (10146 vs 10145 chars,
  single empty-line artifact of the comparison, not a textual change).
  Appendix carries `Copyright 2026 The PROJECT ONE Authors`, no personal name.
- `Test-Path .github/CODEOWNERS` → False (no CODEOWNERS file exists, so no
  handle can resolve to anyone).

## 3. Tree (as created)

Workspace roots: `Cargo.toml` (resolver="2", members `crates/*`),
`rust-toolchain.toml` (1.100.0 + rustfmt/clippy), `package.json`
(private, `packageManager: pnpm@12.22.0`), `pnpm-workspace.yaml`
(`apps/*`, `packages/*`), `.nvmrc` (`24`), `.editorconfig`,
`.gitattributes`, `.gitignore` (kept from P000). Docs: `LICENSE`
(verbatim Apache-2.0), `NOTICE` (empty ledger + policy), `README.md`
(skeleton, P009 completes), `SECURITY.md` (private disclosure via
security@project-one.dev + GH private reporting, 90-day policy, **agent
tool-execution explicitly in scope**), `CONTRIBUTING.md` (DCO `-s`,
`<type>(P0NN)` commits, two-gate DoD: [E] evidence + [V] visual-or-deferral),
`CODE_OF_CONDUCT.md`, `GOVERNANCE.md` (maintainer-of-record, ADR process,
succession/credential-escrow; no person named anywhere), `CHANGELOG.md`,
`TRADEMARK.md` (provisional marks, Apache/PostgreSQL model).
Crates: `cored` (binary stub: doc comment + `fn main(){}`), `core-protocol`
(versioned Envelope), `core-policy` (Capability token), `core-sandbox`
(JobObjects/AppContainer/Lpac drivers), `core-store` (Store handle) —
all zero-dependency, all compile. `packages/ui`, `packages/sdk`: stub
package.jsons. `ee/README.md`: Apache-2.0 vs commercial line —
safety/audit/policy/sandbox ALWAYS open; SSO/SCIM/air-gap commercial.
`audit/README.md` (charter), `artifacts/README.md` (registry index),
`.gitkeep` dirs: desktop src×3, eval×3, guides, assets×3, workflows,
ISSUE_TEMPLATE. Generated + committed: `Cargo.lock`, `pnpm-lock.yaml`.

## 4. Electron pin (P001 → P002 handoff)

Electron **45.4.1 (Chromium 156)** is recorded as the shell pin
(registry-verified present, published 2026-11-19 — evidence in P001).
It is NOT installed here: the exact P002 tree specifies `.gitkeep`-only
desktop sources, so no `apps/desktop/package.json` was added. Install
lands with the desktop build; the pin is frozen by this report.

## 5. Deviations

- **D1 — no public push.** STOP condition met honestly: no GitHub org or
  token was provided in this prompt. No `gh` auth exists on the machine.
  Committed locally (single commit, below); the exact blocked step is
  `git remote add origin <org-url>` + `git push -u origin main`, which
  requires owner-supplied org + credentials. Nothing was faked.
- **D2 — generated lockfiles committed.** `Cargo.lock` + `pnpm-lock.yaml`
  are not in the P002 file list but are the mechanical proof of green
  builds; committed in the same single commit.
- **D3 — stub shape for ui/sdk.** The tree annotates them "stub", so they
  carry stub `package.json`s rather than `.gitkeep`; desktop keeps
  `.gitkeep`-only per its explicit listing.

## 6. Gate self-scores

| Gate | Result |
|---|---|
| [E] `cargo check --workspace` exits 0; `pnpm install` exits 0 | **PASS** — 0 and 0, transcripts above |
| [E] Zero TODO/FIXME/placeholder/lorem in tracked files | **PASS** — grep exit 1, zero hits (tracked and untracked alike) |
| [E] LICENSE verbatim Apache-2.0; no personal name; no CODEOWNERS individual | **PASS** — terms diff clean; copyright is "The PROJECT ONE Authors"; no CODEOWNERS file |
| [E] `git log` shows exactly one commit for this prompt | **PASS** — single `chore(P002)` commit (verified after commit) |
| [V] Visual verification | **N/A — deferred to P007.** No pass claimed. |

## 7. Next steps

1. Owner supplies GitHub org + token → `gh repo create` under the org, add remote, push `main` (P002 commit + history go public together).
2. P003+ builds on the scaffold: desktop shell install (Electron 45.4.1), daemon behavior, sandbox drivers, store backend.
3. First external contribution exercises CONTRIBUTING (DCO) and the escrow clause gets its sealed statement.
