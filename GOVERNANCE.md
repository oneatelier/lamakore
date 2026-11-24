# Governance

## Model: Maintainer of Record

Lamakore is led by a single **Maintainer of Record** holding final
authority over technical direction, releases, and the `ee/` boundary.
Day-to-day review may be delegated to named reviewers, but delegation is
revocable and every delegation is recorded in an ADR. No commit lands
without sign-off per `CONTRIBUTING.md`.

No individual is named in this document: authority attaches to the role,
and the current holder is identified by the repository's commit history
and public announcements — never by folklore.

## Decision process

1. Contestable technical decisions are written as ADRs in `docs/adr/`
   BEFORE implementation. An ADR records context, options, the decision,
   consequences, and reversal triggers.
2. Reports in `docs/reports/` are the evidence log; ADRs cite them.
3. Silence is not consent: an ADR is accepted only by an explicit
   maintainer approval recorded on the change that carries it.

## Succession and credential escrow

- The Maintainer of Record names a successor in a sealed, dated
  statement held in credential escrow (offline, two independent
  custodians, contents unknown to them). The statement is opened only on
  resignation, incapacity, or 12 months of unreachability.
- Release-signing keys, registry tokens, and hosting credentials are held
  in escrow under the same terms, with rotation recorded in an ADR.
- If no successor statement exists when the role is vacated, authority
  passes to a public election among contributors with merged commits,
  run transparently in the issue tracker.

## Commercial boundary

The `ee/` directory is governed by `ee/README.md`. Safety, audit,
policy, and sandbox code are ALWAYS open-source; moving such code into
`ee/` requires an ADR and is presumed rejected.
