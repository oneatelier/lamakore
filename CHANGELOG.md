# Changelog

All notable changes to this project are documented here, newest first.
Format follows Keep a Changelog; versioning will be Semantic Versioning
once the first public release is cut.

## [Unreleased]

## [P002] — 2026-11-21

- Monorepo scaffold: Electron shell dirs, five Rust daemon crates
  (`cored`, `core-protocol`, `core-policy`, `core-sandbox`, `core-store`),
  `packages/ui`, `packages/sdk`, `ee/`, `eval/`, `audit/`.
- Governance: Apache-2.0 LICENSE, NOTICE ledger, SECURITY (90-day,
  tool-execution in scope), CONTRIBUTING (DCO + two gates),
  CODE_OF_CONDUCT, GOVERNANCE (maintainer-of-record + escrow),
  TRADEMARK (provisional marks).
- Electron 45.4.1 recorded as the shell pin; install lands with the
  desktop build, not here.

## [P001] — 2026-11-21

- Pinned toolchain: Rust 1.100.0, pnpm 12.22.0, Node 24.22.3, Git
  2.56.1. Lock file with integrity data; `verify.mjs` enforcement.

## [P000] — 2026-11-21

- Clean-machine inventory and threat boundary (ADR-000). Reference host:
  Windows 11 x64, i5-1334U, 16 GB RAM, Intel Iris Xe. Tier A / small_7b /
  Job-Objects-first sandbox order.
