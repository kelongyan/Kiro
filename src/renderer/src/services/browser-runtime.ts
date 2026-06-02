export interface ProxySettingsResult {
  success: boolean
  error?: string
  normalizedUrl?: string
}

export function getAppVersion(): Promise<string> {
  return Promise.resolve(import.meta.env.VITE_APP_VERSION || '0.0.0')
}

export function openExternalUrl(url: string, usePrivateMode?: boolean): void {
  void usePrivateMode
  if (!/^https?:\/\//i.test(url)) return
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function normalizeProxyUrl(url: string): string {
  const trimmed = (url || '').trim()
  if (!trimmed) return ''
  if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(trimmed)) return trimmed
  const match = trimmed.match(/^([a-z][a-z0-9+\-.]*):(\/*)(.+)$/i)
  if (match) return `${match[1]}://${match[3]}`
  return `http://${trimmed}`
}

export function setProxySettings(enabled: boolean, url: string): Promise<ProxySettingsResult> {
  return Promise.resolve({
    success: true,
    normalizedUrl: enabled && url ? normalizeProxyUrl(url) : url
  })
}
