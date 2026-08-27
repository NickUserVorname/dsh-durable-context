// Extracted memory/compaction entrypoint from the current local-dsh-v4-control live layout.
// Core module bodies in ./lib are preserved byte-for-byte from the FREEZE live-installed
// snapshot; integration behavior below is lifted from the uploaded current live index.js.
//
// IMPORTANT: lib/universal-commit.js intentionally still contains the live
// exec.concludeTurn() behavior. See KNOWN_LIVE_BUGS.md before deploying this standalone.

import { applyLosslessHygiene } from './lib/context-hygiene.js'
import { installUniversalCommit } from './lib/universal-commit.js'
import { registerContextCommands } from './lib/context-commands.js'
import { freshRoleContexts, roleReadGuard, accountRoleReadResult, measureAgentUsage } from './lib/fresh-role.js'
import { roleBudgetExceededPreStep } from './lib/role-control.js'

export const name = 'local-dsh-memory-v09-live-extract'
export const inject = ['tools', 'commands', 'goals', 'subagents', 'sessions', 'agents', 'tokenMeter']

const DEFAULTS = Object.freeze({
  tokenizerEndpoint: 'http://127.0.0.1:8080/tokenize',
  roleProvider: 'llama-local',
  roleModel: 'qwen3.8-27b',
})

export function apply(ctx, config = {}) {
  const resolved = {
    tokenizerEndpoint: String(config.tokenizerEndpoint ?? process.env.QWEN_V4_TOKENIZER_ENDPOINT ?? DEFAULTS.tokenizerEndpoint),
    roleProvider: String(config.roleProvider ?? DEFAULTS.roleProvider),
    roleModel: String(config.roleModel ?? DEFAULTS.roleModel),
  }

  // Fresh CONTEXT_COMPACTOR role budget guard extracted from the current central index.
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const roleCtx = freshRoleContexts.get(agent)
    if (!roleCtx) return next()
    const usage = await measureAgentUsage(agent, roleCtx.tokenizerEndpoint)
    usage.tool_calls = roleCtx.tool_calls
    const exceeded = roleBudgetExceededPreStep(usage, roleCtx.budget)
    if (exceeded || roleCtx.violation) {
      const reason = roleCtx.violation ?? `ROLE_BUDGET_EXCEEDED:${roleCtx.role}:${exceeded}`
      roleCtx.violation = reason
      try { agent.cancel({ kind: 'hook', reason }, { keepInbox: false }) } catch {}
      return { kind: 'reject' }
    }
    return next()
  })

  ctx.tools.guard((exec) => {
    const agent = exec.agent
    if (!agent) return undefined
    const roleCtx = freshRoleContexts.get(agent)
    if (!roleCtx) return undefined
    if (!['read', 'grep', 'glob', 'structured_output'].includes(exec.name)) {
      return `ROLE_TOOL_DENIED: ${roleCtx.role} may only use read/grep/glob/structured_output`
    }
    roleCtx.guard_seen = true
    if (exec.name !== 'structured_output') roleCtx.tool_calls += 1
    if (roleCtx.tool_calls > roleCtx.budget.max_tool_calls) {
      return `ROLE_TOOL_BUDGET_EXCEEDED: ${roleCtx.role} ${roleCtx.tool_calls}/${roleCtx.budget.max_tool_calls}`
    }
    return roleReadGuard(exec, roleCtx)
  })

  ctx.on('tools/result', async (exec, result) => {
    const agent = exec.agent
    if (!agent) return
    const roleCtx = freshRoleContexts.get(agent)
    if (!roleCtx) return
    accountRoleReadResult(roleCtx, exec, result)
    if (roleCtx.violation) {
      try { agent.cancel({ kind: 'hook', reason: roleCtx.violation }, { keepInbox: false }) } catch {}
    }
  })

  // Level A: lossless contiguous identical tool-exchange coalescing.
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (agent?.session?.header?.parentSession || freshRoleContexts.has(agent)) return next()
    try { await applyLosslessHygiene(ctx, agent) }
    catch (error) { ctx.logger?.warn?.(`memory extract: lossless hygiene skipped: ${String(error)}`) }
    return next()
  })

  // Durable investigative state injection + state_checkpoint.
  installUniversalCommit(ctx, resolved)

  // /context and /compress.
  registerContextCommands(ctx, resolved)
}
