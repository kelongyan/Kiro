import { navigationItems, type PageType } from './navigation'

const validPageIds = new Set<PageType>(navigationItems.map((item) => item.id))

function normalizePage(value: string | null | undefined): PageType | null {
  if (!value) return null
  return validPageIds.has(value as PageType) ? (value as PageType) : null
}

function pageFromHash(hash: string): PageType | null {
  const trimmed = hash.replace(/^#/, '').trim()
  if (!trimmed) return null
  const direct = normalizePage(trimmed)
  if (direct) return direct
  const params = new URLSearchParams(trimmed.startsWith('?') ? trimmed.slice(1) : trimmed)
  return normalizePage(params.get('page'))
}

export function getInitialPageFromUrl(search: string, hash: string): PageType {
  const searchPage = normalizePage(new URLSearchParams(search).get('page'))
  if (searchPage) return searchPage
  return pageFromHash(hash) || 'home'
}

export function setPageInUrl(url: string, page: PageType): string {
  const next = new URL(url)
  next.searchParams.set('page', page)
  return next.toString()
}
