import path from 'node:path'
import { budgetExhausted, budgetExceededAfterRun } from './core.js'
import { boundedPrompt } from './test-gate.js'
import { loadState, loadTask, saveState, saveTask, withRuntimeLock } from './state.js'
import {
  accountRoleReadResult, addRoleUsageToTask, measureAgentUsage,
  roleBudgetExceededAfterRun, roleReadGuard,
} from './role-control.js'
import { roleBudgetFor } from './runtime-policy.js'
import { activeBudget, addUsage, taskUsage } from './execution-usage.js'

export const freshRoleContexts = new WeakMap()

export function roleAgentOptions(resolved, maxTokens) {
  const out = {}
  if (resolved.roleProvider) out.provider = resolved.roleProvider
  if (resolved.roleModel) out.model = resolved.roleModel
  if (maxTokens) out.maxTokens = maxTokens
  return out
}

function current(runtime) {
  const state = loadState(runtime.paths)
  const task = state.active_task_id ? loadTask(runtime.paths, state.active_task_id) : null
  return { state, task }
}

function zeroUsageForRole() { return { model_requests:0, reasoning_tokens:0, visible_output_tokens:0, tool_calls:0, active_execution_ms:0, failed_hypotheses:0 } }

export async function runFresh(ctx, parent, invocationSignal, {
  label, persona, prompt, outputSchema, agentOptions,
  runtime = null, task = null, role = null, allowedRoots = null, taskBudgeted = false, tokenizerEndpoint = 'http://127.0.0.1:8080/tokenize',
}) {
  const roleName = role ?? ({
    'source-triage':'SOURCE_CURATOR', 'task-planner':'TASK_PLANNER', 'test-analyst':'TEST_ANALYST',
    'independent-review':'REVIEWER', 'outcome-acceptance':'ACCEPTANCE_AUDITOR', 'context-compactor':'CONTEXT_COMPACTOR',
  }[label] ?? String(label).toUpperCase())
  const roleBudget = roleBudgetFor(runtime, roleName)
  const bounded = boundedPrompt(prompt, Math.min(roleBudget.max_input_chars, Number(agentOptions?.inputMaxChars ?? roleBudget.max_input_chars)))
  const roots = (allowedRoots ?? [runtime?.root ?? parent?.session?.header?.cwd]).filter(Boolean).map(x => path.resolve(x))
  const baseGlobalUsage = taskBudgeted && task ? taskUsage(null, task) : null
  if (taskBudgeted && task) {
    const globalBudget = activeBudget(task)
    const exhausted = budgetExhausted(baseGlobalUsage, globalBudget)
    if (exhausted) throw new Error(`TASK_BUDGET_EXHAUSTED_BEFORE_${roleName}: ${exhausted}`)
  }
  const options = { ...(agentOptions ?? {}), maxTokens: Math.min(Number(agentOptions?.maxTokens ?? roleBudget.max_tokens_per_request), roleBudget.max_tokens_per_request) }
  delete options.inputMaxChars
  const run = await ctx.subagents.start('spawn', {
    label, parent, signal: invocationSignal, prompt: [{ type: 'text', text: bounded }], maxDepth: 1,
    toolFilter: { allow: ['read', 'grep', 'glob'] }, persona, outputSchema, agentOptions: options,
  })
  const roleCtx = {
    role: roleName, budget: roleBudget, read_bytes: 0, tool_calls: 0, guard_seen: false, violation: null,
    projectRoot: runtime?.root ?? parent?.session?.header?.cwd, allowedRoots: roots,
    taskId: task?.id ?? null, runtime, baseGlobalUsage, globalBudget: task ? activeBudget(task) : null, tokenizerEndpoint,
  }
  if (run.localAgent) freshRoleContexts.set(run.localAgent, roleCtx)
  try {
    const result = await run.result
    const local = run.localAgent
    let usage = zeroUsageForRole()
    if (local) usage = await measureAgentUsage(local, roleCtx.tokenizerEndpoint)
    // foldUsage sees DSH's terminal structured_output event as a tool call. In the real plugin the
    // fresh-role host guard is authoritative and counts only productive read/grep/glob attempts.
    // Keep foldUsage as a fallback for isolated unit harnesses that do not install/run the guard.
    if (roleCtx.guard_seen) usage.tool_calls = roleCtx.tool_calls
    const roleExceeded = roleCtx.violation ? 'read_or_policy' : roleBudgetExceededAfterRun(usage, roleBudget)
    if (taskBudgeted && runtime && task) {
      await withRuntimeLock(runtime, async () => {
        const { state, task: freshTask } = current(runtime)
        if (!freshTask || freshTask.id !== task.id) throw new Error(`${roleName}: active task changed during role run`)
        addRoleUsageToTask(freshTask, roleName, usage)
        const globalUsage = taskUsage(null, freshTask)
        const globalExceeded = budgetExceededAfterRun(globalUsage, activeBudget(freshTask))
        if (roleExceeded || globalExceeded) {
          state.task_state = 'BUDGET_PAUSED'; state.operation = null
          freshTask.execution.budget_pause_reason = roleCtx.violation ?? (roleExceeded ? `role_${roleName}_${roleExceeded}` : `global_after_${roleName}_${globalExceeded}`)
          freshTask.execution.last_usage = globalUsage
          saveTask(runtime.paths, freshTask); saveState(runtime.paths, state)
          throw new Error(roleCtx.violation ?? (roleExceeded ? `ROLE_BUDGET_EXCEEDED:${roleName}:${roleExceeded}` : `TASK_BUDGET_EXCEEDED_AFTER_${roleName}:${globalExceeded}`))
        }
        saveTask(runtime.paths, freshTask)
      })
    } else if (roleExceeded) throw new Error(roleCtx.violation ?? `ROLE_BUDGET_EXCEEDED:${roleName}:${roleExceeded}`)
    if (result.stopReason !== 'completed') {
      const events = run.localAgent?.session?.events ?? []
      const turnEnd = [...events].reverse().find(e => e?.type === 'turn/end')
      let detail = ''
      try { detail = turnEnd?.data?.reason ? JSON.stringify(turnEnd.data.reason) : '' } catch {}
      throw new Error(`${label} subagent stopped with ${result.stopReason}${detail ? `; turn_end=${detail}` : ''}`)
    }
    if (result.structured === undefined) throw new Error(`${label} subagent returned no structured output`)
    return result.structured
  } finally {
    if (run.localAgent) freshRoleContexts.delete(run.localAgent)
    await run.dispose()
  }
}

export function freshRolePreStepGuard(agent) {
  return freshRoleContexts.get(agent)
}

export { roleReadGuard, accountRoleReadResult, roleBudgetExceededAfterRun, measureAgentUsage }
