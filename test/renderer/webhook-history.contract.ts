import { createWebhookHistoryEntry } from '../../src/renderer/src/store/webhooks'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function buildsHistoryEntriesForDeliveries(): void {
  const entry = createWebhookHistoryEntry('register-success', '测试通知', {
    success: true,
    delivered: 2,
    skipped: 1
  })

  assert(entry.event === 'register-success', 'history entry should preserve webhook event')
  assert(entry.title === '测试通知', 'history entry should preserve title')
  assert(entry.delivered === 2, 'history entry should preserve delivered count')
  assert(entry.skipped === 1, 'history entry should preserve skipped count')
  assert(typeof entry.createdAt === 'number', 'history entry should contain timestamp')
}

buildsHistoryEntriesForDeliveries()
