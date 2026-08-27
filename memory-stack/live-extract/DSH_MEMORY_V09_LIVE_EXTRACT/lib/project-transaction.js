import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const TX_SCHEMA = 'qwen-v4-project-transaction-1'
const PHASES = new Set(['PREPARED','COMMITTING','COMMITTED'])

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }) }
function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex') }

function atomicWriteBuffer(file, data) {
  ensureDir(path.dirname(file))
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

function atomicWriteJson(file, value) {
  atomicWriteBuffer(file, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'))
}

function safeRelative(root, target) {
  const absRoot = path.resolve(root)
  const abs = path.resolve(target)
  const rel = path.relative(absRoot, abs)
  if (!rel || rel === '.' || path.isAbsolute(rel) || rel === '..' || rel.startsWith(`..${path.sep}`)) {
    throw new Error(`PROJECT_TRANSACTION_PATH_OUTSIDE_ROOT: ${target}`)
  }
  return rel.split(path.sep).join('/')
}

function targetPath(root, rel) {
  const native = rel.split('/').join(path.sep)
  const abs = path.resolve(root, native)
  safeRelative(root, abs)
  return abs
}

function journalFile(txDir) { return path.join(txDir, 'journal.json') }
function beforeFile(txDir, entry) { return path.join(txDir, entry.before_file) }
function afterFile(txDir, entry) { return path.join(txDir, entry.after_file) }

function readJournal(txDir) {
  const file = journalFile(txDir)
  const journal = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (journal?.schema !== TX_SCHEMA || !PHASES.has(journal.phase) || !Array.isArray(journal.files)) {
    throw new Error(`PROJECT_TRANSACTION_INVALID_JOURNAL: ${file}`)
  }
  return journal
}

function updatePhase(txDir, journal, phase) {
  if (!PHASES.has(phase)) throw new Error(`PROJECT_TRANSACTION_INVALID_PHASE: ${phase}`)
  journal.phase = phase
  journal.updated_at = new Date().toISOString()
  atomicWriteJson(journalFile(txDir), journal)
}

function currentDigest(file) {
  try { return { exists: true, sha256: sha256(fs.readFileSync(file)) } }
  catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, sha256: null }
    throw error
  }
}

function classifyTarget(root, entry) {
  const file = targetPath(root, entry.target)
  const current = currentDigest(file)
  if (current.exists && current.sha256 === entry.after_sha256) return 'AFTER'
  if (entry.before_exists && current.exists && current.sha256 === entry.before_sha256) return 'BEFORE'
  if (!entry.before_exists && !current.exists) return 'BEFORE'
  return 'UNKNOWN'
}

function assertKnownTargets(root, journal) {
  for (const entry of journal.files) {
    const state = classifyTarget(root, entry)
    if (state === 'UNKNOWN') throw new Error(`PROJECT_TRANSACTION_TARGET_DIVERGED: ${entry.target}`)
  }
}

function applyAfterEntry(root, txDir, entry) {
  const staged = fs.readFileSync(afterFile(txDir, entry))
  if (sha256(staged) !== entry.after_sha256) throw new Error(`PROJECT_TRANSACTION_AFTER_CORRUPT: ${entry.target}`)
  atomicWriteBuffer(targetPath(root, entry.target), staged)
}

function applyBeforeEntry(root, txDir, entry) {
  const target = targetPath(root, entry.target)
  if (!entry.before_exists) {
    try { fs.rmSync(target, { force: true }) } catch (error) { if (error?.code !== 'ENOENT') throw error }
    return
  }
  const staged = fs.readFileSync(beforeFile(txDir, entry))
  if (sha256(staged) !== entry.before_sha256) throw new Error(`PROJECT_TRANSACTION_BEFORE_CORRUPT: ${entry.target}`)
  atomicWriteBuffer(target, staged)
}

function verifyAfter(root, journal) {
  for (const entry of journal.files) {
    if (classifyTarget(root, entry) !== 'AFTER') throw new Error(`PROJECT_TRANSACTION_AFTER_VERIFY_FAILED: ${entry.target}`)
  }
}

function verifyBefore(root, journal) {
  for (const entry of journal.files) {
    if (classifyTarget(root, entry) !== 'BEFORE') throw new Error(`PROJECT_TRANSACTION_BEFORE_VERIFY_FAILED: ${entry.target}`)
  }
}

function cleanupPaths(root, journal) {
  for (const rel of journal.cleanup ?? []) {
    const file = targetPath(root, rel)
    try { fs.rmSync(file, { recursive: true, force: true }) } catch (error) { if (error?.code !== 'ENOENT') throw error }
  }
}

function finishTransaction(txDir, root, journal) {
  cleanupPaths(root, journal)
  fs.rmSync(txDir, { recursive: true, force: true })
}

function rollForward(txDir, root, journal) {
  assertKnownTargets(root, journal)
  for (const entry of journal.files) applyAfterEntry(root, txDir, entry)
  verifyAfter(root, journal)
  if (journal.phase !== 'COMMITTED') updatePhase(txDir, journal, 'COMMITTED')
  finishTransaction(txDir, root, journal)
  return { action: 'COMMIT', id: journal.id }
}

function rollBack(txDir, root, journal) {
  assertKnownTargets(root, journal)
  for (const entry of [...journal.files].reverse()) applyBeforeEntry(root, txDir, entry)
  verifyBefore(root, journal)
  // A failed/aborted triage raw input intentionally remains in triage-staging for forensic inspection.
  fs.rmSync(txDir, { recursive: true, force: true })
  return { action: 'ROLLBACK', id: journal.id }
}

