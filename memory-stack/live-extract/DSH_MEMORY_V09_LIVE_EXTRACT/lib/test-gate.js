import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

function clip(s, n = 32768) {
  const text = String(s ?? '')
  if (text.length <= n) return text
  return `${text.slice(0, Math.floor(n * 0.75))}\n... [host clipped] ...\n${text.slice(-Math.floor(n * 0.25))}`
}

function runOne(command, cwd, timeoutMs, id) {
  const started = Date.now()
  const win = process.platform === 'win32'
  const exe = win ? 'pwsh' : 'bash'
  const args = win ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-lc', command]
  const res = spawnSync(exe, args, { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 })
  return {
    id,
    command,
    exit_code: typeof res.status === 'number' ? res.status : null,
    signal: res.signal ?? null,
    timed_out: Boolean(res.error && res.error.code === 'ETIMEDOUT'),
    error: res.error ? String(res.error) : null,
    stdout: clip(res.stdout),
    stderr: clip(res.stderr),
    duration_ms: Date.now() - started,
  }
}

export function runConfiguredTests(toolchainFile, worktree, { timeoutMs = 600000 } = {}) {
  const toolchain = readJson(toolchainFile, { commands: {} })
  const groups = ['focused_tests', 'regression_tests']
  const runs = []
  let seq = 0
  for (const group of groups) {
    const commands = Array.isArray(toolchain?.commands?.[group]) ? toolchain.commands[group] : []
    for (const command of commands) {
      if (!String(command).trim()) continue
      seq += 1
      runs.push({ group, ...runOne(String(command), worktree, timeoutMs, `CMD-${String(seq).padStart(3, '0')}`) })
    }
  }
  return {
    schema_version: 2,
    configured: runs.length > 0,
    passed: runs.every(r => r.exit_code === 0 && !r.timed_out && !r.error),
    runs,
    completed_at: new Date().toISOString(),
  }
}

export function boundedPrompt(text, maxChars = 64000) {
  const body = String(text ?? '')
  if (body.length <= maxChars) return body
  const head = Math.floor(maxChars * 0.55)
  const tail = Math.floor(maxChars * 0.40)
  return `${body.slice(0, head)}\n\n... [HOST ROLE INPUT BOUNDED; full artifacts remain readable by tools] ...\n\n${body.slice(-tail)}`
}
