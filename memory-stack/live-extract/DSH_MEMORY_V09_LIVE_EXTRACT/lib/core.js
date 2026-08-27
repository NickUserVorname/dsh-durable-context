import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const TASK_STATES = Object.freeze([
  'NO_TASK','READY','IN_PROGRESS','TEST_REQUIRED','TESTING','TEST_FAILED','REVIEW_REQUIRED','REVIEWING','REVIEW_FAILED',
  'ACCEPTANCE_REQUIRED','ACCEPTING','ACCEPTANCE_FAILED','ACCEPTED','BUDGET_PAUSED',
  'SCOPE_EXPANSION_REQUIRED','SCOPE_VIOLATION','BLOCKED_EXTERNAL',
  'BLOCKED_SPEC','BLOCKED_QUALIFICATION','STALE',
])

export const TERMINAL_STATES = new Set(['ACCEPTED', 'STALE'])
export const REWORKABLE_STATES = new Set(['READY','TEST_FAILED','REVIEW_FAILED','ACCEPTANCE_FAILED','BUDGET_PAUSED'])

export const DEFAULT_BUDGET = Object.freeze({
  max_model_requests: 96,
  max_reasoning_tokens: 80000,
  max_visible_output_tokens: 40000,
  max_tool_calls: 192,
  max_active_execution_minutes: 90,
  max_failed_hypotheses: 2,
})

export function canonical(value) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk)
    if (v !== null && typeof v === 'object') {
      const out = Object.create(null)
      for (const key of Object.keys(v).sort()) out[key] = walk(v[key])
      return out
    }
    return v
  }
  const encoded = JSON.stringify(walk(value))
  return encoded === undefined ? String(value) : encoded
}

export function callKey(exec) {
  return `${exec.name}\n${canonical(exec.arguments)}`
}

export function failureText(result) {
  if (!result?.isError) return ''
  const err = result.error ?? {}
  const info = err.info ?? {}
  const code = info.code ?? info.name ?? 'ERROR'
  return `${code}:${err.message ?? 'tool failed'}`
}

export function clampBudget(requested = {}, defaults = DEFAULT_BUDGET) {
  const out = { ...defaults }
  for (const [key, ceiling] of Object.entries(defaults)) {
    const raw = requested?.[key]
    if (raw === undefined || raw === null) continue
    if (!Number.isFinite(raw) || raw <= 0) throw new Error(`budget.${key} must be positive`)
    out[key] = Math.min(raw, ceiling)
  }
  return out
}

// Budget predicates are phase-specific. A usage value exactly at the cap is
// valid after a completed operation, but it is exhausted for starting new work.
// During agent/pre-step the current model request already has a step/start event,
// so model_requests uses `>` there while the other dimensions are still prior usage.
export function budgetExhausted(usage, budget) {
  if (usage.model_requests >= budget.max_model_requests) return 'max_model_requests'
  if (usage.reasoning_tokens >= budget.max_reasoning_tokens) return 'max_reasoning_tokens'
  if (usage.visible_output_tokens >= budget.max_visible_output_tokens) return 'max_visible_output_tokens'
  if (usage.tool_calls >= budget.max_tool_calls) return 'max_tool_calls'
  if (usage.active_execution_ms >= budget.max_active_execution_minutes * 60_000) return 'max_active_execution_minutes'
  if (usage.failed_hypotheses >= budget.max_failed_hypotheses) return 'max_failed_hypotheses'
  return undefined
}

export function budgetExceededPreStep(usage, budget) {
  if (usage.model_requests > budget.max_model_requests) return 'max_model_requests'
  if (usage.reasoning_tokens >= budget.max_reasoning_tokens) return 'max_reasoning_tokens'
  if (usage.visible_output_tokens >= budget.max_visible_output_tokens) return 'max_visible_output_tokens'
  // Exact productive-tool cap still permits one terminal model step; the hard tool guard denies N+1.
  if (usage.tool_calls > budget.max_tool_calls) return 'max_tool_calls'
  if (usage.active_execution_ms >= budget.max_active_execution_minutes * 60_000) return 'max_active_execution_minutes'
  if (usage.failed_hypotheses >= budget.max_failed_hypotheses) return 'max_failed_hypotheses'
  return undefined
}

