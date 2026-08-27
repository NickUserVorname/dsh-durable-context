const tokenizeCache = new Map()

function numberOrZero(v) { return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0 }

function stepIdentity(turn, step) { return `${turn ?? '?'}:${step ?? '?'}` }
export function tokenEntryKey(sessionId, turn, step) { return `${sessionId}:${stepIdentity(turn, step)}` }

export function splitAssistantContent(message) {
  const reasoning = []
  const visible = []
  for (const block of message?.content ?? []) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'reasoning') reasoning.push(String(block.text ?? ''))
    else if (block.type === 'text') visible.push(String(block.text ?? ''))
    else if (block.type === 'tool-call') visible.push(JSON.stringify({ name: block.name ?? '', arguments: block.arguments ?? '' }))
  }
  return { reasoningText: reasoning.join('\n'), visibleText: visible.join('\n') }
}

async function tokenize(endpoint, text, timeoutMs = 5000) {
  if (!text) return 0
  const apiKey = String(process.env.LLAMA_LOCAL_API_KEY ?? '').trim()
  const cacheKey = `${endpoint}\0${apiKey}\0${text}`
  if (tokenizeCache.has(cacheKey)) return tokenizeCache.get(cacheKey)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const headers = { 'content-type': 'application/json' }
    if (apiKey) headers.authorization = `Bearer ${apiKey}`
    const res = await fetch(endpoint, {
      method: 'POST', headers,
      body: JSON.stringify({ content: text, add_special: false, parse_special: true }), signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`tokenize HTTP ${res.status}`)
    const body = await res.json()
    if (!Array.isArray(body.tokens)) throw new Error('tokenize response missing tokens[]')
    const count = body.tokens.length
    // Keep helper accounting cheap on repeated immutable projections. Bound the
    // cache so a long-running harness does not retain arbitrary conversation text forever.
    if (tokenizeCache.size >= 4096) tokenizeCache.delete(tokenizeCache.keys().next().value)
    tokenizeCache.set(cacheKey, count)
    return count
  } finally { clearTimeout(timer) }
}

function usageOutput(usage = {}) { return numberOrZero(usage.outputTokens ?? usage.output_tokens) }
function usageReasoning(usage = {}) {
  const value = usage.reasoningTokens ?? usage.reasoning_tokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

async function accountProjection({ reasoningText, visibleText, usage = {}, tokenizerEndpoint, timeoutMs = 5000, sourceMode }) {
  const output = usageOutput(usage)
  const explicitReasoning = usageReasoning(usage)
  if (explicitReasoning !== undefined) {
    return {
      reasoning_tokens: explicitReasoning,
      visible_output_tokens: Math.max(0, output - explicitReasoning),
      total_output_tokens: output,
      mode: 'provider-separated',
    }
  }
  if (tokenizerEndpoint) {
    try {
      const [reasoningTokens, visibleTokens] = await Promise.all([
        tokenize(tokenizerEndpoint, reasoningText, timeoutMs),
        tokenize(tokenizerEndpoint, visibleText, timeoutMs),
      ])
      // These are model-tokenizer counts of the actual DSH content projections. They
      // separate reasoning vs visible content even when pi-ai folds reasoning into
      // output usage. Provider framing/special-token overhead may make their sum differ
      // slightly from outputTokens, so total_output_tokens keeps provider usage when present.
      return {
        reasoning_tokens: reasoningTokens,
        visible_output_tokens: visibleTokens,
        total_output_tokens: output || reasoningTokens + visibleTokens,
        mode: `llama-tokenize-${sourceMode}`,
      }
    } catch (error) {
      return {
        reasoning_tokens: output,
        visible_output_tokens: output,
        total_output_tokens: output,
        mode: 'conservative-fallback',
        error: String(error),
      }
    }
  }
  return { reasoning_tokens: output, visible_output_tokens: output, total_output_tokens: output, mode: 'conservative-fallback' }
}

export async function accountAssistantEvent(event, { tokenizerEndpoint, timeoutMs = 5000 } = {}) {
  const message = event?.data?.message
  const usage = event?.data?.usage ?? {}
  const { reasoningText, visibleText } = splitAssistantContent(message)
  return accountProjection({ reasoningText, visibleText, usage, tokenizerEndpoint, timeoutMs, sourceMode: 'message-blocks' })
}

function emptyPartial(type = '') { return { type, text: '', toolName: '', toolArguments: '', block: null } }

function assembleChunkProjection(chunks = []) {
  const partials = new Map()
  let usage = {}
  const ensure = (index, type = '') => {
    let p = partials.get(index)
    if (!p) { p = emptyPartial(type); partials.set(index, p) }
    if (!p.type && type) p.type = type
    return p
  }
  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== 'object') continue
    if (chunk.type === 'usage') { usage = chunk.usage ?? usage; continue }
    if (chunk.type === 'block-start') { ensure(chunk.index, chunk.blockType); continue }
    if (chunk.type === 'reasoning-delta') { ensure(chunk.index, 'reasoning').text += String(chunk.text ?? ''); continue }
    if (chunk.type === 'text-delta') { ensure(chunk.index, 'text').text += String(chunk.text ?? ''); continue }
    if (chunk.type === 'tool-call-delta') {
      const p = ensure(chunk.index, 'tool-call')
      if (chunk.name) p.toolName = String(chunk.name)
      p.toolArguments += String(chunk.argumentsDelta ?? '')
      continue
    }
    if (chunk.type === 'block-end') { ensure(chunk.index, chunk.block?.type ?? '').block = chunk.block ?? null }
  }
  const blocks = [...partials.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([, p]) => {
    if (p.block) return p.block
    if (p.type === 'reasoning') return { type: 'reasoning', text: p.text }
    if (p.type === 'text') return { type: 'text', text: p.text }
    if (p.type === 'tool-call') return { type: 'tool-call', name: p.toolName, arguments: p.toolArguments }
    return null
  }).filter(Boolean)
  const { reasoningText, visibleText } = splitAssistantContent({ content: blocks })
  return { reasoningText, visibleText, usage }
}

