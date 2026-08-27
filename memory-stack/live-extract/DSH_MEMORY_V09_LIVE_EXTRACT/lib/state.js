import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import { DEFAULT_BUDGET } from './core.js'
import { recoverProjectTransactions } from './project-transaction.js'

export const STATE_SCHEMA = 'qwen-v4-project-state-0.7.2'

export function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }) }

export function atomicWriteJson(file, value) {
  ensureDir(path.dirname(file))
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (error) {
    if (error?.code === 'ENOENT') return typeof fallback === 'function' ? fallback() : fallback
    throw error
  }
}

export function initialState() {
  return {
    schema: STATE_SCHEMA,
    source_revision: 0,
    source_conflict_count: 0,
    source_intake_status: 'UNRESOLVED',
    source_intake_mode: 'UNSET',
    source_compatibility_policy: 'NONE',
    current_phase: 'UNSET',
    active_task_id: null,
    task_state: 'NO_TASK',
    worker_session_id: null,
    last_test: null,
    last_review: null,
    last_acceptance: null,
    operation: null,
    budget_defaults: { ...DEFAULT_BUDGET },
    updated_at: new Date().toISOString(),
  }
}

export function projectPaths(root) {
  const project = path.join(root, '.dsh', 'project')
  const runtime = path.join(root, '.dsh', 'runtime')
  return {
    root,
    project,
    state: path.join(project, 'state.json'),
    sourceIndex: path.join(project, 'SOURCE_INDEX.json'),
    sourceIntake: path.join(project, 'SOURCE_INTAKE.md'),
    conflicts: path.join(project, 'SOURCE_CONFLICTS.md'),
    requirements: path.join(project, 'ACTIVE_REQUIREMENTS.json'),
    fullSpec: path.join(project, 'FULL_SPEC.md'),
    toolchain: path.join(project, 'TOOLCHAIN.json'),
    runtimePolicy: path.join(project, 'RUNTIME_POLICY.json'),
    executionPolicy: path.join(project, 'EXECUTION_POLICY.json'),
    workingState: path.join(project, 'WORKING_STATE.json'),
    taskPackets: path.join(project, 'task_packets'),
    evidence: path.join(project, 'evidence'),
    reviews: path.join(project, 'reviews'),
    sourceMaterial: path.join(project, 'source_material'),
    runtime,
    worktrees: path.join(runtime, 'worktrees'),
    triageStaging: path.join(runtime, 'triage-staging'),
    transactions: path.join(runtime, 'transactions'),
    processLock: path.join(runtime, 'project.lock'),
  }
}

