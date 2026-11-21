# PROJECT ONE

An open-source unified agent desktop (Electron + Rust).

> **Status: skeleton.** This README is intentionally minimal. It is
> completed in P009. For the current state of the project, read
> `docs/adr/` (decisions) and `docs/reports/` (per-prompt evidence).

## Layout

- `apps/desktop` — Electron shell (renderer = untrusted UI).
- `crates/cored` — trusted Rust daemon: policy, secrets, tool dispatch.
- `crates/core-protocol`, `core-policy`, `core-sandbox`, `core-store` — daemon libraries.
- `packages/ui` — design system. `packages/sdk` — plugin SDK.
- `ee/` — commercial modules; the boundary is defined in `ee/README.md`.
- `eval/` — fixtures, golden outputs, runners. `audit/` — vision-alignment audit agent.

## Trust boundary (binding)

Renderer = untrusted UI. Daemon = trusted core. Tools = sandboxed.
Web content = hostile. Full statement: `docs/adr/ADR-000-host-profile-and-threat-boundary.md`.

## Contributing

Read `CONTRIBUTING.md` (DCO sign-off required), `CODE_OF_CONDUCT.md`,
and `SECURITY.md` before opening a pull request.

## License

Apache-2.0 — see `LICENSE`. Copyright 2026 The PROJECT ONE Authors.
