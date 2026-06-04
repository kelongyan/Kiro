import { spawn } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function runBuild() {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'npm run build:web' : 'npm'
    const args = process.platform === 'win32' ? [] : ['run', 'build:web']
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    })

    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString()
    })

    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve(output)
        return
      }
      reject(new Error(`build:web failed with exit code ${code}\n${output}`))
    })
  })
}

const output = await runBuild()
const assetsDir = join(process.cwd(), 'out', 'renderer', 'assets')
const assetNames = await readdir(assetsDir)
const jsAssets = []

for (const assetName of assetNames) {
  if (!assetName.endsWith('.js')) continue
  const assetPath = join(assetsDir, assetName)
  const assetStats = await stat(assetPath)
  jsAssets.push({ assetName, size: assetStats.size })
}

assert(
  jsAssets.length > 1,
  `Expected build:web to output multiple JS chunks, found ${jsAssets.length}.\n${output}`
)

const chunkSizeLimitBytes = 500 * 1000
const oversizedAssets = jsAssets.filter((asset) => asset.size > chunkSizeLimitBytes)

assert(
  oversizedAssets.length === 0,
  [
    'Expected build:web to avoid oversized JS chunks.',
    ...oversizedAssets.map((asset) => `${asset.assetName}: ${asset.size} bytes`),
    output
  ].join('\n')
)
