import { executionPolicyStatus } from './lib/execution-policy.js'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { budgetExceededPreStep, callKey, failureText, pathAllowed, safeWorktreeTarget } from './lib/core.js'
import { atomicWriteJson, readJson, saveState, saveTask, withRuntimeLock } from './lib/state.js'
import { assertDonorUnchanged, changedPaths, donorFingerprint, isIgnoredPath, reservedChangedPaths, unprovenIgnoredPaths, unpublishablePaths } from './lib/git.js'
import { checkpointDue, checkpointPayloadValidation, emptyWorkingState, renderWorkingStateContext, resetCheckpointCounters } from './lib/working-state.js'
import { commitUniversalWorkingState } from './lib/context-memory.js'
import { compressionOfferActive, installUniversalCommit, isProtocolTool } from './lib/universal-commit.js'
import { registerContextCommands } from './lib/context-commands.js'
import { applyLosslessHygiene } from './lib/context-hygiene.js'
import { tokenEntryKey } from './lib/token-accounting.js'
import { workflowIntent, messageText } from './lib/intent-router.js'
import { workerReserveExceededPreStep, roleBudgetExceededPreStep } from './lib/role-control.js'
import { validationReserveFor, validateBudgetEnvelope } from './lib/runtime-policy.js'
import { agentId, taskUsage, backfillTokenAccounting, snapshotUsage, activeBudget, addUsage } from './lib/execution-usage.js'
import { freshRoleContexts, roleReadGuard, accountRoleReadResult, measureAgentUsage } from './lib/fresh-role.js'
import { runtimeForAgent, current, completeGoal, blockGoal, removeWorker, blockAndCancel } from './lib/host-runtime.js'
import { registerHumanCommands } from './lib/commands.js'
import { authorizeExecution, clearExecutionPermission, executionPermission, EXECUTION_GATED_TOOLS } from './lib/execution-policy.js'
export const name = 'local-dsh-v4-control'
export const inject = ['tools', 'commands', 'goals', 'subagents', 'sessions', 'agents', 'tokenMeter']
const DEFAULTS = Object.freeze({
  maxGoalRounds: 6,
  maxStepsPerTurn: 12,
  maxToolCallsPerTurn: 39,
  maxTokensPerRequest: 16384,
  identicalFailureLimit: 1,
  cancelAfterBlockedAttempts: 2,
  checkpointEverySteps: 3,
  tokenizerEndpoint: 'http://127.0.0.1:8080/tokenize',
  roleProvider: 'llama-local',
  roleModel: 'qwen3.8-27b',
  testRoleMaxTokens: 8192,
  testRoleInputMaxChars: 48000,
  testCommandTimeoutMs: 600000,
  requestReasoningStarvationThreshold: 10000,
  requestVisibleReserveTokens: 1024,
  starvationRecoveryMaxTokens: 4096,
  maxReasoningStarvationRecoveries: 2,
})
const turnStates = new WeakMap()
const mutationBefore = new WeakMap()
function positiveInt(v, field, fallback) {
  const value = v ?? fallback
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be a positive safe integer`)
  return value
}
function pauseForBudget(ctx, runtime, agent, state, task, field) {
  state.task_state = 'BUDGET_PAUSED'
  state.worker_session_id = null
  task.execution ??= {}
  task.execution.budget_pause_reason = field
  snapshotUsage(agent, task, { closeEpoch: true })
  saveTask(runtime.paths, task)
  saveState(runtime.paths, state)
  blockAndCancel(ctx, runtime, agent, 'task-budget', `Task budget paused: ${field}`)
}
function controlledProjectHint(agent) {
  let cursor = agent?.session?.header?.cwd
  if (!cursor) return false
  cursor = path.resolve(cursor)
  while (true) {
    if (fs.existsSync(path.join(cursor, '.dsh', 'project', 'state.json'))) return true
    const parent = path.dirname(cursor)
    if (parent === cursor) return false
    cursor = parent
  }
}
function guardFailureReason(area, error) {
  return `HOST_GUARD_INTERNAL_ERROR:${area}:${String(error?.message ?? error)}`
}
function cancelForGuard(agent, reason) {
  try { agent?.cancel?.({ kind: 'hook', reason }, { keepInbox: false }) } catch {}
}

async function failClosedTaskGuard(ctx, runtime, agent, area, error) {
  const reason = guardFailureReason(area, error)
  ctx.logger?.error?.(reason)
  if (!runtime) { cancelForGuard(agent, reason); return reason }
  try {
    await withRuntimeLock(runtime, async () => {
      const { state, task } = current(runtime)
      const owned = task && state.task_state === 'IN_PROGRESS' && state.worker_session_id === agentId(agent)
      if (!owned) { cancelForGuard(agent, reason); return }
      state.task_state = 'BLOCKED_QUALIFICATION'
      state.worker_session_id = null
      task.execution ??= {}
      task.execution.host_guard_failure = { area, reason, at: new Date().toISOString() }
      snapshotUsage(agent, task, { closeEpoch: true })
      saveTask(runtime.paths, task)
      saveState(runtime.paths, state)
      blockAndCancel(ctx, runtime, agent, 'host-guard-internal-error', reason)
    })
  } catch (secondary) {
    ctx.logger?.error?.(`${reason}; fail-closed persistence also failed: ${String(secondary)}`)
    cancelForGuard(agent, reason)
  }
  return reason
}

function turnStateFor(agent, turn) {
  const old = turnStates.get(agent)
  if (old && old.turn === turn) return old
  const fresh = { turn, toolCalls: 0, failures: new Map(), blockedAttempts: new Map(), mutationAuthorityDenied: null, taskToolBase: null, taskToolLimit: null, workerToolThreshold: null }
  turnStates.set(agent, fresh)
  return fresh
}

function semanticToolFailure(exec, result) {
  if (result?.isError) return { failed: true, text: failureText(result) }
  if ((exec.name === 'pwsh' || exec.name === 'bash') && result?.value && typeof result.value === 'object') {
    const v = result.value
    if (v.kind === 'foreground') {
      if (v.sandbox?.denied) return { failed: true, text: 'SHELL_SANDBOX_DENIED' }
      if (v.timedOut) return { failed: true, text: 'SHELL_TIMEOUT' }
      if (v.aborted) return { failed: true, text: 'SHELL_ABORTED' }
      if (typeof v.exitCode === 'number' && v.exitCode !== 0) return { failed: true, text: `SHELL_EXIT_${v.exitCode}` }
    }
  }
  return { failed: false, text: '' }
}

function activeWorkerAuthority(runtime, agent, { requireFreshRevision = true } = {}) {
  const { state, task } = current(runtime)
  if (!task || state.task_state !== 'IN_PROGRESS') return { ok: false, reason: `MUTATION_AUTHORITY_DENIED: project task state is ${state.task_state}. Workspace mutation is disabled across write/edit/shell execution paths until an explicit /task → /work flow grants authority. Ordinary text deliverables should be returned in chat.`, state, task }
  const stateOwner = state.worker_session_id ?? null
  const taskOwner = task.execution?.worker_session_id ?? null
  if (stateOwner && taskOwner && stateOwner !== taskOwner) return { ok: false, reason: `Task ownership state mismatch: state=${stateOwner}, task=${taskOwner}`, state, task }
  const owner = stateOwner ?? taskOwner
  if (!owner || owner !== agentId(agent)) return { ok: false, reason: `Task owned by another session: ${owner ?? 'none'}`, state, task }
  if (requireFreshRevision && task.source_revision !== state.source_revision) return { ok: false, reason: `STALE_PACKET: packet=${task.source_revision}, project=${state.source_revision}`, state, task }
  return { ok: true, state, task }
}

function mutationAuthority(runtime, agent) {
  const auth = activeWorkerAuthority(runtime, agent)
  if (!auth.ok) return auth
  if (!auth.task.execution?.worktree || !auth.task.execution?.baseline_commit) return { ok: false, reason: 'Task worktree is not initialized', state: auth.state, task: auth.task }
  return auth
}

function directWriteReason(runtime, agent, exec) {
  const auth = mutationAuthority(runtime, agent)
  if (!auth.ok) return auth.reason
  const target = exec.arguments?.file_path
  const checked = safeWorktreeTarget(target, auth.task.execution.worktree)
  if (!checked.ok) return `DIRECT_WRITE_DENIED: ${checked.reason}. Use absolute task-worktree paths.`
  if (checked.relative === '.dsh' || checked.relative.startsWith('.dsh/') || checked.relative === '.git' || checked.relative.startsWith('.git/')) return `RESERVED_PATH_DENIED: ${checked.relative}`
  return undefined
}

function shellReason(runtime, agent, exec) {
  const auth = mutationAuthority(runtime, agent)
  if (!auth.ok) return auth.reason
  if (exec.arguments?.run_in_background === true) return 'BACKGROUND_SHELL_DISABLED: foreground only during controlled /work'
  const workdir = exec.arguments?.workdir
  if (!workdir) return 'SHELL_WORKDIR_REQUIRED: set absolute workdir inside the disposable task worktree'
  const checked = safeWorktreeTarget(workdir, auth.task.execution.worktree)
  if (!checked.ok) return `SHELL_WORKDIR_DENIED: ${checked.reason}`
  const perm = String(exec.arguments?.sandbox_permissions ?? '')
  if (/danger|full|escalat/i.test(perm)) return 'SHELL_PERMISSION_ESCALATION_DENIED'
  return undefined
}

function recordEvidence(runtime, taskId, kind, value) {
  const dir = runtime.paths.evidence
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${taskId}.${kind}.${Date.now()}.json`)
  atomicWriteJson(file, value)
  return file
}

