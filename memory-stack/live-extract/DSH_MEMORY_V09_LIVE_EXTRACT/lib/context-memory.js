import crypto from 'node:crypto'
import { emptyWorkingState, mergeWorkingState, projectWorkingState } from './working-state.js'

const MODEL_FIELDS = Object.freeze([
  'known', 'constraints', 'decisions', 'evidence', 'failed_hypotheses',
  'do_not_repeat', 'open_acceptance', 'next_action',
])

function uniq(values = []) {
  return [...new Set((values ?? []).map(v => String(v).trim()).filter(Boolean))]
}

function jsonHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function hasSemanticDelta(args = {}) {
  return MODEL_FIELDS.some(field => uniq(args[field]).length > 0)
}

export function validateUniversalCheckpoint(args = {}) {
  if (args.no_change === true) return { ok: false, reason: 'STATE_CHECKPOINT_NO_CHANGE_DEPRECATED: omit state_checkpoint when no material investigative state changed' }
  if (!hasSemanticDelta(args)) return { ok: false, reason: 'STATE_CHECKPOINT_EMPTY: omit the tool unless a material investigative state delta exists' }
  return { ok: true }
}

export function coverageForSession(session) {
  const raw = Array.from(session?.surface?.nodes ?? [])
  const seqs = raw.map(node => Number(typeof node === 'number' ? node : node?.seq)).filter(Number.isFinite)
  return {
    observed_surface_through_seq: seqs.length ? seqs[seqs.length - 1] : null,
    session_revision: Number(session?.seq ?? session?.events?.length ?? 0),
  }
}

/**
 * Incremental investigative-state commit. This deliberately does NOT grant prune
 * authority. `prune_safe_through_seq` is host-owned and may only advance after a
 * separate semantic-evacuation + coverage audit performed by /compress.
 */
export function commitUniversalWorkingState(previous, args, {
  taskId = null,
  failedHypotheses = [],
  hostOpenAcceptance = [],
  sourceRevision = 0,
  session,
  checkpointKind = 'investigative-state',
  now = new Date().toISOString(),
} = {}) {
  const prior = previous ?? emptyWorkingState(taskId)
  const next = mergeWorkingState(prior, { ...args, mode: args.mode ?? 'merge' }, {
    taskId,
    failedHypotheses,
    hostOpenAcceptance,
    now,
    preserveAcrossTaskChange: true,
  })
  const coverage = coverageForSession(session)
  const semantic = {
    task_id: next.task_id,
    known: next.known,
    constraints: next.constraints,
    decisions: next.decisions,
    evidence: next.evidence,
    failed_hypotheses: next.failed_hypotheses,
    do_not_repeat: next.do_not_repeat,
    open_acceptance: next.open_acceptance,
    next_action: next.next_action,
  }
  const priorMeta = prior?.checkpoint_meta ?? {}
  const rawPriorPruneSafe = priorMeta.prune_safe_through_seq
  const priorPruneSafe = rawPriorPruneSafe === null || rawPriorPruneSafe === undefined
    ? null
    : (Number.isInteger(Number(rawPriorPruneSafe)) ? Number(rawPriorPruneSafe) : null)
  next.checkpoint_meta = {
    ...(next.checkpoint_meta ?? {}),
    checkpoint_id: `CP-${crypto.randomUUID()}`,
    checkpoint_kind: checkpointKind,
    updated_at: now,
    // Observational only: proves what surface existed when this delta was written,
    // not that the surface is semantically replaceable.
    protocol_committed_through_seq: coverage.observed_surface_through_seq,
    prune_safe_through_seq: priorPruneSafe,
    session_revision: coverage.session_revision,
    source_revision: Number(sourceRevision ?? 0),
    state_hash: jsonHash(semantic),
  }
  return next
}

