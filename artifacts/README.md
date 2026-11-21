# artifacts/ — Machine-Readable Spec Registry

Every claim a later prompt depends on is recorded here as JSON with a
`schema_version`, so agents and CI can check conformance mechanically.

| File | Schema | Contents |
|---|---|---|
| `machine-profile.json` | `1.0.0-p000` | P000 host ground truth: OS, CPU, RAM, GPU, disk, tooling, derived tiers |
| `toolchain.lock.json` | `1.0.0-p001` | P001 pinned toolchain: exact versions, sources, integrity data |
| `bootstrap-windows.log` | — | Verbatim P001 install transcript (first run) |
| `bootstrap-windows-rerun.log` | — | Verbatim P001 idempotency transcript (second run) |

Rules: schemas are append-only (bump the version, never silently reshape);
`UNKNOWN` is a string, never null; nothing here is hand-edited after its
prompt's commit except through a new prompt with its own report.
