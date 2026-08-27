import { atomicWriteJson, readJson, withRuntimeLock } from './state.js'
import { emptyWorkingState } from './working-state.js'
import { runtimeForAgent, current } from './host-runtime.js'
import { loadRuntimePolicy } from './runtime-policy.js'
import {
  commitUniversalWorkingState, hasDurableWorkingState, investigativeStateInstruction,
  renderUniversalStateSnapshot, validateUniversalCheckpoint,
} from './context-memory.js'
import {
  PRESSURE, hardPressureReason, measureContextPressure, pluginContextMessage, softPressureNotice,
} from './context-pressure.js'
import { freshRoleContexts } from './fresh-role.js'
import { agentId } from './execution-usage.js'

export const universalTurnStates = new WeakMap()
const pressureEpisodes = new WeakMap()

export function compressionOfferActive(agent) {
  const session = agent?.session
  return Boolean(session && pressureEpisodes.get(session)?.offerActive)
}

export function clearCompressionOffer(agent) {
  const session = agent?.session
  if (!session) return
  const old = pressureEpisodes.get(session) ?? { warned: false, offerActive: false }
  pressureEpisodes.set(session, { ...old, offerActive: false })
}

export const PROTOCOL_TOOLS = new Set(['state_checkpoint', 'task_checkpoint'])
export function isProtocolTool(name) { return PROTOCOL_TOOLS.has(name) }

function makeTool(name, description, properties, required, execute) {
  return {
    name, description,
    parameters: { type: 'object', additionalProperties: false, properties, required },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute,
  }
}

function directUserTurn(messages = []) {
  return messages.some(message => message?.source?.kind === 'user')
}

function stateFor(agent, turn) {
  const old = universalTurnStates.get(agent)
  if (old?.turn === turn) return old
  const value = { turn, eligible: false, committed: false }
  universalTurnStates.set(agent, value)
  return value
}

function enterMessages(decision, extra) {
  if (!extra?.length || decision?.kind !== 'enter') return decision
  return { kind: 'enter', messages: [...extra, ...(decision.messages ?? [])] }
}

function pressureWarning(agent, result) {
  const session = agent?.session
  if (!session) return null
  const cfg = result.config ?? {}
  const old = pressureEpisodes.get(session) ?? { warned: false, offerActive: false }
  if (result.pressure === PRESSURE.NORMAL && Number(result.safeHeadroom) > Number(cfg.soft_headroom_tokens ?? 0) + Number(cfg.hysteresis_tokens ?? 0)) {
    pressureEpisodes.set(session, { warned: false, offerActive: false })
    return null
  }
  if (result.pressure === PRESSURE.SOFT && !old.warned) {
    pressureEpisodes.set(session, { warned: true, offerActive: true })
    return softPressureNotice(result)
  }
  return null
}

function uniq(values = []) {
  return [...new Set((values ?? []).map(v => String(v).trim()).filter(Boolean))]
}

function hostFields(previous, task, args) {
  if (task) {
    return {
      failedHypotheses: task.execution?.failed_hypotheses ?? previous?.failed_hypotheses ?? [],
      hostOpenAcceptance: task.acceptance ?? previous?.open_acceptance ?? [],
    }
  }
  return {
    failedHypotheses: uniq([...(previous?.failed_hypotheses ?? []), ...(args?.failed_hypotheses ?? [])]),
    hostOpenAcceptance: args?.open_acceptance === undefined
      ? (previous?.open_acceptance ?? [])
      : uniq(args.open_acceptance),
  }
}

function mutationAuthorityNotice(projectState) {
  if (projectState?.task_state !== 'NO_TASK') return null
  return 'MUTATION: NO_TASK. Do not mutate the workspace. Ordinary prose/composition requests are answered in chat unless the user explicitly requests project-file mutation through the controlled workflow.'
}

/**
 * v0.8: this keeps the historical export name to minimize integration churn, but
 * no longer installs a universal commit-before-answer/finalizer lifecycle.
 */