export function ensureProject(root) {
  const p = projectPaths(root)
  for (const dir of [p.project,p.taskPackets,p.evidence,p.reviews,p.sourceMaterial,p.runtime,p.worktrees,p.triageStaging,p.transactions]) ensureDir(dir)
  if (!fs.existsSync(p.state)) atomicWriteJson(p.state, initialState())
  if (!fs.existsSync(p.sourceIndex)) atomicWriteJson(p.sourceIndex, { schema_version: 3, status: 'unresolved', revision: 0, generation: 0, conflicts: [], sources: [], intake: { status:'UNRESOLVED', revision:0, mode:'UNSET', primary_source_ids:[], supplementary_source_ids:[], historical_source_ids:[], compatibility_policy:'NONE', unmatched_dirty_policy:'DO_NOT_IMPLEMENT', assistant_transcript_policy:'NON_NORMATIVE_UNLESS_USER_ADOPTED', conflict_policy:'STOP_BEFORE_MUTATION', historical_source_policy:'CONTEXT_COMPATIBILITY_REGRESSION_ONLY', material_unknown_policy:'BLOCK', nonmaterial_unknown_policy:'RECORD_AND_DEFER', user_relationship_instruction:'' } })
  else {
    const idx = readJson(p.sourceIndex, {})
    let dirty = false
    if (Number(idx.schema_version) !== 3) { idx.schema_version = 3; dirty = true }
    if (!Array.isArray(idx.sources)) { idx.sources = []; dirty = true }
    if (!Array.isArray(idx.conflicts)) { idx.conflicts = []; dirty = true }
    if (!Number.isFinite(Number(idx.generation))) { idx.generation = 0; dirty = true }
    if (!idx.intake || typeof idx.intake !== 'object') {
      const state = readJson(p.state, initialState())
      const rev = Number.isFinite(Number(idx.revision)) ? Math.max(0, Math.trunc(Number(idx.revision))) : Math.max(0, Math.trunc(Number(state.source_revision ?? 0)))
      idx.intake = { status:'UNRESOLVED', revision:rev, mode:'UNSET', primary_source_ids:[], supplementary_source_ids:[], historical_source_ids:[], compatibility_policy:'NONE', unmatched_dirty_policy:'DO_NOT_IMPLEMENT', assistant_transcript_policy:'NON_NORMATIVE_UNLESS_USER_ADOPTED', conflict_policy:'STOP_BEFORE_MUTATION', historical_source_policy:'CONTEXT_COMPATIBILITY_REGRESSION_ONLY', material_unknown_policy:'BLOCK', nonmaterial_unknown_policy:'RECORD_AND_DEFER', user_relationship_instruction:'' }
      idx.status = 'unresolved'; idx.revision = rev; dirty = true
    }
    if (dirty) atomicWriteJson(p.sourceIndex, idx)
  }
  if (!fs.existsSync(p.requirements)) atomicWriteJson(p.requirements, { schema_version: 3, requirements: [] })
  const workingDefaults = {
    schema_version: 7, task_id: null, known: [], constraints: [], decisions: [], evidence: [], failed_hypotheses: [], do_not_repeat: [], open_acceptance: [], next_action: [],
    checkpoint_meta: { mode: 'init', updated_at: null, covered_evidence_ids: [], checkpoint_id: null, checkpoint_kind: null, protocol_committed_through_seq: null, prune_safe_through_seq: null, session_revision: null, source_revision: null, state_hash: null }
  }
  if (!fs.existsSync(p.workingState)) atomicWriteJson(p.workingState, workingDefaults)
  else {
    // Additive v0.8 migration. Preserve all prior semantic content and coverage metadata;
    // only fill newly introduced fields/defaults.
    const prior = readJson(p.workingState, workingDefaults)
    const migrated = {
      ...workingDefaults,
      ...prior,
      schema_version: 7,
      constraints: Array.isArray(prior?.constraints) ? prior.constraints : [],
      checkpoint_meta: { ...workingDefaults.checkpoint_meta, ...(prior?.checkpoint_meta ?? {}) },
    }
    if (JSON.stringify(migrated) !== JSON.stringify(prior)) atomicWriteJson(p.workingState, migrated)
  }
  if (!fs.existsSync(p.executionPolicy)) atomicWriteJson(p.executionPolicy, { schema_version: 'qwen-v4-execution-policy-0.7.2', mode: 'ask', rules: [], pending: null, updated_at: null })
  if (!fs.existsSync(p.conflicts)) fs.writeFileSync(p.conflicts, '# Source conflicts\n\nNone recorded.\n', 'utf8')
  if (!fs.existsSync(p.sourceIntake)) fs.writeFileSync(p.sourceIntake, '# Source intake\n\n```yaml\nstatus: UNRESOLVED\nrevision: 0\nmode: UNSET\nprimary_source_ids: []\nsupplementary_source_ids: []\nhistorical_source_ids: []\ncompatibility_policy: NONE\nunmatched_dirty_policy: DO_NOT_IMPLEMENT\nassistant_transcript_policy: NON_NORMATIVE_UNLESS_USER_ADOPTED\nconflict_policy: STOP_BEFORE_MUTATION\nhistorical_source_policy: CONTEXT_COMPATIBILITY_REGRESSION_ONLY\nmaterial_unknown_policy: BLOCK\nnonmaterial_unknown_policy: RECORD_AND_DEFER\nuser_relationship_instruction: ""\n```\n', 'utf8')
  return p
}