export function authorizeCompactionWorkingState(previous, transfer = {}, {
  pruneSafeThroughSeq,
  sourceRevision = 0,
  session,
  auditId = null,
  now = new Date().toISOString(),
} = {}) {
  const prior = previous ?? emptyWorkingState(null)
  const additive = {}
  for (const field of ['known','constraints','decisions','evidence','do_not_repeat']) {
    if (Array.isArray(transfer?.[field]) && transfer[field].length) additive[field] = transfer[field]
  }
  if (Array.isArray(transfer?.next_action) && transfer.next_action.length) additive.next_action = transfer.next_action
  const failed = uniq([...(prior.failed_hypotheses ?? []), ...(transfer?.failed_hypotheses ?? [])])
  const acceptance = uniq([...(prior.open_acceptance ?? []), ...(transfer?.open_acceptance ?? [])])
  const next = mergeWorkingState(prior, { mode: 'merge', ...additive }, {
    taskId: prior.task_id ?? null,
    failedHypotheses: failed,
    hostOpenAcceptance: acceptance,
    now,
    preserveAcrossTaskChange: true,
  })
  const semantic = {
    task_id: next.task_id,
    known: next.known,
    constraints: next.constraints,
    decisions: next.decisions,
    evidence: next.evidence,
    failed_hypotheses: next.failed_hypotheses,
    do_not_repeat: next.do_not_repeat,
    open_acceptance: next.open_acceptance,
    next_action: next.next_action,
  }
  const coverage = coverageForSession(session)
  const priorSafeRaw = prior?.checkpoint_meta?.prune_safe_through_seq
  const priorSafe = Number.isInteger(Number(priorSafeRaw)) ? Number(priorSafeRaw) : null
  const requested = Number(pruneSafeThroughSeq)
  if (!Number.isInteger(requested) || requested < 0) throw new Error('COMPACTION_INVALID_PRUNE_BOUNDARY')
  next.checkpoint_meta = {
    ...(next.checkpoint_meta ?? {}),
    checkpoint_id: `CP-${crypto.randomUUID()}`,
    checkpoint_kind: 'compaction-evacuation',
    updated_at: now,
    protocol_committed_through_seq: coverage.observed_surface_through_seq,
    prune_safe_through_seq: priorSafe === null ? requested : Math.max(priorSafe, requested),
    session_revision: coverage.session_revision,
    source_revision: Number(sourceRevision ?? 0),
    state_hash: jsonHash(semantic),
    prune_audit_id: auditId,
    prune_audited_at: now,
  }
  return next
}

export function renderUniversalStateSnapshot(state, { maxChars = 12000 } = {}) {
  const projection = projectWorkingState(state, { maxChars, pendingEvidence: [] })
  return [
    'QWEN-V4 DURABLE INVESTIGATIVE WORKING STATE (host-injected):',
    JSON.stringify(projection, null, 2),
    'Raw hidden reasoning is not durable memory. Use this state only as accumulated problem-solving facts; ordinary conversation remains in the normal visible history.',
  ].join('\n')
}

export function hasDurableWorkingState(state) {
  const safe = state ?? {}
  return MODEL_FIELDS.some(field => Array.isArray(safe[field]) && safe[field].length > 0)
}

export function investigativeStateInstruction({ mutationAuthority = null } = {}) {
  const lines = [
    'QWEN-V4 WORK-MODE POLICY (host generated; no separate classifier/finalizer request).',
    'Answer ordinary conversation normally. state_checkpoint is OPTIONAL and should usually be omitted.',
    'When the current conversation is investigative / iterative problem-solving (for example troubleshooting/debugging, research/OSINT, testing, experiments, analytical investigation, or iterative construction) AND this turn establishes a material finding needed to resume the same task after old visible history is removed, include the normal user-facing answer and call state_checkpoint once in the SAME assistant response.',
    'Persist only transferable findings: known facts, constraints, decisions, concrete evidence, hypothesis verdicts, do-not-repeat items, open acceptance conditions, or next action. Preserve diagnostically useful evidence at low abstraction when helpful (exact log/output lines, values, file:line, fingerprints, reproduction conditions, counterexamples).',
    'Do not checkpoint the current request itself, answer formatting, waiting-for-user state, transient orchestration, or one-off tool/protocol failures unless they are diagnostic evidence for the problem being investigated. If nothing material changed, do not call state_checkpoint.',
  ]
  if (mutationAuthority) lines.push(mutationAuthority)
  return lines.join('\n')
}

export function structuredCompactionMessage(state, meta = {}) {
  const projection = projectWorkingState(state, { maxChars: Number(meta.maxChars ?? 12000), pendingEvidence: [] })
  return [
    'QWEN-V4 STRUCTURED COMPACTION SNAPSHOT.',
    'This surface node replaces only history that passed semantic evacuation and host coverage validation. The raw append-only session log remains the audit source.',
    JSON.stringify({
      checkpoint_id: state?.checkpoint_meta?.checkpoint_id ?? null,
      state_hash: state?.checkpoint_meta?.state_hash ?? null,
      observed_when_state_committed_through_seq: state?.checkpoint_meta?.protocol_committed_through_seq ?? null,
      prune_safe_through_seq: state?.checkpoint_meta?.prune_safe_through_seq ?? null,
      compacted_surface: meta.compactedSurface ?? null,
      working_state: projection,
    }, null, 2),
  ].join('\n')
}
