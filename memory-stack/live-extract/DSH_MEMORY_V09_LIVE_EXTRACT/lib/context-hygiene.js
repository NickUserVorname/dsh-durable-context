import crypto from 'node:crypto'
import { pluginContextMessage } from './context-pressure.js'

const SECTION = 'qwen-v4-lossless-hygiene'
const MARKER = 'QWEN-V4 LOSSLESS TOOL EXCHANGE'

function seqOf(node) { return Number(typeof node === 'number' ? node : node?.seq) }
function sortedSurfaceSeqs(session) {
  return Array.from(session?.surface?.nodes ?? []).map(seqOf).filter(Number.isFinite)
}
function eventMap(session) { return new Map((session?.events ?? []).map(e => [Number(e?.seq), e])) }

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`
  return JSON.stringify(value)
}

function normalizedArgs(raw) {
  if (typeof raw !== 'string') return stable(raw ?? null)
  try { return stable(JSON.parse(raw)) } catch { return raw.trim() }
}

function assistantToolOnly(event) {
  if (event?.type !== 'assistant/message') return null
  const blocks = event.data?.message?.content ?? []
  const visibleText = blocks.filter(b => b?.type === 'text').map(b => String(b.text ?? '')).join('').trim()
  const calls = blocks.filter(b => b?.type === 'tool-call')
  const otherVisible = blocks.filter(b => !['reasoning','tool-call','text'].includes(b?.type))
  if (visibleText || calls.length !== 1 || otherVisible.length) return null
  const call = calls[0]
  return { name: String(call.name ?? ''), arguments: call.arguments ?? '' }
}

function normalizedToolResult(event) {
  if (event?.type !== 'tool/result') return null
  const msg = event.data?.message ?? {}
  const projection = {
    content: msg.content ?? [],
    isError: Boolean(msg.isError),
    error: event.data?.error ?? null,
  }
  return stable(projection)
}

function pairAt(events, seqA, seqB) {
  const a = events.get(seqA), b = events.get(seqB)
  const call = assistantToolOnly(a)
  const result = normalizedToolResult(b)
  if (!call || result === null) return null
  if (a.data?.turn !== b.data?.turn || a.data?.step !== b.data?.step) return null
  const fingerprintBody = stable({ name: call.name, arguments: normalizedArgs(call.arguments), result })
  return {
    start: seqA, end: seqB, seqs: [seqA, seqB],
    fingerprint: crypto.createHash('sha256').update(fingerprintBody).digest('hex'),
    call,
    resultEvent: b,
  }
}

function resultDisplay(event) {
  const msg = event?.data?.message ?? {}
  const pieces = []
  for (const block of msg.content ?? []) {
    if (block?.type === 'text') pieces.push(String(block.text ?? ''))
    else pieces.push(JSON.stringify(block))
  }
  return pieces.join('\n').trim() || JSON.stringify({ content: msg.content ?? [], isError: Boolean(msg.isError) })
}

function markerInfo(event) {
  if (event?.type !== 'user/message') return null
  const section = event.data?.source?.sections?.find?.(x => x?.name === SECTION)
  const text = String(section?.text ?? event.data?.content?.find?.(x => x?.type === 'text')?.text ?? '')
  const m = text.match(/^QWEN-V4 LOSSLESS TOOL EXCHANGE\nFINGERPRINT: ([0-9a-f]{64})\nCOUNT: (\d+)\n/s)
  if (!m) return null
  return { fingerprint: m[1], count: Number(m[2]) }
}

function markerText(pair, count) {
  return [
    MARKER,
    `FINGERPRINT: ${pair.fingerprint}`,
    `COUNT: ${count}`,
    'The raw append-only session log retains every occurrence. The active model surface keeps one exact exchange plus the repetition count.',
    `TOOL CALL: ${pair.call.name}(${typeof pair.call.arguments === 'string' ? pair.call.arguments : JSON.stringify(pair.call.arguments)})`,
    'TOOL RESULT:',
    resultDisplay(pair.resultEvent),
    `REPEATED: ×${count}`,
  ].join('\n')
}

/**
 * Detect only a tail run of identical, contiguous, single-tool assistant/result
 * exchanges. No LLM judgment and no cross-message semantic deduplication.
 */
export function planLosslessHygiene(session) {
  const seqs = sortedSurfaceSeqs(session)
  if (seqs.length < 4) return { ok: false, reason: 'HYGIENE_NO_REPEAT' }
  const events = eventMap(session)
  const lastPair = pairAt(events, seqs.at(-2), seqs.at(-1))
  if (!lastPair) return { ok: false, reason: 'HYGIENE_TAIL_NOT_TOOL_PAIR' }

  // Extend backward over raw identical pairs.
  const rawPairs = [lastPair]
  let i = seqs.length - 4
  while (i >= 0) {
    const pair = pairAt(events, seqs[i], seqs[i + 1])
    if (!pair || pair.fingerprint !== lastPair.fingerprint) break
    rawPairs.unshift(pair)
    i -= 2
  }
  if (rawPairs.length >= 2) {
    const allSeqs = rawPairs.flatMap(x => x.seqs)
    return {
      ok: true, start: allSeqs[0], end: allSeqs.at(-1), sourceEventSeqs: allSeqs,
      count: rawPairs.length, pair: lastPair,
    }
  }

  // Or fold a previously created hygiene marker plus one new identical pair.
  const markerSeq = seqs.at(-3)
  const markerEvent = events.get(markerSeq)
  const marker = markerInfo(markerEvent)
  if (marker && marker.fingerprint === lastPair.fingerprint) {
    const priorSources = Array.isArray(markerEvent?.sourceEventSeqs) ? markerEvent.sourceEventSeqs.map(Number).filter(Number.isFinite) : []
    const sources = [...new Set([markerSeq, ...priorSources, ...lastPair.seqs])]
    return {
      ok: true, start: markerSeq, end: lastPair.end, sourceEventSeqs: sources,
      count: marker.count + 1, pair: lastPair,
    }
  }
  return { ok: false, reason: 'HYGIENE_NO_REPEAT' }
}

export async function applyLosslessHygiene(ctx, agent) {
  const session = agent?.session
  if (!session?.surface?.nodes || typeof session.append !== 'function') return { ok: false, reason: 'HYGIENE_SESSION_UNAVAILABLE' }
  const plan = planLosslessHygiene(session)
  if (!plan.ok) return plan
  const text = markerText(plan.pair, plan.count)
  const message = pluginContextMessage(text, SECTION)
  session.append('user/message', message, {
    surfaceOp: { op: 'replace', start: plan.start, end: plan.end },
    sourceEventSeqs: plan.sourceEventSeqs,
  })
  if (ctx.sessions?.flush) await ctx.sessions.flush(session)
  return { ...plan, committed: true }
}

export const _hygieneTest = { assistantToolOnly, normalizedToolResult, markerInfo, markerText }
