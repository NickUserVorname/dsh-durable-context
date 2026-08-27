import { DEFAULT_BUDGET, clampBudget, foldUsage } from './core.js'
import { combineTaskUsage } from './role-control.js'
import { accountEpochSteps, tokenLedgerUsage } from './token-accounting.js'
import { saveTask } from './state.js'

export const ZERO_USAGE = Object.freeze({
  model_requests: 0, reasoning_tokens: 0, visible_output_tokens: 0,
  tool_calls: 0, active_execution_ms: 0, failed_hypotheses: 0,
})

export function agentId(agent) {
  return String(agent?.session?.id ?? agent?.session?.header?.id ?? agent?.id ?? 'unknown-session')
}

export function addUsage(a = ZERO_USAGE, b = ZERO_USAGE, failedHypotheses = 0) {
  return {
    model_requests: (a.model_requests ?? 0) + (b.model_requests ?? 0),
    reasoning_tokens: (a.reasoning_tokens ?? 0) + (b.reasoning_tokens ?? 0),
    visible_output_tokens: (a.visible_output_tokens ?? 0) + (b.visible_output_tokens ?? 0),
    tool_calls: (a.tool_calls ?? 0) + (b.tool_calls ?? 0),
    active_execution_ms: (a.active_execution_ms ?? 0) + (b.active_execution_ms ?? 0),
    failed_hypotheses: failedHypotheses,
  }
}

export function workerUsage(agent, task) {
  const failed = task?.execution?.failed_hypotheses?.length ?? 0
  const accumulated = task?.execution?.usage_accumulated ?? ZERO_USAGE
  const epochSession = task?.execution?.epoch_session_id
  const start = task?.execution?.epoch_start_seq
  if (!agent || start === null || start === undefined || epochSession !== agentId(agent)) {
    return { ...accumulated, failed_hypotheses: failed }
  }
  const events = agent?.session?.events ?? []
  const current = foldUsage(events, start, 0)
  const blockUsage = tokenLedgerUsage(task, agentId(agent), start, events)
  if (blockUsage.complete) {
    current.reasoning_tokens = blockUsage.reasoning_tokens
    current.visible_output_tokens = blockUsage.visible_output_tokens
    current.token_accounting_mode = blockUsage.modes.length === 1 ? blockUsage.modes[0] : blockUsage.modes.join('+') || 'none'
  } else current.token_accounting_mode = 'conservative-fallback'
  const total = addUsage(accumulated, current, failed)
  total.token_accounting_mode = current.token_accounting_mode ?? task?.execution?.token_accounting?.latest_mode ?? 'unknown'
  return total
}

export function taskUsage(agent, task) {
  return combineTaskUsage(workerUsage(agent, task), task)
}

export async function backfillTokenAccounting(runtime, agent, task, tokenizerEndpoint) {
  if (!task?.execution || task.execution.epoch_session_id !== agentId(agent)) return
  const start = task.execution.epoch_start_seq
  if (start === null || start === undefined) return
  task.execution.token_accounting ??= { entries: {}, latest_mode: 'uninitialized' }
  const entries = task.execution.token_accounting.entries
  const accounted = await accountEpochSteps(agent?.session?.events ?? [], {
    sessionId: agentId(agent), startSeq: start, tokenizerEndpoint, existingEntries: entries,
  })
  const additions = accounted.additions ?? {}
  if (Object.keys(additions).length > 0) {
    Object.assign(entries, additions)
    if (accounted.latestMode) task.execution.token_accounting.latest_mode = accounted.latestMode
    saveTask(runtime.paths, task)
  }
}

export function snapshotUsage(agent, task, { closeEpoch = false } = {}) {
  if (!task?.execution) task.execution = {}
  const failed = task.execution.failed_hypotheses?.length ?? 0
  const workerTotal = workerUsage(agent, task)
  const total = combineTaskUsage(workerTotal, task)
  task.execution.last_usage = { ...total, failed_hypotheses: failed }
  if (closeEpoch) {
    task.execution.usage_accumulated = { ...workerTotal, failed_hypotheses: 0 }
    task.execution.epoch_session_id = null
    task.execution.epoch_start_seq = null
  }
  return { ...total, failed_hypotheses: failed }
}

export function beginUsageEpoch(agent, task) {
  task.execution ??= {}
  task.execution.usage_accumulated ??= { ...ZERO_USAGE }
  task.execution.epoch_session_id = agentId(agent)
  task.execution.epoch_start_seq = agent?.session?.events?.length ?? 0
  task.execution.worker_session_id = agentId(agent)
}

export function activeBudget(task) {
  return clampBudget(task?.budget ?? {}, DEFAULT_BUDGET)
}
