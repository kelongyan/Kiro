import { fetch as undiciFetch, type Dispatcher, type RequestInit as UndiciRequestInit } from 'undici'

export const KIRO_REST_API_ENDPOINTS: Record<string, string> = {
  'us-east-1': 'https://q.us-east-1.amazonaws.com',
  'eu-central-1': 'https://q.eu-central-1.amazonaws.com'
}

export function getRestApiBase(ssoRegion?: string): string {
  if (!ssoRegion) return KIRO_REST_API_ENDPOINTS['us-east-1']
  if (KIRO_REST_API_ENDPOINTS[ssoRegion]) return KIRO_REST_API_ENDPOINTS[ssoRegion]
  if (ssoRegion.startsWith('eu-')) return KIRO_REST_API_ENDPOINTS['eu-central-1']
  return KIRO_REST_API_ENDPOINTS['us-east-1']
}

export function getFallbackRestApiBase(ssoRegion?: string): string {
  const primary = getRestApiBase(ssoRegion)
  return primary === KIRO_REST_API_ENDPOINTS['eu-central-1']
    ? KIRO_REST_API_ENDPOINTS['us-east-1']
    : KIRO_REST_API_ENDPOINTS['eu-central-1']
}

export function normalizeProxyUrl(url: string): string {
  const trimmed = (url || '').trim()
  if (!trimmed) return ''
  if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(trimmed)) return trimmed
  const match = trimmed.match(/^([a-z][a-z0-9+\-.]*):(\/*)(.+)$/i)
  if (match) return `${match[1]}://${match[3]}`
  return `http://${trimmed}`
}

export async function fetchWithAppProxy(
  url: string,
  options: RequestInit,
  overrideProxyUrl: string | undefined,
  getNetworkAgent: () => Dispatcher | undefined,
  safeCreateProxyAgent: (url: string | undefined) => Dispatcher | undefined
): Promise<Response> {
  if (overrideProxyUrl) {
    const accountAgent = safeCreateProxyAgent(overrideProxyUrl)
    if (accountAgent) {
      return await undiciFetch(url, { ...options, dispatcher: accountAgent } as UndiciRequestInit) as unknown as Response
    }
  }

  const agent = getNetworkAgent()
  if (agent) {
    return await undiciFetch(url, { ...options, dispatcher: agent } as UndiciRequestInit) as unknown as Response
  }

  return await fetch(url, options)
}
