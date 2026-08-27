# Artifact Manifest

## Primary preserved implementation artifact

Artifact:

`memory-stack/DSH_MEMORY_V09_LIVE_EXTRACT.zip`

Role:

Preserved live memory/context subsystem extract.

Size bytes:

`71519`

SHA-256:

`798d7e1f8579d7321e554b8f997691daa9adf7f8e5ef3f32c82587fcfa8d3854`

Original LastWriteTime UTC at staging:

`2026-08-26T18:14:20.0710753Z`

Readable extracted representation:

`memory-stack/live-extract/DSH_MEMORY_V09_LIVE_EXTRACT/`

The extract is a live-derived subsystem extraction, not a complete v0.8 -> v0.9 changelog. Preserved module bodies come from a live-installed freeze; the thin standalone entrypoint was assembled from later live integration hooks.

## Primary live evidence

### Runtime troubleshooting log

Location:

`evidence/live-logs/`

Preserved log SHA-256:

`4218480c0d16739db4c412628f6471500d0c81e1b1d1c6149877367a142b73de`

### Captured durable state

Location:

`evidence/memory-injections/WORKING_STATE.json`

SHA-256:

`ce26acd2be7ac52bf7dc8737df1915a02830381b068ab444e6768048e3c0a986`

### Provider usage CSV

Location:

`evidence/usage-2026-08-19.redacted.csv`

Role:

Public redacted derivative.

SHA-256:

`933f3aa66c290d4d2206eae0f127f3a335725a293168e6c6953dfe0cbb32825b`

### Provider usage screenshot

Location:

`evidence/serverless-usage-2026-08-21.png`

SHA-256:

`98dfdc7937e702559641c0361556746059aa119c7cb0a68b297df28e3153bdae`

### Original qualification video

Original filename:

`2026-08-26_21-27-41.mkv`

Repository storage:

Not stored in Git.

External viewing copy:

https://youtu.be/DNd-Tkx-Uec

Original size bytes:

`25557152`

Original SHA-256:

`ffea7e79531ebdb95f42aa7824711102bcc9dfbdb028d92cde9e6fe80b88912b`

The YouTube stream is re-encoded and is not expected to match the original SHA-256.

## Identity rules

Filesystem timestamps are auxiliary provenance only.

SHA-256 and documented artifact lineage are the primary identity mechanism.

The repo-level `SHA256SUMS.txt` contains hashes for files actually represented as preserved repository artifacts.

Historical archive hashes are recorded there separately.

