# Report P003 — Branding SSOT, Codegen, Rename, Lint Guard

- **Date (local):** 2026-11-21 IST
- **Visual gate:** **N/A.** The P007 token sheet MUST read its title from
  branding (`getProductName()`); no visual claim is made here.

## 1. Objective

Make the product name a one-command change. The name is NOT cleared; this
prompt is the insurance policy that lets us build anyway — codename used
throughout, no real name needed (STOP condition never triggered).

## 2. Commands run (all exit 0 unless noted)

- `node scripts/branding-codegen.mjs` → wrote `generated.ts`, `index.ts`, `brand.rs`
- `node scripts/lint/no-hardcoded-brand.mjs` → `brand lint: clean`
- `pnpm lint` → exit 0 (same rule, wired as the `lint` script)
- `node --test tests/branding/rename.spec.ts` → **2 pass, 0 fail**
- `pnpm typecheck` (`tsc --noEmit -p tsconfig.json`) → exit 0
- `cargo check --workspace` → exit 0 (brand.rs included via `pub mod brand`)
- `pnpm add -Dw typescript @types/node` → typescript **7.0.2**, @types/node **26.6.6** (observed, committed to lockfile)
- E3 proof greps (after `git add -N` so untracked files are visible):
  product-name grep excluding generated + docs/** + CHANGELOG + constitutive
  → exactly **`branding.config.json`**; token-boundary grep with the same
  exclusions + config/manifests → **zero hits**.

## 3. Acceptance evidence

| Gate | Result |
|---|---|
| [E] lint fails on hardcoded fixture, passes on real tree | **PASS** — spec test 2: temp fixture with the live configured name fails with violations; real tree clean |
| [E] rename.spec passes (consistent tree) | **PASS** — spec test 1: temp-copy rename to "Acme Widget"/acme; config correct; lint clean; reports/adr/CHANGELOG byte-identical; LICENSE follows; branding pkg typechecks under TS 7; scopes follow |
| [E] name in exactly one non-generated, non-docs source file | **PASS** — the E3 grep above; the single file is `branding.config.json` |
| [E] `publishBlocked === true`, no publish script exists | **PASS** — config `clearance.publishBlocked: true`; all `package.json` scripts are `branding:codegen/lint/test/typecheck` only |
| [V] | **N/A.** Title-by-branding is a P007 obligation, recorded in ADR-003 §1. |

## 4. Deviations and incidents (all in the open)

- **D1 — lint exclusion refinement (spec §4 vs acceptance).** The spec's
  exclusion list cannot pass the real tree on its own: LICENSE, NOTICE,
  README, TRADEMARK and five governance files MUST name the brand to
  function, and package manifests carry hyphenated slugs that trip a
  word-boundary token match after any rename. The rule therefore also
  exempts constitutive identity files and package manifests (slugs are
  owned by rename.mjs, proven by the drill's scope assertions). Recorded
  in ADR-003 §2; the drill caught both gaps before they shipped (a `.mjs`
  comment example and the temp-tree scopes).
- **D2 — scrubbed 16 literals.** Cargo descriptions, package descriptions,
  script header comments, `.gitignore`, and `cored`'s doc line were
  reworded to remove the brand; code now reads accessors, not literals.
- **D3 — TypeScript 7.** `pnpm add` resolved typescript 7.0.2, whose
  `tsc` refuses explicit file args alongside a discovered tsconfig: the
  drill passes `--ignoreConfig`. Root `package.json` gained
  `"type": "module"` (fixes TS1470 on `import.meta` in the spec and the
  node typeless-package warning).
- **D4 — `pnpm add` needs `-w`.** pnpm 12 refuses root adds without
  `--workspace-root`; used `pnpm add -Dw`.
- **D5 — `git grep` is blind to untracked files.** The E3 proof stages
  intent-to-add (`git add -N`) first; the final commit then contains
  exactly what was proven.

## 5. Next steps

1. P004+ code MUST import brand values (`@project-one/branding` /
   `core-protocol::brand`), never literals — the lint enforces it.
2. P007 token sheet reads its title via `getProductName()`.
3. Clearance (ADR-003 §3) runs before any publish; lifting the block
   needs a new ADR with evidence for all four steps.
