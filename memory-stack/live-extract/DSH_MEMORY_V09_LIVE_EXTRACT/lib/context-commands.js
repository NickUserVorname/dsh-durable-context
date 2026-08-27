import { runtimeForAgent } from './host-runtime.js'
import { formatContextPressure, measureContextPressure } from './context-pressure.js'
import { evacuateAndCompact } from './context-evacuation.js'
import { clearCompressionOffer } from './universal-commit.js'

function err(error) { return { kind: 'error', text: error instanceof Error ? error.message : String(error) } }
function n(v) { return Number.isFinite(Number(v)) ? Math.round(Number(v)) : 'unknown' }

function compactionText(result, dryRun) {
  if (!result.ok) return `Semantic compaction refused/unavailable: ${result.reason}`
  const candidate = result.candidate ?? {}
  const lines = [
    dryRun ? 'Semantic evacuation dry-run passed.' : 'Context semantically evacuated, audited, and compressed.',
    `Before estimated active surface: ~${n(result.before)} tokens`,
    `${dryRun ? 'Candidate' : 'After'} active surface estimate: ~${n(dryRun ? result.afterEstimate : result.after)} tokens`,
    `Audited prune candidate surface seq: ${result.start ?? candidate.start}..${result.end ?? candidate.end}`,
    `Raw source events remain in append-only session log: ${(result.shadowedSeqs ?? candidate.seqs ?? []).length}`,
    `Recent completed turns retained verbatim: ${(result.retainedRecentTurns ?? candidate.retainedRecentTurns ?? []).length}`,
    `Coverage audit: ${result.audit?.summary ?? 'PASS'}`,
    `Checkpoint: ${result.checkpointId ?? '(created on commit)'}`,
  ]
  return lines.join('\n')
}

export function registerContextCommands(ctx, resolved = {}) {
  ctx.commands.register({
    name: 'context', description: 'show host-measured context pressure and safe headroom without a model call', recordInput: false,
    handler: async ({ agent }) => {
      try {
        const runtime = runtimeForAgent(agent)
        const result = measureContextPressure(ctx, agent, runtime)
        return { kind: 'success', text: formatContextPressure(result) }
      } catch (error) { return err(error) }
    },
  })

  ctx.commands.register({
    name: 'compress', description: 'semantically evacuate old visible/tool history, fail-closed audit coverage, then prune only the audited active-surface prefix; raw log remains intact', input: { hint: '[--dry-run]' }, recordInput: false,
    handler: async ({ agent, rawInput, signal }) => {
      try {
        const raw = String(rawInput ?? '').trim()
        if (raw && raw !== '--dry-run') return { kind: 'error', text: 'Usage: /compress [--dry-run]' }
        const dryRun = raw === '--dry-run'
        const runtime = runtimeForAgent(agent)
        const result = await evacuateAndCompact(ctx, agent, runtime, signal, resolved, { dryRun })
        if (result.ok && !dryRun) clearCompressionOffer(agent)
        return { kind: result.ok ? 'success' : 'error', text: compactionText(result, dryRun) }
      } catch (error) { return err(error) }
    },
  })
}
