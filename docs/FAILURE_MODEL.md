# Failure Model

The control architecture developed in response to recurring long-horizon agent failures.

## Failure classes

Examples include:

- prompt feedback failing to become durable constraints;
- repeated failed hypotheses or repeated failed actions;
- transient model context being treated as authoritative state;
- tests passing while actual user acceptance still fails;
- context compaction losing unique constraints or evidence;
- repeated compaction accumulating information loss;
- stale project or source state surviving into later actions;
- budget and lifecycle edge cases;
- runtime failures being confused with model reasoning failures;
- partial compaction or commit failures;
- evidence and validation artifacts becoming inconsistent with recorded authority;
- exact tool-level denial being misread as a tool-specific rather than semantic restriction;
- report or model self-assessment being used as a proxy for physical artifact state.

## Responsibility split

The model is primarily responsible for:

- semantic interpretation;
- reasoning;
- hypotheses;
- implementation judgment;
- review judgment;
- semantic coverage judgment.

The host is primarily responsible for:

- canonical revisions;
- durable state;
- task and source authority;
- budgets;
- mutation gates;
- state transitions;
- irreversible reclamation authority.

The purpose is not to make model reasoning infallible.

The purpose is to reduce the amount of irreversible system authority that depends only on transient model context.

## Evidence discipline

Failure attribution is layered.

An observed symptom is not automatically attributed to the model.

Relevant layers can include:

```text
model
harness
runtime
provider
parser
tool protocol
context handling
project-state governance
unknown / mixed
```

Where the exact layer is not demonstrated, the claim should remain mixed or unknown.

## Known live reclamation weakness

An earlier compaction path was observed to advance prune authority before active-surface replacement completed.

Replacement then failed and the old surface remained present.

The observed event was fail-safe with respect to source-data deletion, but it exposed a transaction-ordering weakness.

That issue belongs in the failure model rather than being hidden from the public project history.

See:

- [Compaction protocol](COMPACTION_PROTOCOL.md)
- [Engineering reports](../reports/)
- [Primary evidence](../evidence/)
