# Provenance

This folder was assembled from the materials supplied in the conversation.

- Memory module bodies under `lib/` come byte-for-byte from `FREEZE-20260825-184955.rar` -> `QWEN-V4/live-installed/local-dsh-v4-control`.
- That freeze explicitly identifies `live-installed` as the live-patched runtime copy and was created before canonical v0.9 packaging.
- The thin `index.js` integration entrypoint is newly assembled from the memory-related hooks visible in the separately supplied **current live** `index.js` (including the current registration of lossless hygiene, universal memory commit, context commands, and fresh-role guards).
- `reference/current-live-index.full.js` is the supplied current live index for comparison.

No claim is made that post-freeze memory module bodies were changed unless a separately supplied current file proves it. The available current file proves later changes in the central `index.js`; it does not provide newer copies of each `lib/context-*.js` module.