function makeTool(name, description, properties, required, execute) {
  return {
    name,
    description,
    parameters: { type: 'object', additionalProperties: false, properties, required },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute,
  }
}

function captureMutationBoundary(runtime, auth, exec) {
  const permission = executionPermission(exec)
  mutationBefore.set(exec, {
    donor: donorFingerprint(runtime.root),
    projectAuthority: donorProjectAuthorityFingerprint(runtime.paths.project),
    baseline: auth.task.execution.baseline_commit,
    ignoredBaseline: auth.task.execution.worktree_ignored_baseline ?? {},
    writeSet: [...(auth.task.write_set ?? [])],
    worktree: auth.task.execution.worktree,
    taskId: auth.task.id,
    changedBefore: new Set(changedPaths(auth.task.execution.worktree, auth.task.execution.baseline_commit, auth.task.execution.worktree_ignored_baseline ?? {})),
    permission,
  })
}

function recordExecutionSideEffects(task, before, paths) {
  task.execution ??= {}
  task.execution.execution_side_effects ??= []
  for (const rel of paths) {
    const ignored = isIgnoredPath(before.worktree, rel)
    if (pathAllowed(rel, before.writeSet) && !ignored) continue
    const rec = {
      path: rel,
      kind: ignored ? 'ephemeral_ignored' : 'unpublishable',
      operation_id: before.permission?.operation_id ?? null,
      permission: before.permission?.kind ?? 'unknown',
      signature: before.permission?.descriptor?.signature ?? null,
      tool: before.permission?.descriptor?.tool ?? null,
      observed_at: new Date().toISOString(),
    }
    const old = task.execution.execution_side_effects.find(x => x.path === rel && x.kind === rec.kind)
    if (old) Object.assign(old, rec)
    else task.execution.execution_side_effects.push(rec)
  }
}

function latestAssistantForTurn(agent, turn) {
  const events = agent?.session?.events ?? []
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i]
    if (e?.type === 'assistant/message' && e.data?.turn === turn) return e
  }
  return null
}
function hasToolCall(message) { return (message?.content ?? []).some(block => block?.type === 'tool-call') }
function lastStepTokenEntry(task, agent, turn, step) {
  if (step == null) return null
  return task?.execution?.token_accounting?.entries?.[tokenEntryKey(agentId(agent), turn, step)] ?? null
}
function nextStepForTurn(agent, turn) {
  let max = null
  for (const e of agent?.session?.events ?? []) if (e?.type === 'assistant/message' && e.data?.turn === turn) max = Math.max(max ?? 0, Number(e.data?.step ?? 0))
  return max
}
function appendIntentAudit(runtime, record) {
  const file = path.join(runtime.paths.project, 'INTENT_ROUTES.jsonl')
  fs.appendFileSync(file, `${JSON.stringify({ ...record, at: new Date().toISOString() })}\n`, 'utf8')
}

