import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const smokeDataDir = process.env.KIRO_ADMIN_DATA_DIR
  ? null
  : mkdtempSync(join(tmpdir(), 'kiro-account-manager-smoke-'))

function cleanupSmokeDataDir() {
  if (smokeDataDir) {
    rmSync(smokeDataDir, { recursive: true, force: true })
  }
}

const child = spawn(process.execPath, ['out/server/standalone.mjs', '--smoke'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    KIRO_ADMIN_PORT: '0',
    KIRO_ADMIN_DATA_DIR: process.env.KIRO_ADMIN_DATA_DIR || smokeDataDir || '',
    KIRO_ADMIN_OPEN_BROWSER: '0'
  }
})

child.on('exit', (code, signal) => {
  cleanupSmokeDataDir()
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exitCode = code ?? 1
})

child.on('error', (error) => {
  cleanupSmokeDataDir()
  console.error('[Smoke] Failed to launch standalone smoke:', error)
  process.exitCode = 1
})
