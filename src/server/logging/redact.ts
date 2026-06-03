const REDACTED = '[REDACTED]'

const SENSITIVE_KEYS = new Set([
  'accessToken',
  'refreshToken',
  'clientSecret',
  'apiKey',
  'authorization',
  'bearerToken',
  'token'
])

const TEXT_PATTERNS: Array<[RegExp, string]> = [
  [/\b(Bearer\s+)([A-Za-z0-9._~-]+)/gi, `$1${REDACTED}`],
  [
    /\b(accessToken|refreshToken|clientSecret|apiKey|bearerToken)\s*[:=]\s*["']?([^"'\s,}]+)/gi,
    `$1=${REDACTED}`
  ],
  [
    /"(accessToken|refreshToken|clientSecret|apiKey|bearerToken)"\s*:\s*"([^"]+)"/gi,
    `"$1":"${REDACTED}"`
  ],
  [/\btoken=([A-Za-z0-9._~-]+)/gi, `token=${REDACTED}`]
]

export function maskSecret(
  value: string,
  visibleStart: number = 4,
  visibleEnd: number = 4
): string {
  if (!value) return REDACTED
  if (value.length <= visibleStart + visibleEnd) return REDACTED
  return `${value.slice(0, visibleStart)}...${value.slice(-visibleEnd)}`
}

export function redactSensitiveText(input: string): string {
  return TEXT_PATTERNS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    input
  )
}

export function redactValueForLog<T>(value: T): T {
  if (typeof value === 'string') {
    return redactSensitiveText(value) as T
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValueForLog(item)) as T
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key)) {
        output[key] = REDACTED
        continue
      }
      output[key] = redactValueForLog(item)
    }
    return output as T
  }

  return value
}