function recoverOne(txDir, root) {
  const journal = readJournal(txDir)
  if (journal.phase === 'PREPARED') return rollBack(txDir, root, journal)
  if (journal.phase === 'COMMITTED') return rollForward(txDir, root, journal)
  try {
    return rollForward(txDir, root, journal)
  } catch (forwardError) {
    try {
      const result = rollBack(txDir, root, journal)
      return { ...result, forward_error: String(forwardError?.message ?? forwardError) }
    } catch (rollbackError) {
      throw new Error(`PROJECT_TRANSACTION_RECOVERY_FAILED: ${journal.id}; forward=${String(forwardError?.message ?? forwardError)}; rollback=${String(rollbackError?.message ?? rollbackError)}`)
    }
  }
}

export function listProjectTransactions(transactionsDir) {
  try {
    return fs.readdirSync(transactionsDir, { withFileTypes: true })
      .filter(ent => ent.isDirectory() && ent.name.startsWith('tx-'))
      .map(ent => path.join(transactionsDir, ent.name))
      .sort()
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

export function hasPendingProjectTransactions(transactionsDir) {
  return listProjectTransactions(transactionsDir).length > 0
}

export function recoverProjectTransactions(paths) {
  const results = []
  for (const txDir of listProjectTransactions(paths.transactions)) results.push(recoverOne(txDir, paths.root))
  return results
}

function prepareProjectTransaction(paths, { kind = 'project', id = null, writes = [], cleanup = [] } = {}) {
  if (!Array.isArray(writes) || writes.length === 0) throw new Error('PROJECT_TRANSACTION_EMPTY')
  ensureDir(paths.transactions)
  const txId = id || `tx-${kind}-${Date.now()}-${crypto.randomUUID()}`
  const txDir = path.join(paths.transactions, txId.startsWith('tx-') ? txId : `tx-${txId}`)
  fs.mkdirSync(txDir)
  ensureDir(path.join(txDir, 'before'))
  ensureDir(path.join(txDir, 'after'))

  const seen = new Set()
  const files = writes.map((item, index) => {
    const target = safeRelative(paths.root, item.file)
    if (seen.has(target)) throw new Error(`PROJECT_TRANSACTION_DUPLICATE_TARGET: ${target}`)
    seen.add(target)
    const abs = targetPath(paths.root, target)
    const before = currentDigest(abs)
    const beforeRel = `before/${String(index).padStart(3, '0')}.bin`
    const afterRel = `after/${String(index).padStart(3, '0')}.bin`
    if (before.exists) fs.writeFileSync(path.join(txDir, beforeRel), fs.readFileSync(abs))
    const afterData = Buffer.isBuffer(item.content) ? item.content : Buffer.from(String(item.content ?? ''), item.encoding ?? 'utf8')
    fs.writeFileSync(path.join(txDir, afterRel), afterData)
    return {
      target,
      before_exists: before.exists,
      before_sha256: before.sha256,
      after_sha256: sha256(afterData),
      before_file: beforeRel,
      after_file: afterRel,
    }
  })

  const journal = {
    schema: TX_SCHEMA,
    id: path.basename(txDir),
    kind,
    phase: 'PREPARED',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    files,
    cleanup: [...new Set((cleanup ?? []).map(file => safeRelative(paths.root, file)))],
  }
  atomicWriteJson(journalFile(txDir), journal)
  return { txDir, journal }
}

export function commitProjectTransaction(paths, spec, options = {}) {
  const prepared = prepareProjectTransaction(paths, spec)
  const { txDir, journal } = prepared
  try {
    updatePhase(txDir, journal, 'COMMITTING')
    options.hooks?.afterPhase?.('COMMITTING', { txDir, journal })
    for (let i = 0; i < journal.files.length; i += 1) {
      applyAfterEntry(paths.root, txDir, journal.files[i])
      options.hooks?.afterWrite?.(i + 1, { txDir, journal })
    }
    verifyAfter(paths.root, journal)
    updatePhase(txDir, journal, 'COMMITTED')
    options.hooks?.afterPhase?.('COMMITTED', { txDir, journal })
    finishTransaction(txDir, paths.root, journal)
    return { id: journal.id, recovered: false, action: 'COMMIT' }
  } catch (error) {
    // If the process is still alive, finish/rollback immediately. A hard process crash leaves the
    // journal under .dsh/runtime/transactions; withRuntimeLock() recovers it before the next mutation.
    let recovery
    try { recovery = recoverOne(txDir, paths.root) }
    catch (recoveryError) {
      throw new Error(`PROJECT_TRANSACTION_COMMIT_FAILED: ${journal.id}; error=${String(error?.message ?? error)}; recovery=${String(recoveryError?.message ?? recoveryError)}`)
    }
    if (recovery.action === 'COMMIT') return { id: journal.id, recovered: true, action: 'COMMIT', recovered_from: String(error?.message ?? error) }
    throw new Error(`PROJECT_TRANSACTION_ROLLED_BACK: ${journal.id}; error=${String(error?.message ?? error)}`)
  }
}

export const _transactionTest = {
  prepareProjectTransaction,
  readJournal,
  updatePhase,
  applyAfterEntry,
  recoverOne,
  classifyTarget,
}