export function installUniversalCommit(ctx, resolved = {}) {
  ctx.tools.register(makeTool(
    'state_checkpoint',
    'Optional investigative-state sidecar. Use only when the current iterative problem-solving turn established material transferable state. Put the normal user-facing answer in the same assistant response; a successful checkpoint concludes the turn without a second model request.',
    {
      mode: { type: 'string', enum: ['merge', 'replace'] },
      known: { type: 'array', items: { type: 'string' } },
      constraints: { type: 'array', items: { type: 'string' } },
      decisions: { type: 'array', items: { type: 'string' } },
      evidence: { type: 'array', items: { type: 'string' } },
      failed_hypotheses: { type: 'array', items: { type: 'string' } },
      do_not_repeat: { type: 'array', items: { type: 'string' } },
      open_acceptance: { type: 'array', items: { type: 'string' } },
      next_action: { type: 'array', items: { type: 'string' } },
    }, [],
    async (args, exec) => {
      const agent = exec.agent
      if (!agent) throw new Error('state_checkpoint requires an agent')
      if (freshRoleContexts.has(agent) || agent?.session?.header?.parentSession) throw new Error('STATE_CHECKPOINT_DENIED_IN_FRESH_ROLE')
      const turnState = universalTurnStates.get(agent)
      if (!turnState?.eligible) throw new Error('STATE_CHECKPOINT_NOT_AVAILABLE: this is not an eligible top-level user turn')
      if (turnState.committed) throw new Error('STATE_CHECKPOINT_ALREADY_COMMITTED')
      const validation = validateUniversalCheckpoint(args)
      if (!validation.ok) throw new Error(validation.reason)
      const runtime = runtimeForAgent(agent)
      const result = await withRuntimeLock(runtime, async () => {
        const { state: projectState, task } = current(runtime)
        if (task && projectState.task_state === 'IN_PROGRESS') {
          if (projectState.worker_session_id === agentId(agent)) throw new Error('STATE_CHECKPOINT_TASK_ACTIVE_USE_TASK_CHECKPOINT')
          throw new Error(`STATE_CHECKPOINT_DENIED_DURING_ACTIVE_TASK: owner=${projectState.worker_session_id ?? 'unknown'}`)
        }
        const previous = readJson(runtime.paths.workingState, emptyWorkingState(task?.id ?? null))
        const host = hostFields(previous, task, args)
        const value = commitUniversalWorkingState(previous, args, {
          taskId: task?.id ?? previous?.task_id ?? null,
          ...host,
          sourceRevision: projectState.source_revision,
          session: agent.session,
          checkpointKind: 'investigative-state',
        })
        atomicWriteJson(runtime.paths.workingState, value)
        turnState.committed = true
        return {
          ok: true,
          checkpoint_id: value.checkpoint_meta.checkpoint_id,
          observed_surface_through_seq: value.checkpoint_meta.protocol_committed_through_seq,
          prune_safe_through_seq: value.checkpoint_meta.prune_safe_through_seq,
          state_hash: value.checkpoint_meta.state_hash,
          concludes_turn: true,
        }
      })
      // DSH treats a successful terminal tool result as closing the current turn;
      // there is no follow-up model request/finalizer.
      if (typeof exec.concludeTurn === 'function') exec.concludeTurn()
      return result
    },
  ))

  // One short work-mode rule is injected on the first step of a direct top-level
  // user turn. MAIN classifies investigative work as part of the inference it was
  // already going to perform; there is no classifier or finalizer subagent.
  ctx.on('agent/pre-step', async ({ agent, messages = [], turn, step, signal }, next) => {
    if (freshRoleContexts.has(agent) || agent?.session?.header?.parentSession) return next()
    if (step !== 1 || !directUserTurn(messages)) return next()
    const t = stateFor(agent, turn)
    let runtime
    try { runtime = runtimeForAgent(agent) } catch { return next() }
    const { state: projectState, task } = current(runtime)
    if (task && projectState.task_state === 'IN_PROGRESS' && projectState.worker_session_id === agentId(agent)) return next()

    const policy = loadRuntimePolicy(runtime)
    const makeExtras = () => {
      const working = readJson(runtime.paths.workingState, emptyWorkingState(task?.id ?? null))
      const instruction = pluginContextMessage(
        investigativeStateInstruction({ mutationAuthority: mutationAuthorityNotice(projectState) }),
        'qwen-v4-work-mode-policy',
      )
      const snapshot = hasDurableWorkingState(working)
        ? pluginContextMessage(renderUniversalStateSnapshot(working, { maxChars: policy.investigative_state.snapshot_max_chars }), 'qwen-v4-investigative-state')
        : null
      return [...(snapshot ? [snapshot] : []), instruction]
    }
    let extras = makeExtras()
    let pressure = measureContextPressure(ctx, agent, runtime, { extraMessages: extras })
    if (pressure.pressure === PRESSURE.HARD) {
      // HARD pressure is one of the two Level-B triggers in v0.8. A single
      // bounded compactor input may cover only one old completed-turn chunk, so
      // allow up to three sequential fail-closed evacuations before rejecting.
      const { evacuateAndCompact } = await import('./context-evacuation.js')
      let lastCompaction = null
      for (let pass = 1; pass <= 3 && pressure.pressure === PRESSURE.HARD; pass += 1) {
        lastCompaction = await evacuateAndCompact(ctx, agent, runtime, signal, resolved, { dryRun: false })
        if (!lastCompaction.ok) {
          const reason = `${hardPressureReason(pressure)}; automatic semantic compaction pass ${pass}/3 failed: ${lastCompaction.reason}`
          try { agent.cancel({ kind: 'hook', reason }, { keepInbox: false }) } catch {}
          return { kind: 'reject' }
        }
        extras = makeExtras()
        pressure = measureContextPressure(ctx, agent, runtime, { extraMessages: extras })
      }
      if (pressure.pressure === PRESSURE.HARD) {
        const reason = `${hardPressureReason(pressure)}; automatic semantic compaction exhausted 3 audited chunks and safe headroom is still HARD`
        try { agent.cancel({ kind: 'hook', reason }, { keepInbox: false }) } catch {}
        return { kind: 'reject' }
      }
    }
    const warning = pressureWarning(agent, pressure)
    t.eligible = true
    t.committed = false
    const decision = await next()
    return enterMessages(decision, [...extras, ...(warning ? [warning] : [])])
  })

  ctx.on('agent/disposed', ({ agent }) => universalTurnStates.delete(agent))
}
