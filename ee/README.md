# `ee/` — Commercial Modules: The Boundary

This directory holds Lamakore's commercial modules. The boundary
below is exact and intentional. There is no ambiguity: if a module is
not listed as commercial here, it is open-source.

## ALWAYS open-source (Apache-2.0, never moves into `ee/`)

- **Safety**: sandboxing, capability policy, audit logging, disclosure handling.
- **Audit**: the vision-alignment audit agent and all its runners/fixtures.
- **Policy**: capability tokens, policy evaluation, enforcement points.
- **Sandbox**: every OS isolation driver (Job Objects, AppContainer,
  and any future hypervisor-backed tiers).

Moving safety, audit, policy, or sandbox code into `ee/` requires an ADR
and is presumed rejected (see `GOVERNANCE.md`).

## Commercial (licensed separately, source-visible here for review)

- **SSO/SCIM**: enterprise identity provisioning and directory sync.
- **Air-gap packaging**: offline installers, sealed update bundles,
  license-server-free activation for disconnected networks.
- Related enterprise billing, metering, and fleet-management modules.

## Licensing

- Everything outside `ee/` is Apache-2.0 (see the root `LICENSE`).
- Files inside `ee/` carry their own license header naming the
  commercial license; where no header names another license, Apache-2.0
  applies by default. No file is ever "unlicensed": if the header is
  missing, treat it as Apache-2.0 and file an issue.
