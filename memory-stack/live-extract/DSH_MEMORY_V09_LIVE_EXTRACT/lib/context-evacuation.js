import crypto from 'node:crypto'
import { readJson, atomicWriteJson, withRuntimeLock } from './state.js'
import { current } from './host-runtime.js'
import { emptyWorkingState } from './working-state.js'
import { authorizeCompactionWorkingState } from './context-memory.js'
import { surfaceTurnOwnership, executeStructuredCompaction, isStructuredCompactionEvent } from './context-pressure.js'
import { runFresh, roleAgentOptions } from './fresh-role.js'
import { roleBudgetFor, loadRuntimePolicy } from './runtime-policy.js'

const COVERAGE_VALUES = ['COVERED','NONE','UNCERTAIN']
export const COMPACTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    safe: { type: 'boolean' },
    summary: { type: 'string' },
    transfer: {
      type: 'object', additionalProperties: false,
      properties: {
        known: { type: 'array', items: { type: 'string' } },
        constraints: { type: 'array', items: { type: 'string' } },
        decisions: { type: 'array', items: { type: 'string' } },
        evidence: { type: 'array', items: { type: 'string' } },
        failed_hypotheses: { type: 'array', items: { type: 'string' } },
        do_not_repeat: { type: 'array', items: { type: 'string' } },
        open_acceptance: { type: 'array', items: { type: 'string' } },
        next_action: { type: 'array', items: { type: 'string' } },
      }, required: ['known','constraints','decisions','evidence','failed_hypotheses','do_not_repeat','open_acceptance','next_action'],
    },
    coverage: {
      type: 'object', additionalProperties: false,
      properties: {
        user_constraints: { type: 'string', enum: COVERAGE_VALUES },
        assistant_findings: { type: 'string', enum: COVERAGE_VALUES },
        tool_evidence: { type: 'string', enum: COVERAGE_VALUES },
        open_work: { type: 'string', enum: COVERAGE_VALUES },
      }, required: ['user_constraints','assistant_findings','tool_evidence','open_work'],
    },
    critical_items: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        properties: {
          source_seq: { type: 'integer' },
          kind: { type: 'string', enum: ['USER_CONSTRAINT','ASSISTANT_FINDING','TOOL_EVIDENCE','OPEN_WORK','OTHER'] },
          disposition: { type: 'string', enum: ['ALREADY_SURVIVES','TRANSFERRED','TRANSIENT'] },
          target_field: { type: 'string' },
          note: { type: 'string' },
        }, required: ['source_seq','kind','disposition','target_field','note'],
      },
    },
    uncovered: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        properties: { source_seq: { type: 'integer' }, reason: { type: 'string' } },
        required: ['source_seq','reason'],
      },
    },
  },
  required: ['safe','summary','transfer','coverage','critical_items','uncovered'],
}

function seqOf(node) { return Number(typeof node === 'number' ? node : node?.seq) }
function eventText(event) {
  if (!event) return ''
  if (event.type === 'user/message') {
    return (event.data?.content ?? []).map(block => block?.type === 'text' ? String(block.text ?? '') : JSON.stringify(block)).join('\n')
  }
  if (event.type === 'assistant/message') {
    const out = []
    for (const block of event.data?.message?.content ?? []) {
      if (block?.type === 'text') out.push(String(block.text ?? ''))
      else if (block?.type === 'tool-call') out.push(`TOOL_CALL ${block.name ?? ''} ${typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments ?? {})}`)
      // Hidden reasoning is intentionally not an object of v0.8 compaction.
    }
    return out.join('\n')
  }
  if (event.type === 'tool/result') {
    const msg = event.data?.message ?? {}
    return (msg.content ?? []).map(block => block?.type === 'text' ? String(block.text ?? '') : JSON.stringify(block)).join('\n')
  }
  return ''
}

function roleLabel(event) {
  if (event?.type === 'user/message') return event.data?.source?.kind === 'user' ? 'USER' : 'HOST/PLUGIN'
  if (event?.type === 'assistant/message') return 'ASSISTANT'
  if (event?.type === 'tool/result') return 'TOOL_RESULT'
  return event?.type ?? 'UNKNOWN'
}

