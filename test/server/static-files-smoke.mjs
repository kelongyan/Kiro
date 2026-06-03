import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function readText(response) {
  return await response.text()
}

const root = await mkdtemp(join(tmpdir(), 'kiro-static-smoke-'))
const dataDir = join(root, 'data')
const staticDir = join(root, 'renderer')

try {
  await mkdir(join(staticDir, 'assets'), { recursive: true })
  await writeFile(
    join(staticDir, 'index.html'),
    '<!doctype html><div id="root">Kiro UI</div>',
    'utf-8'
  )
  await writeFile(join(staticDir, 'assets', 'app.js'), 'console.log("kiro")', 'utf-8')
  await writeFile(join(root, 'secret.txt'), 'secret', 'utf-8')

  const standaloneUrl = pathToFileURL(join(process.cwd(), 'out', 'server', 'standalone.mjs')).href
  const { startStandaloneServer } = await import(standaloneUrl)
  const runtime = await startStandaloneServer({
    port: 0,
    dataDir,
    staticDir,
    openBrowser: false
  })

  try {
    const indexResponse = await fetch(`${runtime.info.baseUrl}/`)
    assert(indexResponse.status === 200, `Expected / to return 200, got ${indexResponse.status}`)
    assert(
      (indexResponse.headers.get('content-type') || '').includes('text/html'),
      'Expected / to return text/html'
    )
    assert((await readText(indexResponse)).includes('Kiro UI'), 'Expected / body to include index')

    const deepLinkResponse = await fetch(`${runtime.info.baseUrl}/accounts/detail`)
    assert(
      deepLinkResponse.status === 200,
      `Expected deep link to return index.html, got ${deepLinkResponse.status}`
    )
    assert(
      (await readText(deepLinkResponse)).includes('Kiro UI'),
      'Expected deep link body to include index'
    )

    const assetResponse = await fetch(`${runtime.info.baseUrl}/assets/app.js`)
    assert(
      assetResponse.status === 200,
      `Expected asset to return 200, got ${assetResponse.status}`
    )
    assert(
      (assetResponse.headers.get('content-type') || '').includes('javascript'),
      'Expected JS asset content-type to include javascript'
    )
    assert((await readText(assetResponse)).includes('console.log'), 'Expected JS asset body')

    const escapedResponse = await fetch(`${runtime.info.baseUrl}/%2e%2e%5Csecret.txt`)
    assert(
      escapedResponse.status === 403,
      `Expected path escape to return 403, got ${escapedResponse.status}`
    )
    assert(
      !(await readText(escapedResponse)).includes('secret'),
      'Expected path escape not to read outside staticDir'
    )

    const apiMissingResponse = await fetch(`${runtime.info.baseUrl}/api/not-found`, {
      headers: { Authorization: `Bearer ${runtime.info.accessToken}` }
    })
    assert(
      apiMissingResponse.status === 404,
      `Expected missing API to remain 404, got ${apiMissingResponse.status}`
    )

    const apiRootResponse = await fetch(`${runtime.info.baseUrl}/api`)
    assert(
      apiRootResponse.status === 401,
      `Expected /api to keep API auth behavior, got ${apiRootResponse.status}`
    )
    assert(
      (apiRootResponse.headers.get('content-type') || '').includes('application/json'),
      'Expected /api to keep JSON response'
    )
  } finally {
    await runtime.close()
  }
} finally {
  await rm(root, { recursive: true, force: true })
}
