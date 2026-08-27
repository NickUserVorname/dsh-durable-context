const ADDITIVE_FIELDS = ['known', 'constraints', 'decisions', 'evidence', 'do_not_repeat']
const MODEL_REPLACE_FIELDS = ['next_action']
const CRITICAL_FIELDS = ['constraints', 'failed_hypotheses', 'do_not_repeat', 'open_acceptance', 'next_action']

function uniq(values = []) {
  return [...new Set((values ?? []).map(v => String(v).trim()).filter(Boolean))]
}

export function emptyWorkingState(taskId = null) {
  return {
    schema_version: 7,
    task_id: taskId,
    known: [], constraints: [], decisions: [], evidence: [], failed_hypotheses: [],
    do_not_repeat: [], open_acceptance: [], next_action: [],
    checkpoint_meta: { mode: 'init', updated_at: null, covered_evidence_ids: [], checkpoint_id: null, checkpoint_kind: null, protocol_committed_through_seq: null, prune_safe_through_seq: null, session_revision: null, source_revision: null, state_hash: null },
  }
}

export function checkpointPayloadValidation(args = {}, pendingEvidenceIds = []) {
  const pending = uniq(pendingEvidenceIds)
  const covered = new Set(uniq(args.covered_evidence_ids))
  const missing = pending.filter(id => !covered.has(id))
  if (missing.length) return { ok: false, reason: `CHECKPOINT_COVERAGE_MISSING: ${missing.join(', ')}`, missing }
  if (pending.length > 0) {
    const substantive = [...ADDITIVE_FIELDS, ...MODEL_REPLACE_FIELDS]
      .some(field => uniq(args[field]).length > 0)
    if (!substantive) return { ok: false, reason: 'CHECKPOINT_EMPTY_FOR_PENDING_EVIDENCE: externalize at least one known/decision/evidence/do_not_repeat/next_action item', missing: [] }
  }
  return { ok: true, missing: [] }
}

export function mergeWorkingState(previous, args, {
  taskId,
  failedHypotheses = [],
  hostOpenAcceptance = [],
  now = new Date().toISOString(),
  preserveAcrossTaskChange = false,
} = {}) {
  const mode = args.mode ?? 'merge'
  if (!['merge', 'replace'].includes(mode)) throw new Error(`Unsupported checkpoint mode: ${mode}`)
  const base = preserveAcrossTaskChange ? (previous ?? emptyWorkingState(taskId)) : (previous?.task_id === taskId ? previous : emptyWorkingState(taskId))
  const next = emptyWorkingState(taskId)
  if (mode === 'replace') {
    for (const field of ADDITIVE_FIELDS) next[field] = uniq(args[field])
    next.next_action = uniq(args.next_action)
  } else {
    for (const field of ADDITIVE_FIELDS) next[field] = uniq([...(base[field] ?? []), ...(args[field] ?? [])])
    next.next_action = args.next_action === undefined ? uniq(base.next_action) : uniq(args.next_action)
  }
  // Host-authoritative fields cannot be erased or rewritten by model checkpoint payloads.
  next.failed_hypotheses = failedHypotheses
  next.open_acceptance = uniq(hostOpenAcceptance)
  next.checkpoint_meta = {
    mode,
    updated_at: now,
    covered_evidence_ids: uniq(args.covered_evidence_ids),
  }
  return next
}

function jsonLen(value) { return JSON.stringify(value).length }
function recentWithinBudget(values, budget) {
  const list = uniq(values)
  if (budget <= 4 || list.length === 0) return { items: [], omitted: list.length }
  const chosen = []
  let used = 2
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const item = list[i]
    const cost = jsonLen(item) + (chosen.length ? 1 : 0)
    if (used + cost > budget) break
    chosen.unshift(item)
    used += cost
  }
  return { items: chosen, omitted: list.length - chosen.length }
}

