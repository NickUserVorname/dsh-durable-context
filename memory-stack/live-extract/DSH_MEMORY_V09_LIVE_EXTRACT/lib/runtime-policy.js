import fs from 'node:fs'
import { DEFAULT_BUDGET, clampBudget } from './core.js'

export const RUNTIME_POLICY_SCHEMA = 'qwen-v4-runtime-policy-0.8.0'

export const DEFAULT_ROLE_BUDGETS = Object.freeze({
  SOURCE_CURATOR: Object.freeze({ max_model_requests: 6, max_reasoning_tokens: 16000, max_visible_output_tokens: 6000, max_tool_calls: 20, max_active_execution_minutes: 10, max_read_result_bytes: 65536, max_input_chars: 64000, max_tokens_per_request: 8192 }),
  TASK_PLANNER: Object.freeze({ max_model_requests: 6, max_reasoning_tokens: 20000, max_visible_output_tokens: 6000, max_tool_calls: 20, max_active_execution_minutes: 10, max_read_result_bytes: 65536, max_input_chars: 64000, max_tokens_per_request: 8192 }),
  TEST_ANALYST: Object.freeze({ max_model_requests: 8, max_reasoning_tokens: 12000, max_visible_output_tokens: 5000, max_tool_calls: 32, max_active_execution_minutes: 10, max_read_result_bytes: 131072, max_input_chars: 48000, max_tokens_per_request: 8192 }),
  REVIEWER: Object.freeze({ max_model_requests: 8, max_reasoning_tokens: 12000, max_visible_output_tokens: 5000, max_tool_calls: 32, max_active_execution_minutes: 10, max_read_result_bytes: 196608, max_input_chars: 48000, max_tokens_per_request: 8192 }),
  ACCEPTANCE_AUDITOR: Object.freeze({ max_model_requests: 6, max_reasoning_tokens: 8000, max_visible_output_tokens: 3000, max_tool_calls: 16, max_active_execution_minutes: 5, max_read_result_bytes: 196608, max_input_chars: 32000, max_tokens_per_request: 6144 }),
  CONTEXT_COMPACTOR: Object.freeze({ max_model_requests: 4, max_reasoning_tokens: 12000, max_visible_output_tokens: 5000, max_tool_calls: 8, max_active_execution_minutes: 10, max_read_result_bytes: 16384, max_input_chars: 96000, max_tokens_per_request: 8192 }),
})

export const DEFAULT_VALIDATION_RESERVE = Object.freeze({
  max_model_requests: 11,
  max_reasoning_tokens: 32000,
  max_visible_output_tokens: 13000,
  max_tool_calls: 38,
  max_active_execution_minutes: 25,
})

export const DEFAULT_INVESTIGATIVE_STATE = Object.freeze({
  snapshot_max_chars: 12000,
})

// Legacy v0.7 `universal_commit` input is accepted only so an existing
// project can be upgraded without first hand-editing its policy. v0.8 drops
// those fields from the normalized runtime policy: they cannot reactivate the
// removed commit-before-answer/finalizer path.
const LEGACY_UNIVERSAL_FIELDS = ['checkpoint_recovery_attempts','response_basis_max_chars','finalization_max_tokens','finalization_reasoning_effort']

export const DEFAULT_CONTEXT_PRESSURE = Object.freeze({
  context_window: 131072,
  completion_reserve_tokens: 16384,
  compression_recovery_reserve_tokens: 8192,
  safety_margin_tokens: 4096,
  soft_headroom_tokens: 24576,
  hard_headroom_tokens: 4096,
  hysteresis_tokens: 4096,
  min_recent_turns: 3,
  max_recent_tokens: 24000,
})

export const DEFAULT_RUNTIME_POLICY = Object.freeze({
  schema_version: RUNTIME_POLICY_SCHEMA,
  task_budget_defaults: Object.freeze({ ...DEFAULT_BUDGET }),
  validation_reserve: DEFAULT_VALIDATION_RESERVE,
  roles: DEFAULT_ROLE_BUDGETS,
  investigative_state: DEFAULT_INVESTIGATIVE_STATE,
  context_pressure: DEFAULT_CONTEXT_PRESSURE,
})