export function budgetExceededAfterRun(usage, budget) {
  if (usage.model_requests > budget.max_model_requests) return 'max_model_requests'
  if (usage.reasoning_tokens > budget.max_reasoning_tokens) return 'max_reasoning_tokens'
  if (usage.visible_output_tokens > budget.max_visible_output_tokens) return 'max_visible_output_tokens'
  if (usage.tool_calls > budget.max_tool_calls) return 'max_tool_calls'
  if (usage.active_execution_ms > budget.max_active_execution_minutes * 60_000) return 'max_active_execution_minutes'
  if (usage.failed_hypotheses > budget.max_failed_hypotheses) return 'max_failed_hypotheses'
  return undefined
}

// Backward-compatible name: callers that ask whether more work may start use
// the exhausted predicate. New pre-step/post-run code must use the explicit APIs.
export const budgetExceeded = budgetExhausted

function numberOrZero(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

export function foldUsage(events, startSeq = 0, failedHypotheses = 0, now = Date.now()) {
  let modelRequests = 0
  let reasoning = 0
  let visible = 0
  let toolCalls = 0
  let activeMs = 0
  const openSteps = new Map()

  for (const event of events ?? []) {
    if (!event || typeof event.seq !== 'number' || event.seq < startSeq) continue
    const time = numberOrZero(event.time)
    if (event.type === 'step/start') {
      modelRequests += 1
      const d = event.data ?? {}
      openSteps.set(`${d.turn ?? '?'}:${d.step ?? '?'}`, time)
    } else if (event.type === 'step/end') {
      const d = event.data ?? {}
      const key = `${d.turn ?? '?'}:${d.step ?? '?'}`
      const started = openSteps.get(key)
      if (started !== undefined && time >= started) activeMs += time - started
      openSteps.delete(key)
    } else if (event.type === 'tool/call') {
      toolCalls += 1
    } else if (event.type === 'assistant/message') {
      const usage = event.data?.usage ?? event.data?.message?.usage ?? {}
      const output = numberOrZero(usage.outputTokens ?? usage.output_tokens)
      const hasReasoning = typeof (usage.reasoningTokens ?? usage.reasoning_tokens) === 'number'
      if (hasReasoning) {
        const r = numberOrZero(usage.reasoningTokens ?? usage.reasoning_tokens)
        reasoning += r
        visible += Math.max(0, output - r)
      } else {
        // Conservative: if the provider does not separate reasoning, charge output to both.
        reasoning += output
        visible += output
      }
    }
  }

  for (const started of openSteps.values()) {
    if (now >= started) activeMs += now - started
  }

  return {
    model_requests: modelRequests,
    reasoning_tokens: reasoning,
    visible_output_tokens: visible,
    tool_calls: toolCalls,
    active_execution_ms: activeMs,
    failed_hypotheses: failedHypotheses,
  }
}

export function normalizeRel(p) {
  return String(p).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+/g, '/')
}

function globToRegExp(pattern) {
  const p = normalizeRel(pattern)
  let out = '^'
  for (let i = 0; i < p.length; i += 1) {
    const c = p[i]
    if (c === '*') {
      if (p[i + 1] === '*') {
        i += 1
        if (p[i + 1] === '/') { i += 1; out += '(?:.*/)?' }
        else out += '.*'
      } else out += '[^/]*'
    } else if (c === '?') out += '[^/]'
    else if ('\\.^$+{}()|[]'.includes(c)) out += `\\${c}`
    else out += c
  }
  out += '$'
  return new RegExp(out, 'i')
}

export function pathAllowed(relativePath, writeSet = []) {
  const rel = normalizeRel(relativePath).replace(/^\/+/, '')
  if (!rel || rel.startsWith('../') || rel === '..') return false
  return writeSet.some((raw) => {
    const pattern = normalizeRel(raw).replace(/^\/+/, '')
    if (!pattern) return false
    if (pattern.endsWith('/')) return rel.startsWith(pattern)
    if (!/[?*]/.test(pattern)) return rel === pattern || rel.startsWith(`${pattern}/`)
    return globToRegExp(pattern).test(rel)
  })
}

function apiFor(p) {
  return /^[A-Za-z]:[\\/]/.test(String(p)) ? path.win32 : path
}

export function isPathInside(candidate, root) {
  const api = apiFor(root)
  const rootAbs = api.resolve(root)
  const candAbs = api.resolve(candidate)
  const windows = api === path.win32
  const R = windows ? rootAbs.toLowerCase() : rootAbs
  const C = windows ? candAbs.toLowerCase() : candAbs
  return C === R || C.startsWith(R.endsWith(api.sep) ? R : `${R}${api.sep}`)
}