function recentStartIndex(nodes, ownership, completedTurns, minRecentTurns) {
  const tailTurns = []
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const t = ownership.get(nodes[i].seq)
    if (t !== undefined && completedTurns.has(t) && !tailTurns.includes(t)) tailTurns.unshift(t)
    if (tailTurns.length >= minRecentTurns) break
  }
  const keep = new Set(tailTurns)
  let start = nodes.length
  for (let i = 0; i < nodes.length; i += 1) {
    if (keep.has(ownership.get(nodes[i].seq))) { start = i; break }
  }
  return { start, turns: tailTurns }
}

export function planEvacuationCandidate(ctx, agent, runtime, { maxChars = 72000 } = {}) {
  const session = agent?.session
  if (!ctx?.tokenMeter?.measure || !session?.surface?.nodes) return { ok: false, reason: 'COMPACTION_SURFACE_UNAVAILABLE' }
  const policy = roleBudgetFor(runtime, 'CONTEXT_COMPACTOR')
  const pressureCfg = loadRuntimePolicy(runtime).context_pressure
  const measurement = ctx.tokenMeter.measure(session)
  const nodes = Array.from(measurement.nodes ?? []).map(x => ({ seq: Number(x.seq), tokens: Number(x.tokens ?? 0) })).filter(x => Number.isFinite(x.seq))
  if (!nodes.length) return { ok: false, reason: 'COMPACTION_NOTHING_TO_DO' }
  const { ownership, completedTurns } = surfaceTurnOwnership(session, nodes.map(x => x.seq))
  const recent = recentStartIndex(nodes, ownership, completedTurns, pressureCfg.min_recent_turns)
  const events = new Map((session.events ?? []).map(e => [Number(e.seq), e]))
  let markerCount = 0
  while (markerCount < nodes.length && isStructuredCompactionEvent(events.get(nodes[markerCount].seq))) markerCount += 1
  if (recent.start <= markerCount) return { ok: false, reason: 'COMPACTION_NO_OLD_COMPLETED_TURNS' }

  const rendered = []
  let endIndex = markerCount - 1
  let chars = 0
  for (let i = markerCount; i < recent.start; i += 1) {
    const node = nodes[i]
    const turn = ownership.get(node.seq)
    if (turn === undefined || !completedTurns.has(turn)) break
    const event = events.get(node.seq)
    const text = `[SEQ ${node.seq}] [${roleLabel(event)}]\n${eventText(event)}\n`
    if (chars + text.length > maxChars) break
    rendered.push(text); chars += text.length; endIndex = i
  }
  if (endIndex < markerCount) return { ok: false, reason: 'COMPACTION_CANDIDATE_EXCEEDS_INPUT_BUDGET' }
  // Never split a completed turn.
  while (endIndex >= 0 && endIndex + 1 < nodes.length) {
    const t = ownership.get(nodes[endIndex].seq)
    const next = ownership.get(nodes[endIndex + 1].seq)
    if (t !== undefined && completedTurns.has(t) && next !== t) break
    endIndex -= 1
    rendered.pop()
  }
  if (endIndex < markerCount) return { ok: false, reason: 'COMPACTION_NO_SAFE_COMPLETED_TURN_PREFIX' }
  const selected = nodes.slice(markerCount, endIndex + 1)
  const text = selected.map(node => {
    const event = events.get(node.seq)
    return `[SEQ ${node.seq}] [${roleLabel(event)}]\n${eventText(event)}\n`
  }).join('\n')
  if (text.length > maxChars) return { ok: false, reason: 'COMPACTION_CANDIDATE_EXCEEDS_INPUT_BUDGET' }
  return {
    ok: true,
    start: selected[0].seq,
    end: selected.at(-1).seq,
    seqs: selected.map(x => x.seq),
    estimatedTokens: selected.reduce((n, x) => n + x.tokens, 0),
    text,
    sessionRevision: Number(session.seq ?? session.events?.length ?? 0),
    retainedRecentTurns: recent.turns,
    roleInputCap: policy.max_input_chars,
  }
}

const TRANSFER_FIELDS = ['known','constraints','decisions','evidence','failed_hypotheses','do_not_repeat','open_acceptance','next_action']