const GLOBAL_FIELDS = ['max_model_requests','max_reasoning_tokens','max_visible_output_tokens','max_tool_calls','max_active_execution_minutes','max_failed_hypotheses']
const RESERVE_FIELDS = ['max_model_requests','max_reasoning_tokens','max_visible_output_tokens','max_tool_calls','max_active_execution_minutes']
const ROLE_FIELDS = [...RESERVE_FIELDS,'max_read_result_bytes','max_input_chars','max_tokens_per_request']
const INVESTIGATIVE_FIELDS = ['snapshot_max_chars']
const CONTEXT_FIELDS = ['context_window','completion_reserve_tokens','compression_recovery_reserve_tokens','safety_margin_tokens','soft_headroom_tokens','hard_headroom_tokens','hysteresis_tokens','min_recent_turns','max_recent_tokens']

function rejectUnknownKeys(raw, allowed, prefix) {
  if (raw === undefined || raw === null) return
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`RUNTIME_POLICY ${prefix} must be an object`)
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) throw new Error(`RUNTIME_POLICY_UNKNOWN_FIELD: ${prefix}.${key}`)
}

function validatePolicyShape(raw = {}) {
  rejectUnknownKeys(raw, ['schema_version','task_budget_defaults','validation_reserve','roles','investigative_state','universal_commit','context_pressure'], 'root')
  rejectUnknownKeys(raw.task_budget_defaults, GLOBAL_FIELDS, 'task_budget_defaults')
  rejectUnknownKeys(raw.validation_reserve, RESERVE_FIELDS, 'validation_reserve')
  rejectUnknownKeys(raw.investigative_state, INVESTIGATIVE_FIELDS, 'investigative_state')
  rejectUnknownKeys(raw.universal_commit, LEGACY_UNIVERSAL_FIELDS, 'universal_commit')
  rejectUnknownKeys(raw.context_pressure, CONTEXT_FIELDS, 'context_pressure')
  if (raw.roles !== undefined && raw.roles !== null) {
    rejectUnknownKeys(raw.roles, Object.keys(DEFAULT_ROLE_BUDGETS), 'roles')
    for (const role of Object.keys(raw.roles)) rejectUnknownKeys(raw.roles[role], ROLE_FIELDS, `roles.${role}`)
  }
}

function positive(value, field) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`RUNTIME_POLICY ${field} must be positive`)
  return n
}

function nonnegative(value, field) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) throw new Error(`RUNTIME_POLICY ${field} must be nonnegative`)
  return n
}

function boundedObject(raw, defaults, fields, prefix, { ceiling = true } = {}) {
  const out = { ...defaults }
  for (const field of fields) {
    if (raw?.[field] === undefined || raw?.[field] === null) continue
    const n = positive(raw[field], `${prefix}.${field}`)
    out[field] = ceiling && Number.isFinite(defaults?.[field]) ? Math.min(n, Number(defaults[field])) : n
  }
  return out
}

function normalizeInvestigative(raw = {}) {
  const out = { ...DEFAULT_INVESTIGATIVE_STATE }
  if (raw?.snapshot_max_chars !== undefined) out.snapshot_max_chars = positive(raw.snapshot_max_chars, 'investigative_state.snapshot_max_chars')
  return out
}

function normalizeContext(raw = {}) {
  const out = { ...DEFAULT_CONTEXT_PRESSURE }
  for (const field of CONTEXT_FIELDS) {
    if (raw?.[field] === undefined) continue
    out[field] = field === 'hysteresis_tokens' ? nonnegative(raw[field], `context_pressure.${field}`) : positive(raw[field], `context_pressure.${field}`)
  }
  if (out.hard_headroom_tokens >= out.soft_headroom_tokens) throw new Error('RUNTIME_POLICY context_pressure.hard_headroom_tokens must be less than soft_headroom_tokens')
  const reserved = out.completion_reserve_tokens + out.compression_recovery_reserve_tokens + out.safety_margin_tokens
  if (reserved >= out.context_window) throw new Error('RUNTIME_POLICY context_pressure reserves must be smaller than context_window')
  return out
}

