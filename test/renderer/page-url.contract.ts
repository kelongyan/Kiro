import { getInitialPageFromUrl, setPageInUrl } from '../../src/renderer/src/app/page-url'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function readsInitialPageFromSearch(): void {
  assert(getInitialPageFromUrl('?token=abc&page=proxy', '') === 'proxy', 'search page should win')
  assert(getInitialPageFromUrl('?page=tasks', '') === 'tasks', 'tasks page should be accepted')
  assert(getInitialPageFromUrl('?page=bad', '') === 'home', 'invalid page should fall back home')
}

function readsInitialPageFromHash(): void {
  assert(getInitialPageFromUrl('?token=abc', '#proxy') === 'proxy', 'hash page should work')
  assert(getInitialPageFromUrl('', '#page=proxyPool') === 'proxyPool', 'hash page= should work')
}

function writesPageWithoutDroppingToken(): void {
  const next = setPageInUrl('http://127.0.0.1:9527/?token=abc', 'proxy')
  assert(next === 'http://127.0.0.1:9527/?token=abc&page=proxy', 'token should remain in URL')
}

readsInitialPageFromSearch()
readsInitialPageFromHash()
writesPageWithoutDroppingToken()
