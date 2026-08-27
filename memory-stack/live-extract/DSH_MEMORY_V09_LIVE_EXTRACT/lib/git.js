import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { normalizeRel, pathAllowed, stableHash } from './core.js'

function runGit(cwd, args, { input, allowFail = false } = {}) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', input, maxBuffer: 128 * 1024 * 1024 })
  if (r.error) throw r.error
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args.join(' ')} failed (${r.status}): ${(r.stderr || r.stdout || '').trim()}`)
  return r
}

export function gitRoot(cwd) {
  const r = runGit(cwd, ['rev-parse', '--show-toplevel'])
  return path.resolve(r.stdout.trim())
}

export function gitHead(root) { return runGit(root, ['rev-parse', 'HEAD']).stdout.trim() }
function nulList(text) { return String(text ?? '').split('\0').filter(Boolean).map(normalizeRel) }
function excludedRuntimePath(p) { return p === '.dsh' || p.startsWith('.dsh/') || p === '.git' || p.startsWith('.git/') }

export function ensureRuntimeExcluded(root) {
  const gitDir = runGit(root, ['rev-parse', '--git-dir']).stdout.trim()
  const absGitDir = path.isAbsolute(gitDir) ? gitDir : path.join(root, gitDir)
  const info = path.join(absGitDir, 'info')
  fs.mkdirSync(info, { recursive: true })
  const exclude = path.join(info, 'exclude')
  const current = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : ''
  if (!current.split(/\r?\n/).includes('.dsh/runtime/')) {
    fs.appendFileSync(exclude, `${current.endsWith('\n') || current.length === 0 ? '' : '\n'}.dsh/runtime/\n`, 'utf8')
  }
}

export function repoStatus(root) { return runGit(root, ['status', '--porcelain=v1', '--untracked-files=all']).stdout }

function hashFile(abs) {
  try {
    const st = fs.lstatSync(abs)
    if (st.isSymbolicLink()) return `L:${fs.readlinkSync(abs)}`
    if (!st.isFile()) return `O:${st.mode}:${st.size}:${Math.trunc(st.mtimeMs)}`
    const h = crypto.createHash('sha256')
    h.update(fs.readFileSync(abs))
    return `F:${st.mode}:${st.size}:${h.digest('hex')}`
  } catch (error) {
    if (error?.code === 'ENOENT') return 'MISSING'
    throw error
  }
}

const STRICT_IGNORED_PATTERNS = Object.freeze([
  '.env', '.env.*', '**/.env', '**/.env.*',
  '**/*config*.json', '**/*config*.yaml', '**/*config*.yml', '**/*config*.toml',
  '**/*.key', '**/*.pem',
])

function metadataFingerprint(abs, { strict = false, smallContentBytes = 1024 * 1024 } = {}) {
  try {
    const st = fs.lstatSync(abs)
    if (st.isSymbolicLink()) return `L:${fs.readlinkSync(abs)}`
    if (!st.isFile()) return `O:${st.mode}:${st.size}:${Math.trunc(st.mtimeMs)}`
    if (strict || st.size <= smallContentBytes) {
      const h = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex')
      return `F:${st.mode}:${st.size}:sha256:${h}`
    }
    // Bulk ignored files deliberately use metadata-only fingerprints to avoid re-hashing
    // multi-GB caches/models after every shell call. This is a performance mode, not an
    // adversarial content-integrity guarantee; sensitive ignored paths belong in STRICT patterns.
    return `F:${st.mode}:${st.size}:${Math.trunc(st.mtimeMs)}:bulk-metadata`
  } catch (error) {
    if (error?.code === 'ENOENT') return 'MISSING'
    throw error
  }
}

function strictIgnored(rel) { return pathAllowed(rel, STRICT_IGNORED_PATTERNS) }

export function ignoredSnapshot(root, { excludeDsh = false } = {}) {
  const ignored = nulList(runGit(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z']).stdout)
    .filter(p => !excludeDsh || !excludedRuntimePath(p))
    .sort()
  return Object.fromEntries(ignored.map(rel => [rel, metadataFingerprint(path.join(root, rel), { strict: strictIgnored(rel) })]))
}

function diffIgnoredSnapshots(before = {}, after = {}) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort()
  return keys.filter(k => before?.[k] !== after?.[k])
}

/**
 * Donor fingerprint optimized for repeated shell boundaries:
 * - tracked files are represented by HEAD + the current binary diff, rather than hashing every tracked file;
 * - nonignored untracked files are content hashed;
 * - ignored files are included via path/metadata (+ content hash for small files), closing the .env/generated-db hole.
 * This remains conservative and may still be O(number of ignored files) in giant repos, but avoids O(all tracked bytes).
 */
export function donorFingerprint(root) {
  const head = gitHead(root)
  const trackedDiff = runGit(root, ['diff', '--binary', 'HEAD', '--', '.', ':(exclude).dsh/**']).stdout
  const untracked = nulList(runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']).stdout)
    .filter(p => !excludedRuntimePath(p)).sort()
  const untrackedEntries = untracked.map(rel => [rel, hashFile(path.join(root, rel))])
  const ignored = ignoredSnapshot(root, { excludeDsh: true })
  const payload = {
    head,
    tracked_diff_sha256: crypto.createHash('sha256').update(trackedDiff).digest('hex'),
    untracked: untrackedEntries,
    ignored,
  }
  return { hash: stableHash(payload), ...payload }
}

function copyUntracked(root, worktree) {
  const files = nulList(runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']).stdout)
    .filter(p => !excludedRuntimePath(p))
  for (const rel of files) {
    const src = path.join(root, rel)
    const dst = path.join(worktree, rel)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.cpSync(src, dst, { recursive: true, force: true, verbatimSymlinks: true })
  }
}

export function createTaskWorktree(root, worktree, taskId) {
  ensureRuntimeExcluded(root)
  fs.mkdirSync(path.dirname(worktree), { recursive: true })
  if (fs.existsSync(worktree)) throw new Error(`task worktree already exists: ${worktree}`)
  runGit(root, ['worktree', 'add', '--detach', worktree, 'HEAD'])

  const diff = runGit(root, ['diff', '--binary', 'HEAD', '--', '.', ':(exclude).dsh/**']).stdout
  if (diff.length > 0) runGit(worktree, ['apply', '--binary', '--whitespace=nowarn', '-'], { input: diff })
  copyUntracked(root, worktree)
  runGit(worktree, ['add', '-A'])
  runGit(worktree, ['-c', 'user.name=Qwen V4 Harness', '-c', 'user.email=qwen-v4@local.invalid', 'commit', '--allow-empty', '-m', `qwen-v4 baseline ${taskId}`])
  const baseline = gitHead(worktree)
  return {
    worktree,
    baseline_commit: baseline,
    worktree_ignored_baseline: ignoredSnapshot(worktree),
    donor_fingerprint: donorFingerprint(root),
    donor_head: gitHead(root),
  }
}

export function changedPaths(worktree, baseline, ignoredBaseline = {}) {
  const tracked = nulList(runGit(worktree, ['diff', '--name-only', '--no-renames', '-z', baseline, '--']).stdout)
  const untracked = nulList(runGit(worktree, ['ls-files', '--others', '--exclude-standard', '-z']).stdout)
  const ignoredChanged = changedIgnoredPaths(worktree, ignoredBaseline)
  return [...new Set([...tracked, ...untracked, ...ignoredChanged])].sort()
}

export function isIgnoredPath(root, rel) {
  const r = runGit(root, ['check-ignore', '--no-index', '-q', '--', normalizeRel(rel)], { allowFail: true })
  return r.status === 0
}

export function changedIgnoredPaths(worktree, ignoredBaseline = {}) {
  return diffIgnoredSnapshots(ignoredBaseline, ignoredSnapshot(worktree))
}

export function unauthorizedPaths(worktree, baseline, writeSet, ignoredBaseline = {}) {
  return changedPaths(worktree, baseline, ignoredBaseline)
    .filter(rel => excludedRuntimePath(rel) || !pathAllowed(rel, writeSet))
}


export function reservedChangedPaths(worktree, baseline, ignoredBaseline = {}) {
  return changedPaths(worktree, baseline, ignoredBaseline).filter(excludedRuntimePath)
}

export function unpublishablePaths(worktree, baseline, writeSet, ignoredBaseline = {}) {
  return changedPaths(worktree, baseline, ignoredBaseline)
    .filter(rel => !excludedRuntimePath(rel))
    .filter(rel => !isIgnoredPath(worktree, rel))
    .filter(rel => !pathAllowed(rel, writeSet))
}

export function ephemeralIgnoredPaths(worktree, ignoredBaseline = {}) {
  return changedIgnoredPaths(worktree, ignoredBaseline)
    .filter(rel => !excludedRuntimePath(rel))
}

export function unprovenIgnoredPaths(worktree, ignoredBaseline = {}, provenance = []) {
  const proven = new Set((provenance ?? []).filter(x => x?.kind === 'ephemeral_ignored').map(x => normalizeRel(x.path)))
  return ephemeralIgnoredPaths(worktree, ignoredBaseline).filter(rel => !proven.has(rel))
}

export function stageAndPatch(worktree, baseline, ignoredBaseline = {}) {
  // Ignored runtime/test artifacts are deliberately not publishable and Git will
  // not stage them. Publication integrity is enforced by rejecting nonignored
  // changes outside write_set before this function is called.
  runGit(worktree, ['add', '-A'])
  return runGit(worktree, ['diff', '--cached', '--binary', baseline, '--']).stdout
}

export function applyPatchToDonor(root, patch) {
  if (!patch) return
  runGit(root, ['apply', '--binary', '--whitespace=nowarn', '-'], { input: patch })
}

export function removeTaskWorktree(root, worktree) {
  if (!worktree || !fs.existsSync(worktree)) return
  runGit(root, ['worktree', 'remove', '--force', worktree], { allowFail: true })
  try { fs.rmSync(worktree, { recursive: true, force: true }) } catch {}
  runGit(root, ['worktree', 'prune'], { allowFail: true })
}

export function assertDonorUnchanged(root, expected) {
  const current = donorFingerprint(root)
  return { ok: current.hash === expected?.hash, expected: expected?.hash, current: current.hash }
}