function canonicalProjectState(runtime) {
  const requirements = readJson(runtime.paths.requirements, { schema_version: 3, requirements: [] })
  const sourceIndex = readJson(runtime.paths.sourceIndex, { schema_version: 3, revision: 0, generation: 0, conflicts: [], sources: [], intake: {} })
  return {
    active_requirements: requirements,
    source_index: {
      schema_version: sourceIndex?.schema_version ?? null,
      status: sourceIndex?.status ?? null,
      revision: sourceIndex?.revision ?? null,
      generation: sourceIndex?.generation ?? null,
      conflicts: sourceIndex?.conflicts ?? [],
      sources: sourceIndex?.sources ?? [],
      intake: sourceIndex?.intake ?? {},
    },
  }
}

function auditConsistency(structured, candidate) {
  if (!coverageSafe(structured)) return { ok: false, reason: 'coverage is not fail-closed safe' }
  const allowedSeqs = new Set((candidate?.seqs ?? []).map(Number))
  for (const item of structured?.critical_items ?? []) {
    const seq = Number(item?.source_seq)
    if (!allowedSeqs.has(seq)) return { ok: false, reason: `critical item references source_seq outside candidate: ${seq}` }
    if (item?.disposition === 'TRANSFERRED') {
      const field = String(item?.target_field ?? '')
      if (!TRANSFER_FIELDS.includes(field)) return { ok: false, reason: `TRANSFERRED item has invalid target_field: ${field || '<empty>'}` }
      if (!Array.isArray(structured?.transfer?.[field]) || structured.transfer[field].length === 0) {
        return { ok: false, reason: `TRANSFERRED item points to empty transfer field: ${field}` }
      }
    }
  }
  for (const item of structured?.uncovered ?? []) {
    const seq = Number(item?.source_seq)
    if (!allowedSeqs.has(seq)) return { ok: false, reason: `uncovered item references source_seq outside candidate: ${seq}` }
  }
  return { ok: true }
}

function coverageSafe(structured) {
  const states = Object.values(structured?.coverage ?? {})
  return structured?.safe === true && Array.isArray(structured?.uncovered) && structured.uncovered.length === 0
    && states.length === 4 && states.every(x => x === 'COVERED' || x === 'NONE')
}