function automaticGoalRound(messages = []) {
  return messages.find(message => message?.source?.kind === 'goal' && Number(message.source.round) > 0)?.source?.round ?? null
}

function pluginSnapshotMessage(text, section = 'qwen-v4-working-state') {
  const id = crypto.randomUUID()
  return Object.freeze({
    id,
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
    source: Object.freeze({ kind: 'plugin', plugin: name, form: 'snapshot', sections: Object.freeze([Object.freeze({ name: section, text })]) }),
  })
}

function markCheckpointProgress(task, { stepIncrement = 0, meaningfulIncrement = 0 } = {}) {
  task.execution ??= {}
  task.execution.steps_since_checkpoint = Number(task.execution.steps_since_checkpoint ?? 0) + stepIncrement
  task.execution.meaningful_since_checkpoint = Number(task.execution.meaningful_since_checkpoint ?? 0) + meaningfulIncrement
}

function appendPendingEvidence(task, exec, result) {
  task.execution ??= {}
  task.execution.pending_evidence ??= []
  task.execution.evidence_seq = Number(task.execution.evidence_seq ?? 0) + 1
  const semantic = semanticToolFailure(exec, result)
  const id = `EV-${String(task.execution.evidence_seq).padStart(5, '0')}`
  const item = {
    id,
    tool: exec.name,
    outcome: semantic.failed ? `FAILED:${semantic.text}` : 'OK',
    args_sha256: crypto.createHash('sha256').update(JSON.stringify(exec.arguments ?? {})).digest('hex').slice(0, 16),
    at: new Date().toISOString(),
  }
  task.execution.pending_evidence.push(item)
  return item
}

