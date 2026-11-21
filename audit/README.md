# audit/ — Vision-Alignment Audit Agent

This directory hosts the audit agent: the component that continuously
checks the running product against the project's stated vision and the
threat boundary in ADR-000.

- The agent reads machine-readable specs from `artifacts/` (the spec
  registry) and compares observed behavior — tool calls, capability
  grants, network egress — against them.
- Findings land in `eval/golden/` as regression cases; `eval/runners/`
  execute them.
- Audit, like safety, policy, and sandbox, is ALWAYS open-source and can
  never move into `ee/`.

Implementation lands in a later prompt. This file is the charter, not a
roadmap: the agent audits the product as built, starting with the
scaffold itself (every prompt's report is in scope for review).
