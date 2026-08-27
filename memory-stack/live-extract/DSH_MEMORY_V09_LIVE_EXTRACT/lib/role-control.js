import path from 'node:path'
import fs from 'node:fs'
import { Buffer } from 'node:buffer'
import { foldUsage, isPathInside } from './core.js'
import { accountEpochSteps } from './token-accounting.js'

import { DEFAULT_ROLE_BUDGETS, DEFAULT_VALIDATION_RESERVE } from './runtime-policy.js'

// Backward-compatible exports for tests/docs. Runtime code should resolve per-project policy.
export const ROLE_BUDGETS = DEFAULT_ROLE_BUDGETS
export const VALIDATION_RESERVE = DEFAULT_VALIDATION_RESERVE

const TRACKED_FIELDS = ['model_requests','reasoning_tokens','visible_output_tokens','tool_calls','active_execution_ms']

export function zeroRoleUsage() {
  return { model_requests:0, reasoning_tokens:0, visible_output_tokens:0, tool_calls:0, active_execution_ms:0 }
}

export function addRoleUsage(a = zeroRoleUsage(), b = zeroRoleUsage()) {
  const out = {}
  for (const field of TRACKED_FIELDS) out[field] = Number(a?.[field] ?? 0) + Number(b?.[field] ?? 0)
  return out
}

export function roleUsageTotal(task) {
  const byRole = task?.execution?.role_usage ?? {}
  return Object.values(byRole).reduce((acc, value) => addRoleUsage(acc, value?.total ?? value), zeroRoleUsage())
}

export function addRoleUsageToTask(task, role, usage) {
  task.execution ??= {}
  task.execution.role_usage ??= {}
  const rec = task.execution.role_usage[role] ?? { total: zeroRoleUsage(), runs: [] }
  rec.total = addRoleUsage(rec.total, usage)
  rec.runs ??= []
  rec.runs.push({ ...usage, completed_at: new Date().toISOString() })
  task.execution.role_usage[role] = rec
  return rec
}

export function combineTaskUsage(workerUsage, task) {
  const role = roleUsageTotal(task)
  return {
    ...workerUsage,
    model_requests: Number(workerUsage?.model_requests ?? 0) + role.model_requests,
    reasoning_tokens: Number(workerUsage?.reasoning_tokens ?? 0) + role.reasoning_tokens,
    visible_output_tokens: Number(workerUsage?.visible_output_tokens ?? 0) + role.visible_output_tokens,
    tool_calls: Number(workerUsage?.tool_calls ?? 0) + role.tool_calls,
    active_execution_ms: Number(workerUsage?.active_execution_ms ?? 0) + role.active_execution_ms,
  }
}

function reserveThreshold(budget, reserve, budgetKey, scale) {
  const ceiling = Number(budget?.[budgetKey] ?? 0) * scale
  const reserved = Number(reserve?.[budgetKey] ?? 0) * scale
  return Math.max(0, ceiling - reserved)
}

// Used before starting/resuming worker execution, where usage contains only
// completed work. Reaching the worker share exactly means the validation reserve
// is now protected and no new worker epoch may start.
export function workerReserveExhausted(globalUsage, budget, reserve = VALIDATION_RESERVE) {
  const checks = [
    ['max_model_requests','model_requests', 1],
    ['max_reasoning_tokens','reasoning_tokens', 1],
    ['max_visible_output_tokens','visible_output_tokens', 1],
    ['max_tool_calls','tool_calls', 1],
    ['max_active_execution_minutes','active_execution_ms', 60000],
  ]
  for (const [budgetKey, usageKey, scale] of checks) {
    if (Number(globalUsage?.[usageKey] ?? 0) >= reserveThreshold(budget, reserve, budgetKey, scale)) return `validation_reserve_${budgetKey}`
  }
  return undefined
}

// Used in agent/pre-step. step/start already includes the request currently
// being admitted, so model request N is valid when N equals the worker ceiling.
// Other dimensions still describe prior completed work and remain exhausted at ==.
export function workerReserveExceededPreStep(globalUsage, budget, reserve = VALIDATION_RESERVE) {
  const checks = [
    ['max_model_requests','model_requests', 1, 'current-request'],
    ['max_reasoning_tokens','reasoning_tokens', 1, 'prior-usage'],
    ['max_visible_output_tokens','visible_output_tokens', 1, 'prior-usage'],
    // At the exact productive-tool threshold allow one terminal model step. The
    // hard tool guard denies the next productive call before execution.
    ['max_tool_calls','tool_calls', 1, 'terminal-step'],
    ['max_active_execution_minutes','active_execution_ms', 60000, 'prior-usage'],
  ]
  for (const [budgetKey, usageKey, scale, mode] of checks) {
    const used = Number(globalUsage?.[usageKey] ?? 0)
    const threshold = reserveThreshold(budget, reserve, budgetKey, scale)
    if (mode === 'current-request' || mode === 'terminal-step') {
      if (used > threshold) return `validation_reserve_${budgetKey}`
    } else if (used >= threshold) return `validation_reserve_${budgetKey}`
  }
  return undefined
}

// Backward-compatible name for command/start checks.
export const workerReserveExceeded = workerReserveExhausted

export function roleBudgetExhausted(usage, budget) {
  if (usage.model_requests >= budget.max_model_requests) return 'max_model_requests'
  if (usage.reasoning_tokens >= budget.max_reasoning_tokens) return 'max_reasoning_tokens'
  if (usage.visible_output_tokens >= budget.max_visible_output_tokens) return 'max_visible_output_tokens'
  if (usage.tool_calls >= budget.max_tool_calls) return 'max_tool_calls'
  if (usage.active_execution_ms >= budget.max_active_execution_minutes * 60000) return 'max_active_execution_minutes'
  return undefined
}

