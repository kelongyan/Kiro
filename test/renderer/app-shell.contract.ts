import { getInitialPageFromUrl } from '../../src/renderer/src/app/page-url'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function shellFallbackContract(): void {
  const initialPage = getInitialPageFromUrl('?page=proxy', '')
  assert(initialPage === 'proxy', 'page URL parsing should still preserve requested page')

  const fallbackPage = getInitialPageFromUrl('?page=missing-page', '')
  assert(fallbackPage === 'home', 'invalid page ids should still fall back to home')
}

shellFallbackContract()