export function normalizeRuntimePolicy(raw = {}) {
  validatePolicyShape(raw)
  const taskBudget = clampBudget(raw?.task_budget_defaults ?? {}, DEFAULT_BUDGET)
  // Accept the legacy validation_reserve object for upgrade compatibility, but
  // never trust it as the runtime guarantee. The effective full reserve is
  // derived from the actual role caps below, and remaining reserve is derived
  // again from workflow state by validationReserveFor().
  if (raw?.validation_reserve !== undefined) boundedObject(raw.validation_reserve, DEFAULT_VALIDATION_RESERVE, RESERVE_FIELDS, 'validation_reserve')
  const roles = {}
  for (const [role, defaults] of Object.entries(DEFAULT_ROLE_BUDGETS)) roles[role] = boundedObject(raw?.roles?.[role], defaults, ROLE_FIELDS, `roles.${role}`)
  const reserve = ['TEST_ANALYST','REVIEWER','ACCEPTANCE_AUDITOR'].reduce((acc, role) => addReserve(acc, roles[role]), {
    max_model_requests: 0, max_reasoning_tokens: 0, max_visible_output_tokens: 0, max_tool_calls: 0, max_active_execution_minutes: 0,
  })
  return {
    schema_version: RUNTIME_POLICY_SCHEMA,
    task_budget_defaults: taskBudget,
    validation_reserve: reserve,
    roles,
    investigative_state: normalizeInvestigative(raw?.investigative_state),
    context_pressure: normalizeContext(raw?.context_pressure),
  }
}

export function loadRuntimePolicy(runtime) {
  const file = runtime?.paths?.runtimePolicy
  if (!file) return normalizeRuntimePolicy()
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return normalizeRuntimePolicy(raw)
  } catch (error) {
    if (error?.code === 'ENOENT') return normalizeRuntimePolicy()
    throw new Error(`RUNTIME_POLICY_INVALID: ${file}: ${String(error?.message ?? error)}`)
  }
}

export function roleBudgetFor(runtime, role) { return loadRuntimePolicy(runtime).roles[role] ?? loadRuntimePolicy(runtime).roles.REVIEWER }
const VALIDATION_CHAIN = Object.freeze(['TEST_ANALYST','REVIEWER','ACCEPTANCE_AUDITOR'])

function addReserve(a, b) {
  return {
    max_model_requests: Number(a.max_model_requests ?? 0) + Number(b.max_model_requests ?? 0),
    max_reasoning_tokens: Number(a.max_reasoning_tokens ?? 0) + Number(b.max_reasoning_tokens ?? 0),
    max_visible_output_tokens: Number(a.max_visible_output_tokens ?? 0) + Number(b.max_visible_output_tokens ?? 0),
    max_tool_calls: Number(a.max_tool_calls ?? 0) + Number(b.max_tool_calls ?? 0),
    max_active_execution_minutes: Number(a.max_active_execution_minutes ?? 0) + Number(b.max_active_execution_minutes ?? 0),
  }
}

export function remainingValidationRoles(taskState = 'IN_PROGRESS') {
  if (['REVIEW_REQUIRED','REVIEWING'].includes(taskState)) return ['REVIEWER','ACCEPTANCE_AUDITOR']
  if (['ACCEPTANCE_REQUIRED','ACCEPTING'].includes(taskState)) return ['ACCEPTANCE_AUDITOR']
  if (taskState === 'ACCEPTED') return []
  return [...VALIDATION_CHAIN]
}

export function validationReserveFor(runtime, taskState = 'IN_PROGRESS') {
  const policy = loadRuntimePolicy(runtime)
  return remainingValidationRoles(taskState).reduce((acc, role) => addReserve(acc, policy.roles[role] ?? {}), {
    max_model_requests: 0, max_reasoning_tokens: 0, max_visible_output_tokens: 0, max_tool_calls: 0, max_active_execution_minutes: 0,
  })
}
export function taskBudgetDefaultsFor(runtime) { return loadRuntimePolicy(runtime).task_budget_defaults }

export function validateBudgetEnvelope(globalBudget, reserve) {
  const checks = [
    ['max_model_requests', 1], ['max_reasoning_tokens', 1], ['max_visible_output_tokens', 1],
    ['max_tool_calls', 1], ['max_active_execution_minutes', 1],
  ]
  const failures = []
  for (const [field, workerFloor] of checks) {
    const total = Number(globalBudget?.[field] ?? 0)
    const held = Number(reserve?.[field] ?? 0)
    if (total < held + workerFloor) failures.push(`${field}=${total} requires > validation_reserve ${held}`)
  }
  if (failures.length) throw new Error(`TASK_BUDGET_TOO_SMALL_FOR_MANDATORY_VALIDATION: ${failures.join('; ')}`)
  return true
}