export function loadState(paths) {
  const state = readJson(paths.state, initialState)
  return { ...initialState(), ...state, schema: STATE_SCHEMA, budget_defaults: { ...DEFAULT_BUDGET, ...(state?.budget_defaults ?? {}) } }
}

export function saveState(paths, state) {
  atomicWriteJson(paths.state, { ...state, updated_at: new Date().toISOString() })
}

export function taskFile(paths, taskId) { return path.join(paths.taskPackets, `${taskId}.json`) }
export function loadTask(paths, taskId) { return taskId ? readJson(taskFile(paths, taskId), null) : null }
export function saveTask(paths, task) { atomicWriteJson(taskFile(paths, task.id), task) }

export function createRuntime(root) {
  const paths = ensureProject(root)
  return { root, paths, activeWorkers: new Set(), lock: Promise.resolve() }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true }
  catch (error) { return error?.code === 'EPERM' }
}

async function acquireProcessLock(lockDir, { timeoutMs = 120_000, staleMs = 6 * 60 * 60 * 1000 } = {}) {
  const started = Date.now()
  const ownerFile = path.join(lockDir, 'owner.json')
  const owner = { pid: process.pid, hostname: os.hostname(), nonce: crypto.randomUUID(), acquired_at: new Date().toISOString(), acquired_at_ms: Date.now() }
  while (true) {
    try {
      fs.mkdirSync(lockDir)
      atomicWriteJson(ownerFile, owner)
      return owner
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      let existing = null
      try { existing = JSON.parse(fs.readFileSync(ownerFile, 'utf8')) } catch {}
      const age = existing?.acquired_at_ms ? Date.now() - Number(existing.acquired_at_ms) : 0
      const sameHost = existing?.hostname && existing.hostname === os.hostname()
      const definitelyDeadLocal = sameHost && existing?.pid && !pidAlive(Number(existing.pid))
      const leaseExpired = Boolean(existing?.hostname && !sameHost && age > staleMs)
      if (definitelyDeadLocal || leaseExpired || (!existing && Date.now() - started > 2_000)) {
        try { fs.rmSync(lockDir, { recursive: true, force: true }) } catch {}
        continue
      }
      if (Date.now() - started >= timeoutMs) {
        throw new Error(`PROJECT_RUNTIME_LOCK_TIMEOUT: ${lockDir}; owner=${JSON.stringify(existing ?? {})}`)
      }
      await sleep(35 + Math.floor(Math.random() * 40))
    }
  }
}

function releaseProcessLock(lockDir, owner) {
  try {
    const ownerFile = path.join(lockDir, 'owner.json')
    const current = JSON.parse(fs.readFileSync(ownerFile, 'utf8'))
    if (current?.pid !== owner.pid || current?.nonce !== owner.nonce) return
    fs.rmSync(lockDir, { recursive: true, force: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

export async function withRuntimeLock(runtime, fn) {
  // Layer 1: lightweight FIFO inside this Node/DSH process.
  const before = runtime.lock
  let releaseLocal
  runtime.lock = new Promise(resolve => { releaseLocal = resolve })
  await before
  let owner = null
  try {
    // Layer 2: process-shared filesystem lock for separate DSH processes opening the same Git root.
    // mkdir is atomic on supported local filesystems. The lock lives under .dsh/runtime, which is
    // excluded from donor Git state. A stale dead-process lock is reclaimed conservatively.
    owner = await acquireProcessLock(runtime.paths.processLock)
    // Any interrupted multi-file triage commit is recovered while holding the same project-wide
    // process lock, before callers are allowed to observe or mutate project authority state.
    recoverProjectTransactions(runtime.paths)
    return await fn()
  } finally {
    if (owner) releaseProcessLock(runtime.paths.processLock, owner)
    releaseLocal()
  }
}

export const _lockTest = { acquireProcessLock, releaseProcessLock }
