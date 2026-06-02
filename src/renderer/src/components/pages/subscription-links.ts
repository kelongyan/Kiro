export interface SubscriptionLink {
  accountId: string
  email: string
  status: 'pending' | 'loading' | 'success' | 'error' | 'expired'
  url?: string
  error?: string
  generatedAt?: number
  validated?: boolean
}

let links: SubscriptionLink[] = []
let notify: ((nextLinks: SubscriptionLink[]) => void) | null = null

export function getSubscriptionLinks(): SubscriptionLink[] {
  return links
}

export function setSubscriptionLinks(nextLinks: SubscriptionLink[]): void {
  links = nextLinks
  notify?.(links)
}

export function subscribeSubscriptionLinks(
  callback: (nextLinks: SubscriptionLink[]) => void
): () => void {
  notify = callback
  return () => {
    if (notify === callback) notify = null
  }
}

export function appendSubscriptionLink(link: SubscriptionLink): void {
  setSubscriptionLinks([...links, link])
}

export function updateSubscriptionLink(accountId: string, update: Partial<SubscriptionLink>): void {
  setSubscriptionLinks(
    links.map((link) => (link.accountId === accountId ? { ...link, ...update } : link))
  )
}