export function safeWorktreeTarget(target, worktree) {
  if (!target || !worktree) return { ok: false, reason: 'missing path/worktree' }
  const api = apiFor(worktree)
  if (!api.isAbsolute(target)) return { ok: false, reason: 'path must be absolute inside task worktree' }
  const lexical = api.resolve(target)
  if (!isPathInside(lexical, worktree)) return { ok: false, reason: 'path outside task worktree' }

  // Resolve the nearest existing ancestor to catch symlink/junction escapes.
  let cursor = lexical
  while (!fs.existsSync(cursor)) {
    const parent = api.dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  try {
    const realRoot = fs.realpathSync.native?.(worktree) ?? fs.realpathSync(worktree)
    const realAncestor = fs.realpathSync.native?.(cursor) ?? fs.realpathSync(cursor)
    if (!isPathInside(realAncestor, realRoot)) return { ok: false, reason: 'symlink/junction escape outside task worktree' }
  } catch (error) {
    return { ok: false, reason: `realpath check failed: ${String(error)}` }
  }

  const rel = normalizeRel(api.relative(api.resolve(worktree), lexical))
  return { ok: true, absolute: lexical, relative: rel }
}

export function stableHash(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex')
}

export function statusText({ state, packet, usage, goal, root }) {
  const budget = packet?.budget ?? DEFAULT_BUDGET
  const lines = [
    `Project: ${root}`,
    `source_revision: ${state.source_revision}`,
    `source_conflicts: ${state.source_conflict_count ?? 0}`,
    `source_intake: ${state.source_intake_status ?? 'UNRESOLVED'} mode=${state.source_intake_mode ?? 'UNSET'} compatibility=${state.source_compatibility_policy ?? 'NONE'}`,
    `phase: ${state.current_phase ?? 'UNSET'}`,
    `task: ${state.active_task_id ?? '-'}`,
    `task_state: ${state.task_state}`,
    `operation: ${state.operation ? `${state.operation.kind} nonce=${String(state.operation.nonce).slice(0,8)} owner=${state.operation.owner_session_id}` : '-'}`, 
    `test_gate: ${state.last_test ? (state.last_test.pass ? 'PASS' : 'FAIL') : '-'}`,
    `goal: ${goal ? `${goal.phase}/${goal.activation} rounds ${goal.roundsStarted}/${goal.maxGoalRounds}` : '-'}`,
    `DIRECT_WRITE_GUARD: HARD`,
    `SHELL_WRITE_GUARD: ${process.platform === 'win32' ? 'DEGRADED_WINDOWS' : 'WORKSPACE_SCOPED'}`,
    `SHELL_OUTSIDE_WORKSPACE: ${process.platform === 'win32' ? 'NOT_PROVEN' : 'SANDBOX_DEPENDENT'}`,
    `CHECKPOINT_REQUIRED: ${packet?.execution?.checkpoint_required ? 'YES' : 'NO'}`,
    `CHECKPOINT_CADENCE: steps=${packet?.execution?.steps_since_checkpoint ?? 0} meaningful=${packet?.execution?.meaningful_since_checkpoint ?? 0}`,
    `TASK_BUDGET_SCOPE: worker+TEST_ANALYST+REVIEWER+ACCEPTANCE_AUDITOR`,
    `TOKEN_ACCOUNTING: ${usage?.token_accounting_mode ?? packet?.execution?.token_accounting?.latest_mode ?? 'unknown'}`,
  ]
  if (usage) {
    lines.push(
      `budget requests: ${usage.model_requests}/${budget.max_model_requests}`,
      `budget reasoning: ${usage.reasoning_tokens}/${budget.max_reasoning_tokens}`,
      `budget visible: ${usage.visible_output_tokens}/${budget.max_visible_output_tokens}`,
      `budget tools: ${usage.tool_calls}/${budget.max_tool_calls}`,
      `budget active min: ${(usage.active_execution_ms / 60000).toFixed(1)}/${budget.max_active_execution_minutes}`,
      `failed hypotheses: ${usage.failed_hypotheses}/${budget.max_failed_hypotheses}`,
    )
  }
  return lines.join('\n')
}
