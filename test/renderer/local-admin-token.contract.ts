import {
  getLocalAdminAccessToken,
  setLocalAdminAccessToken
} from '../../src/renderer/src/services/local-admin-client'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

class MemoryStorage {
  private data = new Map<string, string>()

  get length(): number {
    return this.data.size
  }

  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) ?? null) : null
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }

  removeItem(key: string): void {
    this.data.delete(key)
  }

  clear(): void {
    this.data.clear()
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null
  }
}

function run(): void {
  const storage = new MemoryStorage()
  const replaceCalls: string[] = []

  ;(globalThis as { window?: Window & typeof globalThis }).window = {
    location: {
      origin: 'http://127.0.0.1:9527',
      search: '?token=demo-token&page=proxy',
      href: 'http://127.0.0.1:9527/?token=demo-token&page=proxy',
      pathname: '/',
      hash: '#proxy'
    } as unknown as Location,
    sessionStorage: storage as unknown as Storage,
    history: {
      length: 1,
      scrollRestoration: 'auto',
      state: null,
      back: () => undefined,
      forward: () => undefined,
      go: () => undefined,
      pushState: () => undefined,
      replaceState: (_state, _title, url) => {
        replaceCalls.push(url)
      }
    } as unknown as History
  } as Window & typeof globalThis

  const token = getLocalAdminAccessToken()
  assert(token === 'demo-token', 'token should be read from URL')
  assert(
    storage.getItem('kiro.localAdmin.accessToken') === 'demo-token',
    'token should be persisted into sessionStorage'
  )
  assert(
    replaceCalls[0] === '/?page=proxy#proxy',
    'token should be removed from URL while preserving other search params and hash'
  )
  ;(globalThis as { window?: Window & typeof globalThis } & { [key: string]: unknown }).window = {
    ...(globalThis as { window?: Window & typeof globalThis }).window,
    location: {
      origin: 'http://127.0.0.1:9527',
      search: '',
      href: 'http://127.0.0.1:9527/',
      pathname: '/',
      hash: ''
    } as unknown as Location
  } as Window & typeof globalThis

  assert(
    getLocalAdminAccessToken() === 'demo-token',
    'subsequent reads should come from sessionStorage once URL token is scrubbed'
  )

  setLocalAdminAccessToken(null)
  assert(
    storage.getItem('kiro.localAdmin.accessToken') === null,
    'explicit clear should remove stored token'
  )
}

run()
