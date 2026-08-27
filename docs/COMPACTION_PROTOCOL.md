# Compaction Protocol

## Question being answered

The central question is not simply:

> How should old context be summarized?

The stronger question is:

> Which old active context do we now have sufficient surviving representation to reclaim?

## Candidate and survivors

The compaction decision is based on:

```text
old active candidate span
        +
surviving durable state
        +
current canonical project state
        |
        v
semantic evacuation input
```

The compactor identifies live semantics that are not already represented in surviving state.

Missing material is transferred when possible.

Coverage is then audited across relevant semantic classes.

## Coverage gate

If coverage is uncertain or incomplete, reclamation is refused.

If coverage is sufficient, the host rechecks the basis used by the audit before irreversible reclamation authority can advance.

Relevant basis includes:

- session revision;
- source revision;
- canonical state identity/fingerprint;
- working-state identity/fingerprint;
- candidate sequence membership;
- checkpoint identity.

This protects against an audit computed over one state basis being committed after that basis has changed.

## Protocol progress is not prune authority

An incremental `state_checkpoint` can advance durable protocol progress.

It must not independently grant reclamation authority.

Conceptually:

```text
protocol_committed_through_seq
        !=
prune_safe_through_seq
```

The first records protocol/state progress.

The second records the host-owned boundary up to which reclamation has been separately authorized.

## Commit path

```text
coverage sufficient
        |
        v
basis rechecked
        |
        v
prune-safe authority may advance
        |
        v
audited active surface may be replaced
```

The raw append-only session log is a separate audit source and is not equivalent to the active model-facing surface.

## Live qualification

A preserved live trace demonstrates:

- a coverage audit over a concrete candidate;
- an audited prune candidate;
- `No transfer needed; safe to prune`;
- active-surface reduction from approximately 25,582 to 18,312 tokens;
- successful repeated compaction after a hotfix.

That case proves reclamation of material that already had sufficient surviving representation.

The preserved live corpus does not yet contain a deliberately constructed positive semantic-transfer canary and matching negative semantic-refusal canary.

See [REPRODUCTION.md](REPRODUCTION.md).

## Known transaction-ordering weakness

Live qualification also exposed an earlier partial-commit path:

```text
audit / state commit
        |
        v
PASS

surface replacement
        |
        v
FAIL
```

The old active surface remained present, so the observed failure did not delete source data.

However, prune authority had already advanced before surface replacement completed.

This is a known atomicity / transaction-ordering weakness and should not be described as a fully atomic reclamation commit.

## Claim discipline

This mechanism is best described as coverage-gated or audited context reclamation.

It is not a formal mathematical proof of zero semantic loss.

Semantic coverage assessment remains model-assisted while irreversible reclamation authority is constrained by host-side checks.
