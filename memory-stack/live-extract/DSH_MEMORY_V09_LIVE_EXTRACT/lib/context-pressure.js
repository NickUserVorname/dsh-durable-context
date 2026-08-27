import crypto from 'node:crypto'
import { readJson } from './state.js'
import { emptyWorkingState } from './working-state.js'
import { structuredCompactionMessage } from './context-memory.js'
import { loadRuntimePolicy } from './runtime-policy.js'

export const PRESSURE = Object.freeze({
  NORMAL: 'NORMAL',
  SOFT: 'SOFT_PRESSURE',
  HARD: 'COMPACTION_REQUIRED',
  UNKNOWN: 'UNKNOWN',
})

export function pluginContextMessage(text, section = 'qwen-v4-context-pressure') {
  const id = crypto.randomUUID()
  return Object.freeze({
    id,
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
    source: Object.freeze({ kind: 'plugin', plugin: 'local-dsh-v4-control', form: 'snapshot', sections: Object.freeze([Object.freeze({ name: section, text })]) }),
  })
}

export function isStructuredCompactionEvent(event) {
  if (event?.type !== 'user/message') return false
  const source = event?.data?.source ?? event?.data?.message?.source
  return Boolean(source?.kind === 'plugin' && source?.sections?.some?.(x => x?.name === 'qwen-v4-structured-compaction'))
}

function leadingCompactionMarkerCount(session, nodes) {
  const events = new Map((session?.events ?? []).map(e => [Number(e?.seq), e]))
  let count = 0
  while (count < nodes.length && isStructuredCompactionEvent(events.get(Number(nodes[count]?.seq)))) count += 1
  return count
}

function sourceEventSeqsForSurfaceNode(event, seq) {
  if (isStructuredCompactionEvent(event) && Array.isArray(event?.sourceEventSeqs)) {
    return [...new Set([Number(seq), ...event.sourceEventSeqs.map(Number)])].filter(Number.isFinite)
  }
  return [Number(seq)].filter(Number.isFinite)
}

function pressureState(safeHeadroom, cfg) {
  if (!Number.isFinite(safeHeadroom)) return PRESSURE.UNKNOWN
  if (safeHeadroom <= cfg.hard_headroom_tokens) return PRESSURE.HARD
  if (safeHeadroom <= cfg.soft_headroom_tokens) return PRESSURE.SOFT
  return PRESSURE.NORMAL
}

function safeEstimate(ctx, message) {
  try {
    const value = Number(ctx?.tokenMeter?.estimateMessage?.(message))
    return Number.isFinite(value) && value >= 0 ? value : 0
  } catch { return 0 }
}

export function measureContextPressure(ctx, agent, runtime, { incomingMessages = [], extraMessages = [] } = {}) {
  const policy = loadRuntimePolicy(runtime)
  const cfg = policy.context_pressure
  if (!ctx?.tokenMeter?.measure || !agent?.session) {
    return { pressure: PRESSURE.UNKNOWN, contextWindow: cfg.context_window, estimatedNextInput: null, safeHeadroom: null, measurement: null, config: cfg }
  }
  try {
    const measurement = ctx.tokenMeter.measure(agent.session)
    let incoming = 0
    for (const msg of [...incomingMessages, ...extraMessages]) incoming += safeEstimate(ctx, msg)
    const surface = Number(measurement.totalTokens ?? measurement.surfaceTokens ?? 0)
    const estimatedNextInput = Math.max(0, surface + incoming)
    const safeHeadroom = cfg.context_window
      - estimatedNextInput
      - cfg.completion_reserve_tokens
      - cfg.compression_recovery_reserve_tokens
      - cfg.safety_margin_tokens
    return {
      pressure: pressureState(safeHeadroom, cfg),
      contextWindow: cfg.context_window,
      estimatedNextInput,
      safeHeadroom,
      incomingTokens: incoming,
      measurement,
      config: cfg,
    }
  } catch (error) {
    return { pressure: PRESSURE.UNKNOWN, contextWindow: cfg.context_window, estimatedNextInput: null, safeHeadroom: null, measurement: null, config: cfg, error: String(error) }
  }
}

export function formatContextPressure(result) {
  const n = v => Number.isFinite(v) ? String(Math.round(v)) : 'unknown'
  const c = result.config ?? {}
  return [
    `CONTEXT_WINDOW: ${n(result.contextWindow)}`,
    `ESTIMATED_NEXT_INPUT: ${n(result.estimatedNextInput)}`,
    `COMPLETION_RESERVE: ${n(c.completion_reserve_tokens)}`,
    `COMPRESSION_RESERVE: ${n(c.compression_recovery_reserve_tokens)}`,
    `SAFETY_MARGIN: ${n(c.safety_margin_tokens)}`,
    `SAFE_HEADROOM: ${n(result.safeHeadroom)}`,
    `CONTEXT_PRESSURE: ${result.pressure ?? PRESSURE.UNKNOWN}`,
  ].join('\n')
}

