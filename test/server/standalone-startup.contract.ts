import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

const root = await mkdtemp(join(tmpdir(), 'kiro-standalone-startup-'))
const dataDir = join(root, 'data')
const staticDir = join(root, 'renderer')

try {
  await mkdir(staticDir, { recursive: true })
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><div>Kiro UI</div>', 'utf-8')

  const standaloneUrl = pathToFileURL(join(process.cwd(), 'out', 'server', 'standalone.mjs')).href
  const { startStandaloneServer } = await import(standaloneUrl)

  const runtime = await startStandaloneServer({
    port: 0,
    dataDir,
    staticDir,
    openBrowser: false
  })

  try {
    const diagnostics = await fetch(`${runtime.info.baseUrl}/api/diagnostics/overview`, {
      headers: {
        Authorization: `Bearer ${runtime.info.accessToken}`
      }
    })
    assert(diagnostics.ok, 'diagnostics overview should be available after startup')

    const body = (await diagnostics.json()) as {
      ok?: boolean
      checks?: Array<{ id?: string; success?: boolean; detail?: string }>
    }
    const configSync = body.checks?.find((check) => check.id === 'config-sync')
    const localAdmin = body.checks?.find((check) => check.id === 'local-admin')

    assert(body.ok === true, 'diagnostics overview should return ok=true')
    assert(localAdmin?.success === true, 'startup should mark local-admin health as healthy')
    assert(
      configSync?.detail === dataDir,
      'startup health should expose the resolved writable data directory'
    )
  } finally {
    await runtime.close()
  }
} finally {
  await rm(root, { recursive: true, force: true })
}
