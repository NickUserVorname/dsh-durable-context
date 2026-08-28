# Selective Capture + Late Transfer Qualification

[Video: selective capture, late transfer and fresh-chat recovery](https://youtu.be/V3mXudvJZy4)

This directory groups the machine-readable artifacts from the same recorded qualification run.

The run demonstrates selective investigative-state capture, late semantic transfer during `/compress`, subsequent host reinjection, and fresh-chat recovery in a Git-root workspace.

## Evidence sequence

### 1. Pre-compress state checkpoint

[Pre-compress checkpoint](01-pre-compress-state-checkpoint.raw.txt)

The checkpoint already contains the material analysis of the 18 screenshots together with constraints, decisions, evidence, `do_not_repeat`, open items, and continuation state.

`M7RK-5316` is not present in this checkpoint.

### 2. `/compress` coverage audit

[`/compress` coverage audit](02-compress-coverage-audit.raw.txt)

The audited candidate surface is `14..327`.

The runtime explicitly reports:

```text
Transferred: the M7RK-5316 label fact and the user-changed approval policy.
```

The local token estimates printed by this run are preserved as runtime output but are not used as compression-ratio evidence.

### 3. Post-compress host injection

[Post-compress context injection](03-post-compress-context-injection.raw.txt)

The subsequent host-injected durable state contains `M7RK-5316`.

The same artifact exposes bounded projection metadata including:

```text
field_aware: true
soft_max_chars: 12000
full_state_path: .dsh/project/WORKING_STATE.json
```

It also records the critical fields preserved by the projection and explicitly states that raw hidden reasoning is not durable memory.

### 4. Fresh-chat recovery

The recording then opens a fresh chat in the same Git-root project and recalls `M7RK-5316` without user repetition.

## Evidence chain

```text
older active conversation
        |
        | contains M7RK-5316
        v
pre-compress investigative checkpoint
        |
        | M7RK-5316 absent
        v
/compress coverage audit
        |
        | M7RK-5316 explicitly transferred
        v
post-compress host injection
        |
        | M7RK-5316 present
        v
fresh-chat recall
```

## Evidence boundary

This case demonstrates the positive late-transfer path: material missing from the pre-compress durable state was discovered and transferred during semantic evacuation.

It does not separately demonstrate a naturalistic case where semantic coverage remains unresolved after evacuation and reclamation is therefore refused.

The `/compress` output also prints:

```text
Before estimated active surface: ~40232 tokens
After active surface estimate: ~40385 tokens
```

Those values are not used as a compression-ratio claim. The older preserved `25,582 -> 18,312` trace remains the explicit active-surface reduction example.