export function softPressureNotice(result) {
  return pluginContextMessage([
    'QWEN-V4 CONTEXT PRESSURE NOTICE (host generated; this did not consume a separate model request).',
    `Safe context headroom is approximately ${Number.isFinite(result.safeHeadroom) ? Math.max(0, Math.round(result.safeHeadroom)) : 'unknown'} tokens.`,
    'The user may continue for now, or run /compress to semantically evacuate, audit, and prune an old active-history prefix while retaining the raw session log.',
  ].join('\n'))
}

export function hardPressureReason(result) {
  return `CONTEXT_COMPACTION_REQUIRED: safe_headroom=${Number.isFinite(result.safeHeadroom) ? Math.round(result.safeHeadroom) : 'unknown'}; run /compress before another normal model request`
}

function sortedEvents(session) {
  return [...(session?.events ?? [])].filter(Boolean).sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))
}

/**
 * Map surface event seqs to completed DSH turns conservatively. User messages can
 * precede turn/start, so the range owned by a completed turn starts immediately
 * after the preceding completed turn/end and ends at this turn/end.
 */
export function surfaceTurnOwnership(session, surfaceSeqs = []) {
  const events = sortedEvents(session)
  const completed = []
  const starts = new Map()
  for (const event of events) {
    if (event.type === 'turn/start') starts.set(event.data?.turn, Number(event.seq))
    if (event.type === 'turn/end' && event.data?.reason?.kind === 'completed') {
      const turn = event.data?.turn
      const start = starts.get(turn)
      if (turn !== undefined && Number.isFinite(start)) completed.push({ turn, start, end: Number(event.seq) })
    }
  }
  completed.sort((a, b) => a.start - b.start)
  let previousEnd = -Infinity
  for (const item of completed) {
    item.surfaceStart = Number.isFinite(previousEnd) ? previousEnd + 1 : -Infinity
    previousEnd = item.end
  }
  const out = new Map()
  for (const seq of surfaceSeqs) {
    const direct = events.find(e => Number(e.seq) === Number(seq))?.data?.turn
    if (direct !== undefined && direct !== null) { out.set(Number(seq), direct); continue }
    const owner = completed.find(item => Number(seq) >= item.surfaceStart && Number(seq) <= item.end)
    if (owner) out.set(Number(seq), owner.turn)
  }
  return { ownership: out, completedTurns: new Set(completed.map(x => x.turn)), completed }
}

function recentWindowStart(nodes, ownership, completedTurns, minRecentTurns) {
  const tailTurns = []
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const t = ownership.get(Number(nodes[i].seq))
    if (t !== undefined && completedTurns.has(t) && !tailTurns.includes(t)) tailTurns.unshift(t)
    if (tailTurns.length >= minRecentTurns) break
  }
  const retained = new Set(tailTurns)
  let start = nodes.length
  for (let i = 0; i < nodes.length; i += 1) {
    if (retained.has(ownership.get(Number(nodes[i].seq)))) { start = i; break }
  }
  return { start, turns: tailTurns }
}

