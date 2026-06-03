import { buildProxyClientConfigSnippets } from '../../src/renderer/src/components/proxy/client-config-snippets'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function snippetsIncludeLocalProxyExamples(): void {
  const snippets = buildProxyClientConfigSnippets({
    proxyOrigin: 'http://127.0.0.1:5580',
    apiKey: 'sk-test',
    modelId: 'anthropic.claude-sonnet-4'
  })

  assert(
    snippets.some(
      (snippet) =>
        snippet.id === 'powershell-env' &&
        snippet.command.includes('$env:OPENAI_BASE_URL="http://127.0.0.1:5580/v1"') &&
        snippet.command.includes('$env:ANTHROPIC_BASE_URL="http://127.0.0.1:5580"')
    ),
    'PowerShell environment snippet should include OpenAI and Claude base URLs'
  )

  assert(
    snippets.some(
      (snippet) =>
        snippet.id === 'openai-sdk' &&
        snippet.command.includes('baseURL: "http://127.0.0.1:5580/v1"')
    ),
    'OpenAI SDK snippet should include baseURL'
  )

  assert(
    snippets.some(
      (snippet) =>
        snippet.id === 'claude-compatible' &&
        snippet.command.includes('ANTHROPIC_AUTH_TOKEN') &&
        snippet.command.includes('anthropic.claude-sonnet-4')
    ),
    'Claude-compatible snippet should include auth token and selected model'
  )

  assert(
    snippets.some(
      (snippet) =>
        snippet.id === 'curl' &&
        snippet.command.includes('curl "http://127.0.0.1:5580/v1/chat/completions"') &&
        snippet.command.includes('Authorization: Bearer sk-test')
    ),
    'curl snippet should include local proxy endpoint and API key'
  )
}

snippetsIncludeLocalProxyExamples()