export function apply(ctx, config = {}) {
  const resolved = {
    maxGoalRounds: positiveInt(config.maxGoalRounds, 'maxGoalRounds', DEFAULTS.maxGoalRounds),
    maxStepsPerTurn: positiveInt(config.maxStepsPerTurn, 'maxStepsPerTurn', DEFAULTS.maxStepsPerTurn),
    maxToolCallsPerTurn: positiveInt(config.maxToolCallsPerTurn, 'maxToolCallsPerTurn', DEFAULTS.maxToolCallsPerTurn),
    maxTokensPerRequest: positiveInt(config.maxTokensPerRequest, 'maxTokensPerRequest', DEFAULTS.maxTokensPerRequest),
    identicalFailureLimit: positiveInt(config.identicalFailureLimit, 'identicalFailureLimit', DEFAULTS.identicalFailureLimit),
    cancelAfterBlockedAttempts: positiveInt(config.cancelAfterBlockedAttempts, 'cancelAfterBlockedAttempts', DEFAULTS.cancelAfterBlockedAttempts),
    checkpointEverySteps: positiveInt(config.checkpointEverySteps, 'checkpointEverySteps', DEFAULTS.checkpointEverySteps),
    tokenizerEndpoint: String(config.tokenizerEndpoint ?? process.env.QWEN_V4_TOKENIZER_ENDPOINT ?? DEFAULTS.tokenizerEndpoint),
    roleProvider: String(config.roleProvider ?? DEFAULTS.roleProvider),
    roleModel: String(config.roleModel ?? DEFAULTS.roleModel),
    testRoleMaxTokens: positiveInt(config.testRoleMaxTokens, 'testRoleMaxTokens', DEFAULTS.testRoleMaxTokens),
    testRoleInputMaxChars: positiveInt(config.testRoleInputMaxChars, 'testRoleInputMaxChars', DEFAULTS.testRoleInputMaxChars),
    testCommandTimeoutMs: positiveInt(config.testCommandTimeoutMs, 'testCommandTimeoutMs', DEFAULTS.testCommandTimeoutMs),
    requestReasoningStarvationThreshold: positiveInt(config.requestReasoningStarvationThreshold, 'requestReasoningStarvationThreshold', DEFAULTS.requestReasoningStarvationThreshold),
    requestVisibleReserveTokens: positiveInt(config.requestVisibleReserveTokens, 'requestVisibleReserveTokens', DEFAULTS.requestVisibleReserveTokens),
    starvationRecoveryMaxTokens: positiveInt(config.starvationRecoveryMaxTokens, 'starvationRecoveryMaxTokens', DEFAULTS.starvationRecoveryMaxTokens),
    maxReasoningStarvationRecoveries: positiveInt(config.maxReasoningStarvationRecoveries, 'maxReasoningStarvationRecoveries', DEFAULTS.maxReasoningStarvationRecoveries),
  }

  ctx.on('agent/request', async ({ agent, turn, step }, next) => {
    const base = await next()
    let out = { ...base, maxTokens: base.maxTokens === undefined ? resolved.maxTokensPerRequest : Math.min(base.maxTokens, resolved.maxTokensPerRequest) }
    try {
      const runtime = runtimeForAgent(agent)
      await withRuntimeLock(runtime, async () => {
        const auth = activeWorkerAuthority(runtime, agent, { requireFreshRevision: false })
        if (!auth.ok || !auth.task.execution?.force_action_only_next) return
        out = { ...out, reasoningEffort: 'off', maxTokens: Math.min(out.maxTokens ?? resolved.starvationRecoveryMaxTokens, resolved.starvationRecoveryMaxTokens) }
        auth.task.execution.force_action_only_next = false
        auth.task.execution.force_action_only_active = { turn, step, at: new Date().toISOString() }
        saveTask(runtime.paths, auth.task)
      })
    } catch (error) {
      if (controlledProjectHint(agent)) {
        const reason = guardFailureReason('request-policy', error)
        ctx.logger?.error?.(reason); cancelForGuard(agent, reason)
        throw new Error(reason)
      }
    }
    return out
  })

  ctx.on('agent/pre-step', async ({ agent, messages = [], step, signal }, next) => {
    if (agent?.session?.header?.parentSession) return next()
    if (step !== 1) return next()
    const humans = messages.filter(m => m?.source?.kind === 'user')
    if (humans.length !== 1) return next()
    const text = messageText(humans[0])
    let taskState
    try { taskState = current(runtimeForAgent(agent)).state.task_state } catch { return next() }
    const routed = workflowIntent(text, { taskState, compressionOffer: compressionOfferActive(agent) })
    if (!routed) return next()
    const line = `/${routed.command}${routed.rawInput ? ` ${routed.rawInput}` : ''}`
    const execution = await ctx.commands.execute(agent, line, signal)
    if (!execution) return next()
    try { appendIntentAudit(runtimeForAgent(agent), { session_id: agentId(agent), original_text: text, routed_command: line, result: execution.result }) } catch {}
    return { kind: 'reject' }
  }, { prepend: true })

  ctx.on('agent/pre-step', async ({ agent, messages = [], turn, step }, next) => {
    turnStateFor(agent, turn)
    const roleCtx = freshRoleContexts.get(agent)
    if (roleCtx) {
      const usage = await measureAgentUsage(agent, roleCtx.tokenizerEndpoint)
      usage.tool_calls = roleCtx.tool_calls
      const roleExceeded = roleBudgetExceededPreStep(usage, roleCtx.budget)
      let globalExceeded
      if (!roleExceeded && roleCtx.baseGlobalUsage && roleCtx.globalBudget) {
        globalExceeded = budgetExceededPreStep(addUsage(roleCtx.baseGlobalUsage, usage, 0), roleCtx.globalBudget)
      }
      if (roleExceeded || globalExceeded || roleCtx.violation) {
        const reason = roleCtx.violation ?? `ROLE_BUDGET_EXCEEDED:${roleCtx.role}:${roleExceeded ?? `global_${globalExceeded}`}`
        roleCtx.violation = reason
        try { agent.cancel({ kind: 'hook', reason }, { keepInbox: false }) } catch {}
        return { kind: 'reject' }
      }
      return next()
    }
    let injected = null
    let reject = false
    let runtime = null
    try {
      runtime = runtimeForAgent(agent)
      await withRuntimeLock(runtime, async () => {
        const { state, task } = current(runtime)
        if (step > resolved.maxStepsPerTurn) {
          if (task && state.task_state === 'IN_PROGRESS' && state.worker_session_id === agentId(agent)) {
            pauseForBudget(ctx, runtime, agent, state, task, 'max_steps_per_turn')
          }
          reject = true
          return
        }
        if (!task || state.task_state !== 'IN_PROGRESS' || state.worker_session_id !== agentId(agent)) return
        await backfillTokenAccounting(runtime, agent, task, resolved.tokenizerEndpoint)
        const usage = taskUsage(agent, task)
        const budget = activeBudget(task)
        const reserve = validationReserveFor(runtime, state.task_state)
        let envelopeError = null
        try { validateBudgetEnvelope(budget, reserve) } catch (error) { envelopeError = error }
        const exceeded = budgetExceededPreStep(usage, budget)
        const reserveHit = envelopeError ? 'runtime_policy_validation_envelope' : (exceeded ? undefined : workerReserveExceededPreStep(usage, budget, reserve))
        const turnState = turnStates.get(agent)
        if (turnState && turnState.taskToolBase === null) {
          turnState.taskToolBase = Number(usage.tool_calls ?? 0)
          turnState.taskToolLimit = Number(budget.max_tool_calls ?? 0)
          turnState.workerToolThreshold = Math.max(0, Number(budget.max_tool_calls ?? 0) - Number(reserve.max_tool_calls ?? 0))
        }
        if (exceeded || reserveHit) {
          pauseForBudget(ctx, runtime, agent, state, task, exceeded ?? reserveHit)
          reject = true
          return
        }

        const round = automaticGoalRound(messages)
        const due = checkpointDue(task, {
          isAutomaticGoalRound: round !== null,
          maxStepsWithoutCheckpoint: resolved.checkpointEverySteps,
        })
        if (due && !task.execution?.checkpoint_required) {
          task.execution ??= {}
          task.execution.checkpoint_required = true
          task.execution.checkpoint_required_reason = round !== null
            ? `automatic_goal_round_${round}_after_${task.execution.steps_since_checkpoint ?? 0}_uncheckpointed_step(s)_and_${task.execution.meaningful_since_checkpoint ?? 0}_tool_result(s)`
            : `steps_without_checkpoint_${task.execution.steps_since_checkpoint ?? 0}`
          saveTask(runtime.paths, task)
        }
        if (round !== null || due) {
          const working = readJson(runtime.paths.workingState, emptyWorkingState(task.id))
          injected = pluginSnapshotMessage(renderWorkingStateContext(working, {
            checkpointRequired: Boolean(task.execution?.checkpoint_required),
            pendingEvidence: task.execution?.pending_evidence ?? [],
          }))
        }
      })
    } catch (error) {
      if (runtime || controlledProjectHint(agent)) {
        await failClosedTaskGuard(ctx, runtime, agent, 'pre-step-accounting-checkpoint', error)
        reject = true
      } else {
        ctx.logger?.warn?.(`v4-control pre-step skipped outside a controlled project: ${String(error)}`)
      }
    }
    if (reject) return { kind: 'reject' }
    const decision = await next()
    if (!injected || decision.kind !== 'enter') return decision
    return { kind: 'enter', messages: [injected, ...decision.messages] }
  })

  ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
    let runtime = null
    try {
      runtime = runtimeForAgent(agent)
      await withRuntimeLock(runtime, async () => {
        const { state, task } = current(runtime)
        if (!task || state.task_state !== 'IN_PROGRESS' || state.worker_session_id !== agentId(agent)) return
        await backfillTokenAccounting(runtime, agent, task, resolved.tokenizerEndpoint)

        const latest = latestAssistantForTurn(agent, turn)
        const latestStep = latest?.data?.step ?? nextStepForTurn(agent, turn)
        const entry = lastStepTokenEntry(task, agent, turn, latestStep)
        const reasoning = Number(entry?.reasoning_tokens ?? 0)
        const visible = Number(entry?.visible_output_tokens ?? 0)
        if (latest && !hasToolCall(latest.data?.message)
            && reasoning >= resolved.requestReasoningStarvationThreshold
            && visible < resolved.requestVisibleReserveTokens) {
          task.execution.reasoning_starvation_recoveries = Number(task.execution.reasoning_starvation_recoveries ?? 0) + 1
          const count = task.execution.reasoning_starvation_recoveries
          task.execution.reasoning_starvation_last = { turn, step: latestStep, reasoning_tokens: reasoning, visible_output_tokens: visible, at: new Date().toISOString() }
          if (count > resolved.maxReasoningStarvationRecoveries) {
            state.task_state = 'BUDGET_PAUSED'; state.worker_session_id = null
            task.execution.budget_pause_reason = 'reasoning_output_starvation'
            snapshotUsage(agent, task, { closeEpoch: true })
            saveTask(runtime.paths, task); saveState(runtime.paths, state)
            blockGoal(ctx, agent, 'reasoning-output-starvation', `Reasoning starved required action/output ${count} times`)
            removeWorker(runtime, agent)
            return
          }
          task.execution.force_action_only_next = true
          saveTask(runtime.paths, task)
          agent.steer(pluginSnapshotMessage(`REASONING_OUTPUT_STARVATION: ${reasoning} reasoning tokens left only ${visible} visible/action tokens and no tool call. The host will disable reasoning for exactly the next rescue request and cap it at ${resolved.starvationRecoveryMaxTokens}. Do not analyze again; emit the required task/tool action or concise terminal task tool now.`, 'qwen-v4-action-only-rescue'))
          return
        }

        if (task.execution?.checkpoint_required) {
          state.task_state = 'BUDGET_PAUSED'
          state.worker_session_id = null
          task.execution ??= {}
          task.execution.budget_pause_reason = 'checkpoint_barrier_unresolved'
          task.execution.checkpoint_protocol_violation = {
            at: new Date().toISOString(),
            reason: task.execution.checkpoint_required_reason ?? 'host checkpoint barrier',
            action: 'Autonomous continuation paused because the required checkpoint was not emitted before turn stop.',
          }
          snapshotUsage(agent, task, { closeEpoch: true })
          saveTask(runtime.paths, task)
          saveState(runtime.paths, state)
          blockGoal(ctx, agent, 'checkpoint-required', 'Required task_checkpoint was not emitted before turn stop')
          removeWorker(runtime, agent)
          return
        }

        if (Number(task.execution?.meaningful_since_checkpoint ?? 0) > 0) {
          task.execution.checkpoint_required = true
          task.execution.checkpoint_required_reason = `pre_goal_continuation_after_turn_${turn}`
          saveTask(runtime.paths, task)
          const working = readJson(runtime.paths.workingState, emptyWorkingState(task.id))
          agent.steer(pluginSnapshotMessage(renderWorkingStateContext(working, {
            checkpointRequired: true,
            pendingEvidence: task.execution?.pending_evidence ?? [],
          }), 'qwen-v4-checkpoint-barrier'))
          return
        }

        const goal = ctx.goals.get(agent)
        if (goal?.phase === 'active' && goal.roundsStarted >= goal.maxGoalRounds) {
          state.task_state = 'BUDGET_PAUSED'
          state.worker_session_id = null
          task.execution ??= {}
          task.execution.budget_pause_reason = 'max_goal_rounds'
          snapshotUsage(agent, task, { closeEpoch: true })
          saveTask(runtime.paths, task)
          saveState(runtime.paths, state)
          blockGoal(ctx, agent, 'goal-round-cap', `Host goal cap reached: ${goal.roundsStarted}/${goal.maxGoalRounds}`)
          removeWorker(runtime, agent)
        }
      })
    } catch (error) {
      if (runtime || controlledProjectHint(agent)) await failClosedTaskGuard(ctx, runtime, agent, 'turn-stop-check', error)
      else ctx.logger?.warn?.(`v4-control turn-stop skipped outside a controlled project: ${String(error)}`)
    }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    for (const runtime of runtimeByRoot.values()) runtime.activeWorkers.delete(agent)
  })

  ctx.on('session/event', async (session, event) => {
    if (event?.type !== 'assistant/message') return
    const agent = ctx.agents?.get?.(session.id)
    if (!agent || agent.session !== session) return
    let runtime = null
    try {
      runtime = runtimeForAgent(agent)
      await withRuntimeLock(runtime, async () => {
        const auth = activeWorkerAuthority(runtime, agent, { requireFreshRevision: false })
        if (!auth.ok) return
        markCheckpointProgress(auth.task, { stepIncrement: 1 })
        saveTask(runtime.paths, auth.task)
      })
    } catch (error) {
      if (runtime || controlledProjectHint(agent)) await failClosedTaskGuard(ctx, runtime, agent, 'checkpoint-cadence-event', error)
      else ctx.logger?.warn?.(`v4-control checkpoint cadence skipped outside a controlled project: ${String(error)}`)
    }
  })

  ctx.tools.guard((exec) => {
    const agent = exec.agent
    if (!agent) return undefined
    const roleCtx = freshRoleContexts.get(agent)
    if (roleCtx) {
      if (!['read','grep','glob','structured_output'].includes(exec.name)) return `ROLE_TOOL_DENIED: ${roleCtx.role} may only use read/grep/glob/structured_output`
      roleCtx.guard_seen = true
      if (exec.name !== 'structured_output') roleCtx.tool_calls += 1
      if (roleCtx.tool_calls > roleCtx.budget.max_tool_calls) return `ROLE_TOOL_BUDGET_EXCEEDED: ${roleCtx.role} ${roleCtx.tool_calls}/${roleCtx.budget.max_tool_calls}`
      if (exec.name !== 'structured_output' && roleCtx.baseGlobalUsage && roleCtx.globalBudget) {
        const globalTools = Number(roleCtx.baseGlobalUsage.tool_calls ?? 0) + roleCtx.tool_calls
        if (globalTools > Number(roleCtx.globalBudget.max_tool_calls ?? 0)) {
          return `TASK_TOOL_BUDGET_EXCEEDED_IN_ROLE: ${roleCtx.role} ${globalTools}/${roleCtx.globalBudget.max_tool_calls}`
        }
      }
      const denial = roleReadGuard(exec, roleCtx)
      if (denial) return denial
    }
    const st = turnStates.get(agent)
    if (st) {
      if (!isProtocolTool(exec.name)) st.toolCalls += 1
      if (st.toolCalls > resolved.maxToolCallsPerTurn) {
        try {
          const runtime = runtimeForAgent(agent)
          const { state, task } = current(runtime)
          if (task && state.task_state === 'IN_PROGRESS') pauseForBudget(ctx, runtime, agent, state, task, 'max_tool_calls_per_turn')
        } catch {}
        const reason = `anti-runaway: per-turn tool budget exceeded (${st.toolCalls}/${resolved.maxToolCallsPerTurn})`
        try { agent.cancel({ kind: 'hook', reason }, { keepInbox: false }) } catch {}
        return reason
      }
      const key = callKey(exec)
      const failure = st.failures.get(key)
      if (failure && failure.count >= resolved.identicalFailureLimit) {
        const priorBlocked = st.blockedAttempts.get(key) ?? 0
        // Allow one exact state_checkpoint replay; the next identical failure is denied.
        if (exec.name === 'state_checkpoint' && priorBlocked === 0) {
          st.blockedAttempts.set(key, 1)
        } else {
          const attempts = priorBlocked + 1
          st.blockedAttempts.set(key, attempts)
          const reason = `anti-runaway: exact failed tool replay denied; previous failure=${failure.error}`
          if (attempts >= resolved.cancelAfterBlockedAttempts) {
            try { agent.cancel({ kind: 'hook', reason: `${reason}; repeated denied replay=${attempts}` }, { keepInbox: false }) } catch {}
          }
          return reason
        }
      }
    }

    if (st && !isProtocolTool(exec.name) && st.taskToolBase !== null) {
      const nextGlobal = Number(st.taskToolBase ?? 0) + Number(st.toolCalls ?? 0)
      if (Number.isFinite(st.workerToolThreshold) && nextGlobal > st.workerToolThreshold) {
        return `VALIDATION_RESERVE_TOOL_BUDGET_EXCEEDED: productive tool ${nextGlobal} would cross worker threshold ${st.workerToolThreshold}/${st.taskToolLimit}`
      }
      if (Number.isFinite(st.taskToolLimit) && nextGlobal > st.taskToolLimit) {
        return `TASK_TOOL_BUDGET_EXCEEDED: productive tool ${nextGlobal}/${st.taskToolLimit}`
      }
    }

    const mutationTool = ['write','edit','pwsh','bash'].includes(exec.name) || EXECUTION_GATED_TOOLS.has(exec.name)
    if (mutationTool && st?.mutationAuthorityDenied) {
      return `MUTATION_POLICY_ALREADY_DENIED_THIS_TURN: ${st.mutationAuthorityDenied}`
    }

    let runtime
    try { runtime = runtimeForAgent(agent) } catch (error) { return controlledProjectHint(agent) ? guardFailureReason('tool-runtime', error) : undefined }

    try {
      const { state, task } = current(runtime)
      if (task && state.task_state === 'IN_PROGRESS' && state.worker_session_id === agentId(agent)
        && task.execution?.checkpoint_required && exec.name !== 'task_checkpoint') {
        return `CHECKPOINT_REQUIRED_BEFORE_CONTINUATION: ${task.execution.checkpoint_required_reason ?? 'host policy'}; call task_checkpoint first`
      }
    } catch (error) {
      return guardFailureReason('checkpoint-guard', error)
    }

    let planActive = false
    const planEvents = agent?.session?.events
    if (planEvents && typeof planEvents[Symbol.iterator] === 'function') {
      for (const event of planEvents) {
        if (event?.type === 'plan/mode') {
          planActive = event?.data?.active === true
        }
      }
    }
    const freeAutoNoTask =
      current(runtime).state.task_state === 'NO_TASK'
      && executionPolicyStatus(runtime).mode === 'auto'
      && !planActive

    if (!freeAutoNoTask && (exec.name === 'write' || exec.name === 'edit')) {
      const denial = directWriteReason(runtime, agent, exec)
      if (denial) {
        if (denial.startsWith('MUTATION_AUTHORITY_DENIED:') && st) st.mutationAuthorityDenied = denial
        return denial
      }
    }
    if (!freeAutoNoTask && (exec.name === 'pwsh' || exec.name === 'bash')) {
      const denial = shellReason(runtime, agent, exec)
      if (denial) {
        if (denial.startsWith('MUTATION_AUTHORITY_DENIED:') && st) st.mutationAuthorityDenied = denial
        return denial
      }
    }
    if (!freeAutoNoTask && EXECUTION_GATED_TOOLS.has(exec.name)) {
      const auth = mutationAuthority(runtime, agent)
      if (!auth.ok) {
        if (auth.reason.startsWith('MUTATION_AUTHORITY_DENIED:') && st) st.mutationAuthorityDenied = auth.reason
        return auth.reason
      }
      const permission = authorizeExecution(runtime, exec, { task: auth.task, worktree: auth.task.execution.worktree })
      if (!permission.allowed) {
        if (permission.kind === 'approval-required') {
          blockAndCancel(ctx, runtime, agent, 'execution-approval-required', permission.reason)
        }
        return permission.reason
      }
      captureMutationBoundary(runtime, auth, exec)
    }
    return undefined
  })

  ctx.on('tools/result', async (exec, result) => {
    if (exec.name === 'exit_plan_mode'
      && exec.agent
      && !result?.isError
      && typeof exec.arguments?.plan === 'string'
      && exec.arguments.plan.trim()) {
      const planRuntime = runtimeForAgent(exec.agent)
      const planText = exec.arguments.plan.trim()
      try {
        const fsMod = await import('node:fs')
        const pathMod = await import('node:path')
        fsMod.writeFileSync(
          pathMod.join(planRuntime.paths.project, 'PLAN_SINGLE_SPEC.md'),
          `${planText}\n`,
          'utf8',
        )
      } catch (error) {
        ctx.logger?.warn?.(
          'local-dsh-v4-control: failed to persist PLAN_SINGLE_SPEC.md: %o',
          error,
        )
      }
    }
    const agent = exec.agent
    if (!agent) return
    const st = turnStates.get(agent)
    if (st) {
      const key = callKey(exec)
      const semantic = semanticToolFailure(exec, result)
      if (semantic.failed) {
        const prev = st.failures.get(key)
        st.failures.set(key, { count: (prev?.count ?? 0) + 1, error: semantic.text })
      } else {
        st.failures.delete(key)
        st.blockedAttempts.delete(key)
      }
    }

    const roleCtx = freshRoleContexts.get(agent)
    if (roleCtx) {
      accountRoleReadResult(roleCtx, exec, result)
      if (roleCtx.violation) { try { agent.cancel({ kind: 'hook', reason: roleCtx.violation }, { keepInbox: false }) } catch {} }
      return
    }

    let runtime
    try { runtime = runtimeForAgent(agent) } catch (error) {
      if (controlledProjectHint(agent)) {
        const reason = guardFailureReason('tool-result-runtime', error)
        ctx.logger?.error?.(reason); cancelForGuard(agent, reason)
      }
      return
    }
    try {
      await withRuntimeLock(runtime, async () => {
        const { state, task } = current(runtime)
        const owned = task && state.task_state === 'IN_PROGRESS' && state.worker_session_id === agentId(agent)

        if (owned && exec.name !== 'task_checkpoint') {
          markCheckpointProgress(task, { meaningfulIncrement: 1 })
          appendPendingEvidence(task, exec, result)
          saveTask(runtime.paths, task)
        }

        if (!EXECUTION_GATED_TOOLS.has(exec.name)) return
        const before = mutationBefore.get(exec)
        if (!before) return
        mutationBefore.delete(exec)
        clearExecutionPermission(exec)
        if (!task || task.id !== before.taskId || !owned) return

        const donorNow = donorFingerprint(runtime.root)
        const authorityNow = donorProjectAuthorityFingerprint(runtime.paths.project)
        const afterChanged = changedPaths(before.worktree, before.baseline, before.ignoredBaseline)
        const newlyChanged = afterChanged.filter(rel => !before.changedBefore.has(rel))
        recordExecutionSideEffects(task, before, newlyChanged)
        const reserved = reservedChangedPaths(before.worktree, before.baseline, before.ignoredBaseline)
        const donorChanged = donorNow.hash !== before.donor.hash
        const authorityChanged = authorityNow !== before.projectAuthority
        if (reserved.length > 0 || donorChanged || authorityChanged) {
          state.task_state = 'SCOPE_VIOLATION'
          state.worker_session_id = null
          task.execution.scope_violation = {
            at: new Date().toISOString(),
            reserved_worktree_paths: reserved,
            donor_changed_during_execution: donorChanged,
            project_authority_changed_during_execution: authorityChanged,
            note: process.platform === 'win32' ? 'Native Windows shell isolation is DEGRADED/NOT_PROVEN outside workspace.' : 'Execution escaped a hard host boundary.',
          }
          snapshotUsage(agent, task, { closeEpoch: true })
          saveTask(runtime.paths, task)
          saveState(runtime.paths, state)
          recordEvidence(runtime, task.id, 'scope-violation', task.execution.scope_violation)
          blockAndCancel(ctx, runtime, agent, 'scope-violation', 'Execution violated reserved/donor/project-authority boundary')
          return
        }
        saveTask(runtime.paths, task)
      })
    } catch (error) {
      await failClosedTaskGuard(ctx, runtime, agent, 'tool-result-post-check', error)
    }
  })

  ctx.tools.register(makeTool(
    'task_checkpoint',
    'Persist distilled task memory without preserving raw hidden reasoning. mode=merge is the normal incremental path; mode=replace explicitly rewrites the whole checkpoint. A host checkpoint barrier may require this tool before any other work tool.',
    {
      mode: { type: 'string', enum: ['merge','replace'] },
      covered_evidence_ids: { type: 'array', items: { type: 'string' } },
      known: { type: 'array', items: { type: 'string' } }, decisions: { type: 'array', items: { type: 'string' } },
      evidence: { type: 'array', items: { type: 'string' } }, do_not_repeat: { type: 'array', items: { type: 'string' } },
      next_action: { type: 'array', items: { type: 'string' } },
    }, ['mode','covered_evidence_ids'],
    async (args, exec) => {
      const agent = exec.agent
      if (!agent) throw new Error('task_checkpoint requires an agent')
      const runtime = runtimeForAgent(agent)
      return withRuntimeLock(runtime, async () => {
        const auth = activeWorkerAuthority(runtime, agent)
        if (!auth.ok) throw new Error(auth.reason)
        const { state: projectState, task } = auth
        const pending = task.execution?.pending_evidence ?? []
        const validation = checkpointPayloadValidation(args, pending.map(x => x.id))
        if (!validation.ok) throw new Error(validation.reason)
        const previous = readJson(runtime.paths.workingState, emptyWorkingState(task.id))
        const now = new Date().toISOString()
        const value = commitUniversalWorkingState(previous, args, {
          taskId: task.id,
          failedHypotheses: task.execution?.failed_hypotheses ?? [],
          hostOpenAcceptance: task.acceptance ?? [],
          sourceRevision: projectState.source_revision,
          session: agent.session,
          checkpointKind: 'task',
          now,
        })
        atomicWriteJson(runtime.paths.workingState, value)
        resetCheckpointCounters(task, { at: now, sessionId: agentId(agent), seq: agent?.session?.seq ?? null })
        delete task.execution.checkpoint_required_reason
        saveTask(runtime.paths, task)
        return { ok: true, task_id: task.id, mode: args.mode, working_state: runtime.paths.workingState, checkpoint_barrier_cleared: true }
      })
    },
  ))

  ctx.tools.register(makeTool(
    'task_failed_hypothesis',
    'Record one evidence-backed failed hypothesis. The second failure pauses autonomous work by policy.',
    { hypothesis: { type: 'string' }, evidence: { type: 'string' } }, ['hypothesis','evidence'],
    async (args, exec) => {
      const agent = exec.agent
      if (!agent) throw new Error('task_failed_hypothesis requires an agent')
      const runtime = runtimeForAgent(agent)
      return withRuntimeLock(runtime, async () => {
        const auth = activeWorkerAuthority(runtime, agent)
        if (!auth.ok) throw new Error(auth.reason)
        const { state, task } = auth
        task.execution ??= {}; task.execution.failed_hypotheses ??= []
        task.execution.failed_hypotheses.push({ hypothesis: args.hypothesis, evidence: args.evidence, at: new Date().toISOString() })
        const priorWorking = readJson(runtime.paths.workingState, emptyWorkingState(task.id))
        atomicWriteJson(runtime.paths.workingState, commitUniversalWorkingState(priorWorking, { mode: 'merge', no_change: true }, {
          taskId: task.id,
          failedHypotheses: task.execution.failed_hypotheses,
          hostOpenAcceptance: task.acceptance ?? [],
          sourceRevision: state.source_revision,
          session: agent.session,
          checkpointKind: 'host-failed-hypothesis',
          now: new Date().toISOString(),
        }))
        const count = task.execution.failed_hypotheses.length
        const max = activeBudget(task).max_failed_hypotheses
        if (count >= max) {
          state.task_state = 'BUDGET_PAUSED'; state.worker_session_id = null
          snapshotUsage(agent, task, { closeEpoch: true }); saveTask(runtime.paths, task); saveState(runtime.paths, state)
          blockGoal(ctx, agent, 'failed-hypotheses', `Failed hypothesis budget reached: ${count}/${max}`)
          removeWorker(runtime, agent)
          return { ok: true, task_state: state.task_state, failed_hypotheses: count, limit: max }
        }
        saveTask(runtime.paths, task)
        return { ok: true, task_state: state.task_state, failed_hypotheses: count, limit: max }
      })
    },
  ))

  ctx.tools.register(makeTool(
    'task_scope_expansion',
    'Request scope expansion when a nonignored output outside the current publish write_set must persist into the accepted patch.',
    { requested_paths: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' } }, ['requested_paths','reason'],
    async (args, exec) => terminalTaskTool(ctx, exec, 'SCOPE_EXPANSION_REQUIRED', 'scope-expansion', { requested_paths: args.requested_paths, reason: args.reason }),
  ))

  ctx.tools.register(makeTool(
    'task_blocked',
    'Stop the atomic task only for a concrete external, specification, or qualification blocker.',
    { kind: { type: 'string', enum: ['external','spec','qualification'] }, reason: { type: 'string' }, evidence: { type: 'string' } }, ['kind','reason','evidence'],
    async (args, exec) => {
      const state = args.kind === 'external' ? 'BLOCKED_EXTERNAL' : args.kind === 'spec' ? 'BLOCKED_SPEC' : 'BLOCKED_QUALIFICATION'
      return terminalTaskTool(ctx, exec, state, `blocked-${args.kind}`, { reason: args.reason, evidence: args.evidence })
    },
  ))

  ctx.tools.register(makeTool(
    'task_done',
    'Declare implementation complete only when all non-blocked acceptance items have evidence and the canonical production path is implemented. This advances only to TEST_REQUIRED. Mandatory TEST_ANALYST must pass before independent review; never to acceptance or the next phase.',
    { summary: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } } }, ['summary','evidence'],
    async (args, exec) => {
      const agent = exec.agent
      if (!agent) throw new Error('task_done requires an agent')
      const runtime = runtimeForAgent(agent)
      return withRuntimeLock(runtime, async () => {
        const auth = activeWorkerAuthority(runtime, agent)
        if (!auth.ok) throw new Error(auth.reason)
        const { state, task } = auth
        const bad = [
          ...reservedChangedPaths(task.execution.worktree, task.execution.baseline_commit, task.execution.worktree_ignored_baseline ?? {}),
          ...unpublishablePaths(task.execution.worktree, task.execution.baseline_commit, task.write_set ?? [], task.execution.worktree_ignored_baseline ?? {}),
          ...unprovenIgnoredPaths(task.execution.worktree, task.execution.worktree_ignored_baseline ?? {}, task.execution.execution_side_effects ?? []),
        ]
        if (bad.length) throw new Error(`Cannot finish: unpublishable or unproven side effects remain: ${[...new Set(bad)].join(', ')}`)
        await backfillTokenAccounting(runtime, agent, task, resolved.tokenizerEndpoint)
        state.task_state = 'TEST_REQUIRED'; state.worker_session_id = null
        task.execution.done = { at: new Date().toISOString(), summary: args.summary, evidence: args.evidence }
        snapshotUsage(agent, task, { closeEpoch: true })
        saveTask(runtime.paths, task); saveState(runtime.paths, state)
        completeGoal(ctx, agent); removeWorker(runtime, agent)
        return { ok: true, task_id: task.id, task_state: state.task_state }
      })
    },
  ))

  ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (agent?.session?.header?.parentSession || freshRoleContexts.has(agent)) return next()
    try { await applyLosslessHygiene(ctx, agent) }
    catch (error) { ctx.logger?.warn?.(`v4-control lossless hygiene skipped: ${String(error)}`) }
    return next()
  })

  installUniversalCommit(ctx, resolved)
  registerHumanCommands(ctx, resolved)
  registerContextCommands(ctx, resolved)

}