export function planStructuredCompaction(ctx, agent, runtime, { dryRun = false } = {}) {
  const policy = loadRuntimePolicy(runtime)
  const cfg = policy.context_pressure
  if (!ctx?.tokenMeter?.measure) return { ok: false, reason: 'TOKEN_METER_UNAVAILABLE' }
  const session = agent?.session
  if (!session?.surface?.nodes) return { ok: false, reason: 'SESSION_SURFACE_UNAVAILABLE' }
  const working = readJson(runtime.paths.workingState, emptyWorkingState(null))
  const rawCoverage = working?.checkpoint_meta?.prune_safe_through_seq
  const coverage = rawCoverage === null || rawCoverage === undefined ? NaN : Number(rawCoverage)
  if (!Number.isInteger(coverage) || coverage < 0 || !working?.checkpoint_meta?.state_hash || !working?.checkpoint_meta?.checkpoint_id) {
    return { ok: false, reason: 'COMPACTION_COVERAGE_UNPROVEN: no validated prune-safe checkpoint high-water mark' }
  }

  const measurement = ctx.tokenMeter.measure(session)
  const nodes = Array.from(measurement.nodes ?? []).map(x => ({ seq: Number(x.seq), tokens: Number(x.tokens ?? 0) }))
  if (nodes.length === 0) return { ok: false, reason: 'COMPACTION_NOTHING_TO_DO' }
  const { ownership, completedTurns } = surfaceTurnOwnership(session, nodes.map(x => x.seq))
  const recent = recentWindowStart(nodes, ownership, completedTurns, cfg.min_recent_turns)

  // A prior structured-compaction marker is a surviving anchor, not raw history.
  // Skip it while proving coverage for the next raw prefix; if more old history is
  // compacted, the old marker is coalesced into the new cumulative marker.
  const markerCount = leadingCompactionMarkerCount(session, nodes)
  let coveredPrefixEnd = markerCount - 1
  for (let i = markerCount; i < nodes.length; i += 1) {
    if (nodes[i].seq > coverage) break
    const t = ownership.get(nodes[i].seq)
    if (t === undefined || !completedTurns.has(t)) break
    coveredPrefixEnd = i
  }
  let endIndex = Math.min(coveredPrefixEnd, recent.start - 1)
  if (endIndex < markerCount) return { ok: false, reason: 'COMPACTION_NO_COVERED_PREFIX_BEFORE_RECENT_WINDOW' }

  // Never split a completed turn. Walk back until the next node belongs to a
  // different turn (or there is no next node).
  while (endIndex >= 0 && endIndex + 1 < nodes.length) {
    const t = ownership.get(nodes[endIndex].seq)
    const next = ownership.get(nodes[endIndex + 1].seq)
    if (t !== undefined && completedTurns.has(t) && next !== t) break
    endIndex -= 1
  }
  if (endIndex < 0) return { ok: false, reason: 'COMPACTION_NO_SAFE_COMPLETED_TURN_PREFIX' }

  const shadowed = nodes.slice(0, endIndex + 1)
  const shadowedSeqs = shadowed.map(x => x.seq)
  const eventBySeq = new Map((session.events ?? []).map(e => [Number(e?.seq), e]))
  const shadowedSourceEventSeqs = [...new Set(shadowed.flatMap(x => sourceEventSeqsForSurfaceNode(eventBySeq.get(x.seq), x.seq)))]
  const shadowedTokens = shadowed.reduce((n, x) => n + x.tokens, 0)
  const before = Number(measurement.totalTokens ?? measurement.surfaceTokens ?? 0)
  const retainedNodes = nodes.slice(endIndex + 1)
  const retainedTokenEstimate = retainedNodes.reduce((n, x) => n + x.tokens, 0)
  const recentTokens = nodes.slice(recent.start).reduce((n, x) => n + x.tokens, 0)
  const compactedText = structuredCompactionMessage(working, {
    compactedSurface: {
      start: shadowedSeqs[0], end: shadowedSeqs.at(-1), nodes: shadowedSeqs.length,
      estimated_tokens: shadowedTokens, source_event_seqs: shadowedSourceEventSeqs,
    },
  })
  const replacementMessage = pluginContextMessage(compactedText, 'qwen-v4-structured-compaction')
  const replacementTokens = safeEstimate(ctx, replacementMessage) || Math.ceil(compactedText.length / 4)
  const afterEstimate = Math.max(0, before - shadowedTokens + replacementTokens)
  return {
    ok: true,
    dryRun,
    sessionRevision: Number(session.seq ?? session.events?.length ?? 0),
    stateHash: working.checkpoint_meta.state_hash,
    checkpointId: working.checkpoint_meta.checkpoint_id,
    coverage,
    start: shadowedSeqs[0],
    end: shadowedSeqs.at(-1),
    shadowedSeqs,
    shadowedSourceEventSeqs,
    shadowedTokens,
    replacementTokens,
    before,
    afterEstimate,
    retainedTokenEstimate,
    retainedRecentTurns: recent.turns,
    recentTokens,
    recentWindowOverCap: recentTokens > cfg.max_recent_tokens,
    replacementMessage,
    working,
  }
}

export async function executeStructuredCompaction(ctx, agent, runtime, { dryRun = false } = {}) {
  const plan = planStructuredCompaction(ctx, agent, runtime, { dryRun })
  if (!plan.ok || dryRun) return plan
  const session = agent.session
  if (Number(session.seq ?? session.events?.length ?? 0) !== plan.sessionRevision) return { ok: false, reason: 'COMPACTION_STALE_SESSION_REVISION' }
  const current = readJson(runtime.paths.workingState, emptyWorkingState(null))
  if (current?.checkpoint_meta?.state_hash !== plan.stateHash || current?.checkpoint_meta?.checkpoint_id !== plan.checkpointId) {
    return { ok: false, reason: 'COMPACTION_STALE_CHECKPOINT' }
  }
  session.append('user/message', plan.replacementMessage, {
    surfaceOp: { op: 'replace', start: plan.start, end: plan.end },
    sourceEventSeqs: plan.shadowedSourceEventSeqs ?? plan.shadowedSeqs,
  })
  if (ctx.sessions?.flush) await ctx.sessions.flush(session)
  const afterMeasurement = ctx.tokenMeter?.measure ? ctx.tokenMeter.measure(session) : null
  const after = Number(afterMeasurement?.totalTokens ?? afterMeasurement?.surfaceTokens ?? plan.afterEstimate)
  return { ...plan, committed: true, after }
}
