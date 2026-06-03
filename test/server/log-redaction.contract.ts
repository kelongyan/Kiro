import { maskSecret, redactSensitiveText, redactValueForLog } from '../../src/server/logging/redact'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function run(): void {
  assert(maskSecret('abcdefghijklmnop').includes('...'), 'maskSecret should keep only edges')

  const text =
    'Authorization: Bearer abcdefghijklmnop accessToken=token-value refreshToken=refresh-value clientSecret=secret-value apiKey=key-value'
  const redacted = redactSensitiveText(text)
  assert(!redacted.includes('token-value'), 'redactor should hide access token values')
  assert(!redacted.includes('refresh-value'), 'redactor should hide refresh token values')
  assert(!redacted.includes('secret-value'), 'redactor should hide client secret values')
  assert(!redacted.includes('key-value'), 'redactor should hide api key values')
  assert(redacted.includes('[REDACTED]'), 'redactor should replace secret payloads')

  const value = redactValueForLog({
    accessToken: 'plain-access-token',
    refreshToken: 'plain-refresh-token',
    clientSecret: 'plain-client-secret',
    nested: {
      authorization: 'Bearer very-secret-bearer-token'
    }
  }) as {
    accessToken?: string
    refreshToken?: string
    clientSecret?: string
    nested?: { authorization?: string }
  }

  assert(value.accessToken === '[REDACTED]', 'object redaction should redact accessToken')
  assert(value.refreshToken === '[REDACTED]', 'object redaction should redact refreshToken')
  assert(value.clientSecret === '[REDACTED]', 'object redaction should redact clientSecret')
  assert(
    value.nested?.authorization?.includes('[REDACTED]'),
    'nested authorization strings should be redacted'
  )
}

run()