async function terminalTaskTool(ctx, exec, targetState, code, payload) {
  const agent = exec.agent
  if (!agent) throw new Error('task terminal tool requires an agent')
  const runtime = runtimeForAgent(agent)
  return withRuntimeLock(runtime, async () => {
    const auth = activeWorkerAuthority(runtime, agent)
    if (!auth.ok) throw new Error(auth.reason)
    const { state, task } = auth
    state.task_state = targetState; state.worker_session_id = null
    task.execution ??= {}; task.execution.terminal = { state: targetState, code, payload, at: new Date().toISOString() }
    snapshotUsage(agent, task, { closeEpoch: true }); saveTask(runtime.paths, task); saveState(runtime.paths, state)
    blockGoal(ctx, agent, code, payload.reason ?? targetState)
    removeWorker(runtime, agent)
    return { ok: true, task_id: task.id, task_state: targetState }
  })
}

function donorProjectAuthorityFingerprint(projectDir) {
  const include = ['SOURCE_POLICY.md','SOURCE_INDEX.json','SOURCE_CONFLICTS.md','ACTIVE_REQUIREMENTS.json','CURRENT_PHASE.md','PROJECT_INVARIANTS.md','state.json']
  const parts = []
  for (const name of include) {
    const file = path.join(projectDir, name)
    parts.push([name, fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : 'MISSING'])
  }
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

export const _test = { semanticToolFailure, directWriteReason, shellReason }
