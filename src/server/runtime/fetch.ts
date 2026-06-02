import {
  fetch as undiciFetch,
  type Dispatcher,
  type RequestInit as UndiciRequestInit
} from 'undici'

/**
 * serverFetch 依赖注入选项。
 * 通过参数注入代理 agent，使 server 层不硬依赖 K-Proxy 或 Electron。
 */
export interface ServerFetchOptions {
  /** 获取全局网络代理 agent（K-Proxy > 用户设置 > 系统代理） */
  getAgent?: () => Dispatcher | undefined
  /** 账号绑定的代理 URL（优先级最高） */
  overrideProxyUrl?: string
  /** 根据 URL 字符串创建代理 agent */
  createProxyAgent?: (url: string | undefined) => Dispatcher | undefined
}

/**
 * 通用 fetch 封装，支持代理 agent 注入。
 *
 * 优先级：overrideProxyUrl > getAgent() > 直连
 */
export async function serverFetch(
  url: string,
  init: RequestInit,
  opts?: ServerFetchOptions
): Promise<Response> {
  // 1. 账号绑定代理（最高优先级）
  if (opts?.overrideProxyUrl && opts?.createProxyAgent) {
    const agent = opts.createProxyAgent(opts.overrideProxyUrl)
    if (agent) {
      return (await undiciFetch(url, {
        ...init,
        dispatcher: agent
      } as UndiciRequestInit)) as unknown as Response
    }
  }

  // 2. 全局网络代理
  if (opts?.getAgent) {
    const agent = opts.getAgent()
    if (agent) {
      return (await undiciFetch(url, {
        ...init,
        dispatcher: agent
      } as UndiciRequestInit)) as unknown as Response
    }
  }

  // 3. 直连
  return fetch(url, init)
}