/**
 * Field-aware bounded projection. Critical fields are never displaced by a huge `known` array.
 * maxChars is a soft budget for bulk fields; critical fields remain complete even if that makes
 * the snapshot exceed maxChars. The full authoritative JSON always remains on disk.
 */
export function projectWorkingState(state, { maxChars = 12000, pendingEvidence = [] } = {}) {
  const safe = state ?? emptyWorkingState(null)
  const critical = {
    constraints: safe.constraints ?? [],
    failed_hypotheses: safe.failed_hypotheses ?? [],
    do_not_repeat: safe.do_not_repeat ?? [],
    open_acceptance: safe.open_acceptance ?? [],
    next_action: safe.next_action ?? [],
    pending_evidence: pendingEvidence ?? [],
  }
  const criticalCost = jsonLen(critical) + 1000
  const bulkBudget = Math.max(0, maxChars - criticalCost)
  // Priority for bulk memory: decisions/evidence first, then known. Allocate deterministic shares.
  const effectiveBulkBudget = bulkBudget
  const decisions = recentWithinBudget(safe.decisions ?? [], Math.floor(effectiveBulkBudget * 0.34))
  const evidence = recentWithinBudget(safe.evidence ?? [], Math.floor(effectiveBulkBudget * 0.34))
  const known = recentWithinBudget(safe.known ?? [], Math.max(0, effectiveBulkBudget - Math.floor(effectiveBulkBudget * 0.68)))
  return {
    task_id: safe.task_id,
    ...critical,
    decisions: decisions.items,
    evidence: evidence.items,
    known: known.items,
    projection_meta: {
      field_aware: true,
      soft_max_chars: maxChars,
      omitted: { decisions: decisions.omitted, evidence: evidence.omitted, known: known.omitted },
      full_state_path: '.dsh/project/WORKING_STATE.json',
      critical_fields_preserved: CRITICAL_FIELDS,
    },
  }
}

export function renderWorkingStateContext(state, { checkpointRequired = false, maxChars = 12000, pendingEvidence = [] } = {}) {
  const projection = projectWorkingState(state, { maxChars, pendingEvidence })
  const body = JSON.stringify(projection, null, 2)
  const pendingIds = (pendingEvidence ?? []).map(x => typeof x === 'string' ? x : x?.id).filter(Boolean)
  const barrier = checkpointRequired
    ? `CHECKPOINT BARRIER ACTIVE: before any further work/tool, call task_checkpoint(mode="merge", covered_evidence_ids=[${pendingIds.map(x => JSON.stringify(x)).join(', ')}], ...) and externalize substantive state from those pending tool/evidence items. All other tools are denied until checkpoint succeeds.`
    : 'Continue from this distilled state. Do not reconstruct discarded raw reasoning when explicit evidence/state already exists.'
  return [
    'QWEN-V4 DURABLE WORKING STATE SNAPSHOT (host-injected; authoritative file remains .dsh/project/WORKING_STATE.json):',
    body,
    barrier,
  ].join('\n')
}

export function checkpointDue(task, { isAutomaticGoalRound = false, maxStepsWithoutCheckpoint = 3 } = {}) {
  const execution = task?.execution ?? {}
  const meaningful = Number(execution.meaningful_since_checkpoint ?? 0)
  const steps = Number(execution.steps_since_checkpoint ?? 0)
  if (meaningful <= 0) return false
  if (isAutomaticGoalRound) return true
  return steps >= maxStepsWithoutCheckpoint
}

export function resetCheckpointCounters(task, { at, sessionId, seq } = {}) {
  task.execution ??= {}
  task.execution.steps_since_checkpoint = 0
  task.execution.meaningful_since_checkpoint = 0
  task.execution.pending_evidence = []
  task.execution.checkpoint_required = false
  task.execution.last_checkpoint_at = at ?? new Date().toISOString()
  task.execution.last_checkpoint_session_id = sessionId ?? null
  task.execution.last_checkpoint_seq = seq ?? null
}