function stateFingerprint(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex') }

export async function evacuateAndCompact(ctx, agent, runtime, signal, resolved, { dryRun = false } = {}) {
  const roleBudget = roleBudgetFor(runtime, 'CONTEXT_COMPACTOR')

  // Capture every surviving authority source before selecting the prune span.
  // A checkpoint timestamp is never accepted as coverage proof by itself.
  const basis = await withRuntimeLock(runtime, () => {
    const { state, task } = current(runtime)
    if (state.operation) throw new Error(`COMPACTION_BUSY: project operation ${state.operation.kind} is active`)
    if (state.task_state === 'IN_PROGRESS') throw new Error('COMPACTION_BUSY: active /work task must checkpoint/pause/finish before session-surface compaction')
    const working = readJson(runtime.paths.workingState, emptyWorkingState(task?.id ?? null))
    const canonical = canonicalProjectState(runtime)
    return {
      sourceRevision: Number(state.source_revision ?? 0),
      working,
      canonical,
      workingFingerprint: stateFingerprint(working),
      canonicalFingerprint: stateFingerprint(canonical),
    }
  })

  const survivorText = [
    'CURRENT SURVIVING CANONICAL PROJECT STATE:',
    JSON.stringify(basis.canonical, null, 2),
    '',
    'CURRENT SURVIVING INVESTIGATIVE WORKING STATE:',
    JSON.stringify(basis.working, null, 2),
  ].join('\n')
  // Leave explicit room for persona/instructions/schema. If surviving authority
  // itself is too large, refuse instead of silently truncating the very state
  // against which coverage must be proven.
  const candidateChars = Number(roleBudget.max_input_chars) - survivorText.length - 8000
  if (candidateChars < 8000) return { ok: false, reason: 'COMPACTION_SURVIVING_STATE_EXCEEDS_ROLE_INPUT_BUDGET' }
  const candidate = planEvacuationCandidate(ctx, agent, runtime, { maxChars: Math.min(72000, candidateChars) })
  if (!candidate.ok) return candidate

  const structured = await runFresh(ctx, agent, signal, {
    label: 'context-compactor', role: 'CONTEXT_COMPACTOR', runtime,
    persona: 'You are a fail-closed context compactor. You do not summarize the conversation for style. You perform semantic evacuation before an old visible/tool span may leave active model context. Preserve every still-live user constraint, assistant diagnostic finding, tool evidence, unresolved/open work item, and low-abstraction fingerprint needed to resume without repeating investigation. Canonical ACTIVE_REQUIREMENTS/SOURCE_INDEX and existing WORKING_STATE count as surviving representation. Transfer only missing live information. Exact diagnostic log/output lines, values, file:line, reproduction conditions and counterexamples should remain concrete when useful. Mark UNCERTAIN and safe=false whenever you cannot prove the candidate can be removed without losing needed semantics. Hidden chain-of-thought is out of scope. Return only the requested structured object.',
    prompt: `${survivorText}\n\nPRUNE CANDIDATE SURFACE ${candidate.start}..${candidate.end}:\n${candidate.text}\n\nAudit whether every still-live semantic dependency in the candidate already survives in canonical/working state or is explicitly transferred. Do not treat a prior checkpoint timestamp as proof of coverage. source_seq values MUST refer to events inside the prune candidate.`,
    outputSchema: COMPACTION_SCHEMA,
    agentOptions: roleAgentOptions(resolved, roleBudget.max_tokens_per_request),
    allowedRoots: [runtime.root, runtime.paths.project], tokenizerEndpoint: resolved?.tokenizerEndpoint,
  })
  const consistency = auditConsistency(structured, candidate)
  if (!consistency.ok) {
    return { ok: false, reason: `COMPACTION_REFUSED: invalid coverage audit: ${consistency.reason}`, candidate, audit: structured }
  }
  if (dryRun) return { ok: true, dryRun: true, candidate, audit: structured, before: ctx.tokenMeter.measure(agent.session).totalTokens, afterEstimate: null, start: candidate.start, end: candidate.end, shadowedSeqs: candidate.seqs, retainedRecentTurns: candidate.retainedRecentTurns, checkpointId: basis.working?.checkpoint_meta?.checkpoint_id ?? null }

  const auditId = `CA-${crypto.randomUUID()}`
  await withRuntimeLock(runtime, async () => {
    if (Number(agent.session?.seq ?? agent.session?.events?.length ?? 0) !== candidate.sessionRevision) throw new Error('COMPACTION_STALE_SESSION_REVISION')
    const { state, task } = current(runtime)
    if (state.operation) throw new Error(`COMPACTION_BUSY: project operation ${state.operation.kind} is active`)
    if (state.task_state === 'IN_PROGRESS') throw new Error('COMPACTION_BUSY: active task resumed during audit')
    if (Number(state.source_revision ?? 0) !== basis.sourceRevision) throw new Error('COMPACTION_STALE_SOURCE_REVISION')
    const currentWorking = readJson(runtime.paths.workingState, emptyWorkingState(task?.id ?? null))
    if (stateFingerprint(currentWorking) !== basis.workingFingerprint) throw new Error('COMPACTION_STALE_WORKING_STATE')
    const currentCanonical = canonicalProjectState(runtime)
    if (stateFingerprint(currentCanonical) !== basis.canonicalFingerprint) throw new Error('COMPACTION_STALE_CANONICAL_STATE')
    const next = authorizeCompactionWorkingState(currentWorking, structured.transfer, {
      pruneSafeThroughSeq: candidate.end,
      sourceRevision: basis.sourceRevision,
      session: agent.session,
      auditId,
    })
    atomicWriteJson(runtime.paths.workingState, next)
  })
  const compacted = await withRuntimeLock(runtime, () => executeStructuredCompaction(ctx, agent, runtime, { dryRun: false }))
  if (!compacted.ok) return { ...compacted, audit: structured, auditId, candidate }
  return { ...compacted, audit: structured, auditId, candidate }
}

export const _evacuationTest = { eventText, coverageSafe, auditConsistency, canonicalProjectState, recentStartIndex }
