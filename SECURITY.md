# Security Policy

## Reporting a vulnerability — private disclosure only

- Email: **security@project-one.dev**. Encrypt if you can; we will send
  you our public key on first reply.
- Alternatively, once this repository is public on GitHub, use
  **Private Vulnerability Reporting** on the Security tab.
- Do NOT open a public issue, discussion, or pull request for a
  suspected vulnerability.

## Response policy (90-day)

- Acknowledgement within **5 business days**.
- Triage and severity assignment within **15 days**, with a remediation
  plan or a written reason for dispute.
- Fix and coordinated disclosure within **90 days** of the report.
- If a fix cannot ship in 90 days, we publish a mitigation advisory on
  day 90 and a new target date. Reporters are credited unless they ask
  not to be.

## Scope

In scope: the Electron shell, the Rust daemon and its crates, the plugin
SDK, the update mechanism, build and release pipelines, and — explicitly —
**agent tool-execution**: sandbox escapes, capability-token bypasses,
prompt-injection paths that cross the daemon boundary, and tool-output
laundering into privileged context are all treated as security bugs, not
feature requests.

Out of scope: the commercial `ee/` modules' licensing enforcement
(report piracy to the same address; it is triaged separately), upstream
Electron/Chromium CVEs already fixed in our pinned version (upgrade
requests still welcome), and social-engineering of maintainers.

## Safe harbor

Good-faith research that follows this policy will not be met with legal
action. Do not exfiltrate other users' data, do not degrade shared
services, and stop at proof-of-concept.
