export type ProxyClientConfigSnippetId =
  | 'powershell-env'
  | 'openai-sdk'
  | 'claude-compatible'
  | 'curl'

export interface ProxyClientConfigSnippet {
  id: ProxyClientConfigSnippetId
  title: string
  command: string
}

interface BuildProxyClientConfigSnippetsInput {
  proxyOrigin: string
  apiKey: string
  modelId: string
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function escapeJsonString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function buildProxyClientConfigSnippets({
  proxyOrigin,
  apiKey,
  modelId
}: BuildProxyClientConfigSnippetsInput): ProxyClientConfigSnippet[] {
  const origin = trimTrailingSlash(proxyOrigin || 'http://127.0.0.1:5580')
  const openaiBaseUrl = `${origin}/v1`
  const key = apiKey || 'YOUR_API_KEY'
  const model = modelId || 'anthropic.claude-sonnet-4'
  const escapedModel = escapeJsonString(model)

  return [
    {
      id: 'powershell-env',
      title: 'PowerShell',
      command: [
        `$env:OPENAI_API_KEY="${key}"`,
        `$env:OPENAI_BASE_URL="${openaiBaseUrl}"`,
        `$env:ANTHROPIC_API_KEY="${key}"`,
        `$env:ANTHROPIC_AUTH_TOKEN="${key}"`,
        `$env:ANTHROPIC_BASE_URL="${origin}"`,
        `$env:KIRO_PROXY_MODEL="${model}"`
      ].join('\n')
    },
    {
      id: 'openai-sdk',
      title: 'OpenAI SDK',
      command: [
        'import OpenAI from "openai"',
        '',
        'const client = new OpenAI({',
        `  apiKey: "${key}",`,
        `  baseURL: "${openaiBaseUrl}"`,
        '})',
        '',
        'const response = await client.chat.completions.create({',
        `  model: "${escapedModel}",`,
        '  messages: [{ role: "user", content: "Hello" }]',
        '})'
      ].join('\n')
    },
    {
      id: 'claude-compatible',
      title: 'Claude Compatible',
      command: [
        `$env:ANTHROPIC_AUTH_TOKEN="${key}"`,
        `$env:ANTHROPIC_BASE_URL="${origin}"`,
        `$env:ANTHROPIC_MODEL="${model}"`,
        '',
        `curl "${origin}/v1/messages" ^`,
        `  -H "Authorization: Bearer ${key}" ^`,
        '  -H "anthropic-version: 2023-06-01" ^',
        '  -H "Content-Type: application/json" ^',
        `  -d "{\\"model\\":\\"${escapeJsonString(model)}\\",\\"max_tokens\\":256,\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"Hello\\"}]}"`
      ].join('\n')
    },
    {
      id: 'curl',
      title: 'curl',
      command: [
        `curl "${openaiBaseUrl}/chat/completions" ^`,
        `  -H "Authorization: Bearer ${key}" ^`,
        '  -H "Content-Type: application/json" ^',
        `  -d "{\\"model\\":\\"${escapeJsonString(model)}\\",\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"Hello\\"}]}"`
      ].join('\n')
    }
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function getProxyOriginFromConfig(config: unknown): string {
  if (!isRecord(config)) return 'http://127.0.0.1:5580'
  const hostValue = typeof config.host === 'string' ? config.host : '127.0.0.1'
  const host = hostValue === '0.0.0.0' ? 'localhost' : hostValue
  const port = typeof config.port === 'number' ? config.port : 5580
  const tls = isRecord(config.tls) && config.tls.enabled === true
  return `${tls ? 'https' : 'http'}://${host}:${port}`
}

export function getFirstUsableApiKey(config: unknown): string {
  if (!isRecord(config)) return ''
  if (typeof config.apiKey === 'string' && config.apiKey.trim()) {
    return config.apiKey.trim()
  }
  if (!Array.isArray(config.apiKeys)) return ''
  const apiKey = config.apiKeys.find(
    (item) =>
      isRecord(item) && item.enabled !== false && typeof item.key === 'string' && item.key.trim()
  )
  if (!isRecord(apiKey) || typeof apiKey.key !== 'string') return ''
  return apiKey.key.trim()
}
