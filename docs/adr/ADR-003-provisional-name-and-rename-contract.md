# ADR-003 — Provisional Name and Rename Contract

- **Status:** Accepted
- **Date:** 2026-11-21
- **Scope:** Product identity for PROJECT ONE (codename, build config)
- **Inputs:** `branding.config.json`, `scripts/branding-codegen.mjs`,
  `scripts/rename.mjs`, `scripts/lint/no-hardcoded-brand.mjs`,
  `tests/branding/rename.spec.ts`, `docs/reports/report-P003.md`

## 1. Context

The product name is NOT cleared (trademark `NOT_CLEARED`,
`clearance.publishBlocked: true`). Rather than stall the build, this ADR
makes the brand a one-command change: every literal lives in
`branding.config.json`, code reads generated accessors, and a lint rule
plus a rename drill prove consistency. The P007 token sheet MUST read its
title from branding (`getProductName()`), never a hardcoded string.

## 2. Decision

- **Single source of truth:** `branding.config.json` is the only
  non-generated, non-docs source file containing the brand literals.
  Proven by grep in report-P003 (exactly one file: the config).
- **Codegen:** `scripts/branding-codegen.mjs` emits `generated.ts`
  (frozen typed object + CSS custom-property names), `index.ts` (typed
  accessor surface), and `crates/core-protocol/src/brand.rs` (constants,
  wired in via `pub mod brand`). Outputs carry DO NOT EDIT headers and
  are committed. `--check` fails CI when outputs are stale.
- **Rename:** `node scripts/rename.mjs --name X --token Y --org Z`
  rewrites the config, regenerates, updates package slugs, live identity
  files, and the lockfile's scope strings, then prints a diff summary.
  It REFUSES any write under `docs/reports/`, `docs/adr/` (history is
  immutable); CHANGELOG is left alone as historical record.
- **Lint:** `pnpm lint` fails on the configured product name, code token,
  or daemon binary outside: the config, generated files, history
  (reports/adr/CHANGELOG), package manifests (slugs owned by rename),
  and the constitutive identity files that must name the brand to
  function as legal/policy text (LICENSE, NOTICE, README, TRADEMARK,
  CONTRIBUTING, CODE_OF_CONDUCT, GOVERNANCE, SECURITY, ee/README,
  audit/README, artifacts/README). Hyphenated slugs are rename-owned and
  intentionally unmatched.

## 3. Why provisional (clearance protocol)

Clearance is a 4-step gate, executed in order, BEFORE any publish:

1. **Product search** — is the name in use by a shipping product?
2. **Trademark search** — USPTO/EUIPO/WIPO + the owner's home registry.
3. **Phonetic/malware screen** — confusable names, homoglyphs, and
   association with known-malicious packages/domains.
4. **Registries** — npm, crates.io, and domain availability for the
   token and slug.

## 4. Hard rule

While `clearance.publishBlocked` is `true`: **no npm publish, no crates
publish, no domain registration, no app-store submission, no trademark
filing under the provisional name.** No publish script may exist in any
`package.json` (verified in report-P003). Lifting the block requires a new
ADR recording all four clearance steps with evidence — never a silent edit.

## 5. Consequences

- Building under the codename is safe: a cleared name later is one
  rename command plus review of the diff summary.
- Constitutive files still name the brand (they must, to be meaningful);
  they are lint-exempt but rename-tracked, so they follow automatically.
- The drill (`node --test tests/branding/rename.spec.ts`) is the
  executable form of this contract: temp-copy rename, zero stale
  occurrences, history identical, package typechecks, scopes follow.
