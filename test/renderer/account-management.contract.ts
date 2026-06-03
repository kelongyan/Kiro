import {
  ACCOUNT_GRID_CARD_HEIGHT,
  ACCOUNT_LIST_ROW_HEIGHT
} from '../../src/renderer/src/store/account-management-utils'
import {
  maskSensitiveValue,
  summarizeBatchOperationResult
} from '../../src/renderer/src/store/account-management-utils'
import type { BatchOperationResult } from '../../src/renderer/src/types/account'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function masksSensitiveValuesByDefault(): void {
  assert(maskSensitiveValue('') === '-', 'empty secret should render as dash')
  assert(maskSensitiveValue('short') === '*****', 'short secret should be fully masked')
  assert(
    maskSensitiveValue('abcdefghijklmnopqrstuvwxyz') === 'abcd...wxyz',
    'long secret should keep only edges'
  )
  assert(
    maskSensitiveValue('abcdefghijklmnopqrstuvwxyz', true) === 'abcdefghijklmnopqrstuvwxyz',
    'visible secret should be returned as-is'
  )
}

function summarizesBatchFailuresByReason(): void {
  const result: BatchOperationResult = {
    success: 2,
    failed: 4,
    errors: [
      { id: 'a', error: '缺少 RefreshToken' },
      { id: 'b', error: '缺少 RefreshToken' },
      { id: 'c', error: '账号不存在' },
      { id: 'd', error: '后台返回失败，详情见账号状态' }
    ]
  }

  const summary = summarizeBatchOperationResult('刷新完成', result)

  assert(summary.total === 6, 'summary should include total count')
  assert(summary.groups.length === 3, 'summary should group failures by reason')
  assert(
    summary.groups.some((group) => group.error === '缺少 RefreshToken' && group.count === 2),
    'same failure reasons should be counted together'
  )
  assert(
    summary.message.includes('失败分类：缺少 RefreshToken ×2'),
    'message should include grouped failure reasons'
  )
}

function virtualizedAccountViewsKeepStableDimensions(): void {
  assert(ACCOUNT_LIST_ROW_HEIGHT === 72, 'list row height should remain stable for virtualization')
  assert(
    ACCOUNT_GRID_CARD_HEIGHT >= 320,
    'grid card height should be stable for 1000 account lists'
  )
}

masksSensitiveValuesByDefault()
summarizesBatchFailuresByReason()
virtualizedAccountViewsKeepStableDimensions()
