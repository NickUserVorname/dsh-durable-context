import { createRuntime, loadState, loadTask } from './state.js'
import { ensureRuntimeExcluded, gitRoot } from './git.js'
import { hasPendingProjectTransactions } from './project-transaction.js'

const runtimeByRoot = new Map()

export function runtimeForAgent(agent) {
  const cwd = agent?.session?.header?.cwd
  if (!cwd) throw new Error('QWEN-V4 requires a DSH session with an explicit workspace cwd')
  const root = gitRoot(cwd)
  ensureRuntimeExcluded(root)
  let runtime = runtimeByRoot.get(root)
  if (!runtime) { runtime = createRuntime(root); runtimeByRoot.set(root, runtime) }
  return runtime
}

export function current(runtime) {
  if (hasPendingProjectTransactions(runtime.paths.transactions)) {
    throw new Error('PROJECT_TRANSACTION_RECOVERY_REQUIRED: interrupted project commit is pending; enter a host-locked command (for example /status or rerun the requested command) to recover before reading authority state')
  }
  const state = loadState(runtime.paths)
  const task = state.active_task_id ? loadTask(runtime.paths, state.active_task_id) : null
  return { state, task }
}

function goalRef(goal) { return { id: goal.id, revision: goal.revision } }

export function completeGoal(ctx, agent) {
  try { const goal = ctx.goals.get(agent); if (goal && goal.phase !== 'complete') ctx.goals.complete(agent, goalRef(goal)) } catch {}
}

export function blockGoal(ctx, agent, code, message) {
  try { const goal = ctx.goals.get(agent); if (goal?.phase === 'active') ctx.goals.block(agent, goalRef(goal), { code, message }) } catch {}
}

export function removeWorker(runtime, agent) { runtime.activeWorkers.delete(agent) }

export function blockAndCancel(ctx, runtime, agent, code, message) {
  blockGoal(ctx, agent, code, message)
  try { agent.cancel({ kind: 'hook', reason: message }, { keepInbox: false }) } catch {}
  removeWorker(runtime, agent)
}