function collectEpochSteps(events = [], startSeq = 0) {
  const steps = new Map()
  const ensure = (turn, step, seq = Number.MAX_SAFE_INTEGER) => {
    const id = stepIdentity(turn, step)
    let rec = steps.get(id)
    if (!rec) {
      rec = { id, turn, step, firstSeq: seq, chunks: [], messageEvent: null }
      steps.set(id, rec)
    }
    rec.firstSeq = Math.min(rec.firstSeq, seq)
    return rec
  }
  for (const event of events ?? []) {
    if (!event || typeof event.seq !== 'number' || event.seq < startSeq) continue
    const d = event.data ?? {}
    if (event.type === 'step/start') ensure(d.turn, d.step, event.seq)
    else if (event.type === 'assistant/chunk') ensure(d.turn, d.step, event.seq).chunks.push(d.chunk)
    else if (event.type === 'assistant/message') ensure(d.turn, d.step, event.seq).messageEvent = event
    else if (event.type === 'step/end') ensure(d.turn, d.step, event.seq)
  }
  return [...steps.values()].sort((a, b) => a.firstSeq - b.firstSeq)
}

export async function accountEpochSteps(events = [], { sessionId, startSeq = 0, tokenizerEndpoint, timeoutMs = 5000, existingEntries = {} } = {}) {
  const additions = {}
  let latestMode = null
  for (const step of collectEpochSteps(events, startSeq)) {
    const key = tokenEntryKey(sessionId, step.turn, step.step)
    if (existingEntries[key] || additions[key]) continue
    let accounted
    if (step.messageEvent) {
      accounted = await accountAssistantEvent(step.messageEvent, { tokenizerEndpoint, timeoutMs })
    } else {
      const projected = assembleChunkProjection(step.chunks)
      accounted = await accountProjection({
        ...projected, tokenizerEndpoint, timeoutMs, sourceMode: 'failed-stream-blocks',
      })
    }
    additions[key] = {
      ...accounted,
      session_id: sessionId,
      turn: step.turn,
      step: step.step,
      source: step.messageEvent ? 'assistant/message' : 'assistant/chunk',
      at: new Date().toISOString(),
    }
    latestMode = accounted.mode
  }
  return { additions, latestMode }
}

export function tokenLedgerUsage(task, sessionId, startSeq, events = []) {
  const entries = task?.execution?.token_accounting?.entries ?? {}
  const steps = collectEpochSteps(events, startSeq).filter(step =>
    (events ?? []).some(event => event?.type === 'step/start' && event.seq >= startSeq && event.data?.turn === step.turn && event.data?.step === step.step))
  let reasoning = 0, visible = 0, total = 0
  const modes = new Set()
  const missing = []
  for (const step of steps) {
    const key = tokenEntryKey(sessionId, step.turn, step.step)
    const entry = entries[key]
    if (!entry) { missing.push(step.id); continue }
    reasoning += numberOrZero(entry.reasoning_tokens)
    visible += numberOrZero(entry.visible_output_tokens)
    total += numberOrZero(entry.total_output_tokens)
    modes.add(entry.mode ?? 'unknown')
  }
  return { complete: missing.length === 0, missing, reasoning_tokens: reasoning, visible_output_tokens: visible, total_output_tokens: total, modes: [...modes] }
}
