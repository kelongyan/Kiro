import type { ProxyAccount } from '../../../core/proxy'
import {
  fetchAvailableSubscriptions,
  fetchSubscriptionToken,
  setUserPreference
} from '../../../core/proxy/kiroApi'

export interface SubscriptionAccountInput {
  accessToken: string
  region?: string
  profileArn?: string
  machineId?: string
  provider?: string
  authMethod?: string
  accountId?: string
}

export interface SubscriptionServiceDeps {
  openSubscriptionUrl?: (url: string) => Promise<void> | void
}

export class SubscriptionService {
  private deps: SubscriptionServiceDeps

  constructor(deps: SubscriptionServiceDeps = {}) {
    this.deps = deps
  }

  health(): { success: boolean } {
    return { success: true }
  }

  async getSubscriptions(input: SubscriptionAccountInput): Promise<{
    success: boolean
    error?: string
    plans: NonNullable<Awaited<ReturnType<typeof fetchAvailableSubscriptions>>['subscriptionPlans']>
    disclaimer?: string[]
  }> {
    try {
      const account = this.toProxyAccount(input)
      if (!account.accessToken) {
        return { success: false, error: 'Missing accessToken', plans: [] }
      }

      const result = await fetchAvailableSubscriptions(account)
      if (result.subscriptionPlans) {
        return {
          success: true,
          plans: result.subscriptionPlans,
          disclaimer: result.disclaimer
        }
      }
      return { success: false, error: 'No subscription plans returned', plans: [] }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get subscriptions',
        plans: []
      }
    }
  }

  async getSubscriptionUrl(
    input: SubscriptionAccountInput,
    subscriptionType?: string
  ): Promise<{ success: boolean; error?: string; url?: string; status?: string }> {
    try {
      const account = this.toProxyAccount(input)
      if (!account.accessToken) {
        return { success: false, error: 'Missing accessToken' }
      }

      const result = await fetchSubscriptionToken(account, subscriptionType)
      if (result.encodedVerificationUrl) {
        return { success: true, url: result.encodedVerificationUrl, status: result.status }
      }
      return { success: false, error: result.message || 'No subscription URL returned' }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get subscription URL'
      }
    }
  }

  async setOverage(
    input: SubscriptionAccountInput,
    overageStatus: 'ENABLED' | 'DISABLED'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const account = this.toProxyAccount(input)
      if (!account.accessToken) {
        return { success: false, error: 'Missing accessToken' }
      }
      return await setUserPreference(account, overageStatus)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set overage'
      }
    }
  }

  async openSubscriptionWindow(url: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!url) return { success: false, error: 'Missing url' }
      await this.deps.openSubscriptionUrl?.(url)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to open URL'
      }
    }
  }

  private toProxyAccount(input: SubscriptionAccountInput): ProxyAccount {
    return {
      id: input.accountId || 'subscription-request',
      accessToken: input.accessToken,
      region: input.region || 'us-east-1',
      profileArn: input.profileArn,
      machineId: input.machineId,
      provider: input.provider,
      authMethod: input.authMethod
    } as ProxyAccount
  }
}
