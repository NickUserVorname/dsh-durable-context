# Video Evidence

These recordings are live runtime evidence. They supplement machine-readable traces, captured state, and preserved implementation artifacts.

## Clean Git-root qualification

[Selective capture, late transfer and fresh-chat recovery](https://youtu.be/V3mXudvJZy4)

A clean end-to-end run showing:

- previous project state absent after `git init`;
- selective investigative-state capture during analysis of 18 screenshots;
- `M7RK-5316` absent from the initial investigative checkpoint;
- explicit transfer of `M7RK-5316` during `/compress`;
- the transferred fact present in the following host injection;
- fresh-chat recall without user repetition.

Companion machine-readable evidence:

[Selective capture + late transfer qualification](../qualification/2026-08-28-selective-capture-late-transfer/)

## Real-world multi-image analysis

[Long-running real-world qualification](https://youtu.be/7Jjz0XGB7zA)

A longer iterative run including image analysis, a tool path that did not provide actual image pixels, an incorrect evidence interpretation, later correction after the image was actually read, durable state updates, and continuation in a fresh chat.

## Same non-Git workspace after chat/UI reset and folder rename

[State persists after chat/UI reset and folder rename](https://youtu.be/sIKrtONfS_Y)

The previous durable injection remains after the previous conversation is deleted, the workspace is removed from the DSH UI, the same non-Git folder is renamed, and a fresh conversation is opened from that renamed folder.

## Previous state injected into a different new non-Git project

[Different new non-Git project receives previous state](https://youtu.be/cNVDXxQAVok)

A different new non-Git folder is opened as a fresh DSH project, yet the previous project's durable state is injected into it.

## Early same-workspace cross-chat baseline

[Same-workspace cross-chat injection](https://youtu.be/DNd-Tkx-Uec)

This earliest preserved recording shows durable project state from an existing DSH workspace being injected into a fresh chat opened in the same workspace.

The video itself is not stored in the Git repository.

Original filename:

`2026-08-26_21-27-41.mkv`

Original size:

`25557152 bytes`

Original SHA-256:

`ffea7e79531ebdb95f42aa7824711102bcc9dfbdb028d92cde9e6fe80b88912b`

YouTube re-encodes uploaded media. The SHA-256 above identifies the original local MKV, not the YouTube stream.