export function roleBudgetExceededPreStep(usage, budget) {
  if (usage.model_requests > budget.max_model_requests) return 'max_model_requests'
  if (usage.reasoning_tokens >= budget.max_reasoning_tokens) return 'max_reasoning_tokens'
  if (usage.visible_output_tokens >= budget.max_visible_output_tokens) return 'max_visible_output_tokens'
  // Reaching the productive-tool cap does not forbid the next model step: that
  // step may terminate via structured_output. The hard tool guard denies N+1.
  if (usage.tool_calls > budget.max_tool_calls) return 'max_tool_calls'
  if (usage.active_execution_ms >= budget.max_active_execution_minutes * 60000) return 'max_active_execution_minutes'
  return undefined
}

export function roleBudgetExceededAfterRun(usage, budget) {
  if (usage.model_requests > budget.max_model_requests) return 'max_model_requests'
  if (usage.reasoning_tokens > budget.max_reasoning_tokens) return 'max_reasoning_tokens'
  if (usage.visible_output_tokens > budget.max_visible_output_tokens) return 'max_visible_output_tokens'
  if (usage.tool_calls > budget.max_tool_calls) return 'max_tool_calls'
  if (usage.active_execution_ms > budget.max_active_execution_minutes * 60000) return 'max_active_execution_minutes'
  return undefined
}

// Backward-compatible name for already-exhausted checks.
export const roleBudgetExceeded = roleBudgetExhausted

const roleAccountingCache = new WeakMap()

export async function measureAgentUsage(agent, tokenizerEndpoint) {
  const events = agent?.session?.events ?? []
  const sessionId = String(agent?.session?.id ?? agent?.id ?? 'role')
  const base = foldUsage(events, 0, 0)
  let cache = roleAccountingCache.get(agent)
  if (!cache || cache.sessionId !== sessionId || cache.tokenizerEndpoint !== tokenizerEndpoint) {
    cache = { sessionId, tokenizerEndpoint, entries: {}, latestMode: 'none' }
    roleAccountingCache.set(agent, cache)
  }
  const accounted = await accountEpochSteps(events, {
    sessionId, startSeq: 0, tokenizerEndpoint, existingEntries: cache.entries,
  })
  Object.assign(cache.entries, accounted.additions ?? {})
  if (accounted.latestMode) cache.latestMode = accounted.latestMode
  const entries = Object.values(cache.entries)
  if (entries.length) {
    base.reasoning_tokens = entries.reduce((n, x) => n + Number(x.reasoning_tokens ?? 0), 0)
    base.visible_output_tokens = entries.reduce((n, x) => n + Number(x.visible_output_tokens ?? 0), 0)
  }
  return { ...base, failed_hypotheses: 0, token_accounting_mode: cache.latestMode ?? 'none' }
}

function resolveToolTarget(exec, cwd) {
  if (exec.name === 'read') return exec.arguments?.file_path ? path.resolve(cwd, String(exec.arguments.file_path)) : null
  if (exec.name === 'grep' || exec.name === 'glob') {
    const raw = exec.arguments?.path
    return path.resolve(cwd, raw ? String(raw) : '.')
  }
  return null
}

export function roleReadGuard(exec, roleCtx) {
  if (!roleCtx) return undefined
  if (!['read','grep','glob'].includes(exec.name)) return undefined
  if (roleCtx.read_bytes >= roleCtx.budget.max_read_result_bytes) return `ROLE_READ_BUDGET_EXCEEDED: ${roleCtx.role} ${roleCtx.read_bytes}/${roleCtx.budget.max_read_result_bytes} bytes`
  const cwd = exec.agent?.session?.header?.cwd ?? roleCtx.projectRoot
  const target = resolveToolTarget(exec, cwd)
  if (!target) return `ROLE_READ_PATH_DENIED: ${roleCtx.role} missing read target`
  const allowed = roleCtx.allowedRoots.some(root => isPathInside(target, root))
  if (!allowed) return `ROLE_READ_PATH_DENIED: ${roleCtx.role} target outside allowed roots: ${target}`
  try {
    if (fs.existsSync(target)) {
      const realTarget = fs.realpathSync.native?.(target) ?? fs.realpathSync(target)
      const realAllowed = roleCtx.allowedRoots.some(root => {
        const realRoot = fs.realpathSync.native?.(root) ?? fs.realpathSync(root)
        return isPathInside(realTarget, realRoot)
      })
      if (!realAllowed) return `ROLE_READ_PATH_DENIED: ${roleCtx.role} symlink/junction escape: ${target}`
    }
  } catch (error) { return `ROLE_READ_PATH_DENIED: ${roleCtx.role} realpath check failed: ${String(error)}` }
  return undefined
}

export function accountRoleReadResult(roleCtx, exec, result) {
  if (!roleCtx || !['read','grep','glob'].includes(exec.name)) return 0
  let encoded = ''
  try { encoded = JSON.stringify(result?.value ?? result ?? '') } catch { encoded = String(result?.value ?? result ?? '') }
  const bytes = Buffer.byteLength(encoded, 'utf8')
  roleCtx.read_bytes += bytes
  if (roleCtx.read_bytes > roleCtx.budget.max_read_result_bytes) {
    roleCtx.violation = `ROLE_READ_BUDGET_EXCEEDED: ${roleCtx.role} ${roleCtx.read_bytes}/${roleCtx.budget.max_read_result_bytes} bytes`
  }
  return bytes
}
