import type { BatchOperationResult } from '../types/account'

export const ACCOUNT_LIST_ROW_HEIGHT = 72
export const ACCOUNT_GRID_CARD_HEIGHT = 340

export interface BatchFailureGroup {
  error: string
  count: number
  ids: string[]
}

export interface BatchOperationSummary {
  total: number
  success: number
  failed: number
  groups: BatchFailureGroup[]
  message: string
}

export function maskSensitiveValue(value: string | undefined, visible: boolean = false): string {
  if (!value) return '-'
  if (visible) return value
  if (value.length <= 8) return '*'.repeat(value.length)
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

export function summarizeBatchOperationResult(
  label: string,
  result: BatchOperationResult
): BatchOperationSummary {
  const grouped = new Map<string, BatchFailureGroup>()

  for (const item of result.errors) {
    if (item.id === 'skipped') continue
    const current = grouped.get(item.error) ?? { error: item.error, count: 0, ids: [] }
    current.count += 1
    current.ids.push(item.id)
    grouped.set(item.error, current)
  }

  const groups = Array.from(grouped.values())
  const total = result.success + result.failed
  const failureText =
    groups.length > 0
      ? `\n失败分类：${groups
          .slice(0, 5)
          .map((group) => `${group.error} ×${group.count}`)
          .join('；')}${groups.length > 5 ? `；另有 ${groups.length - 5} 类` : ''}`
      : ''

  return {
    total,
    success: result.success,
    failed: result.failed,
    groups,
    message: `${label}：总数 ${total}，成功 ${result.success}，失败 ${result.failed}${failureText}`
  }
}
