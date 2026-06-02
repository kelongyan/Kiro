import { homedir } from 'os'
import { basename, dirname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import {
  getKiroPaths,
  readKiroSettingsFiles,
  writeKiroSettingsFile,
  type KiroSettingsData
} from '../../../core/kiro-settings/settings-files'

export interface KiroModelSummary {
  id: string
  name: string
  description: string
}

export interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface KiroSettingsServiceDeps {
  homeDir?: () => string
  workspaceDir?: () => string
  openPath?: (path: string) => Promise<void>
  getAvailableModels?: () => Promise<{ models: KiroModelSummary[]; error?: string }>
}

export class KiroSettingsService {
  private homeDir: () => string
  private workspaceDir: () => string
  private openPath?: (path: string) => Promise<void>
  private getAvailableModels?: () => Promise<{ models: KiroModelSummary[]; error?: string }>

  constructor(deps: KiroSettingsServiceDeps = {}) {
    this.homeDir = deps.homeDir || homedir
    this.workspaceDir = deps.workspaceDir || (() => process.cwd())
    this.openPath = deps.openPath
    this.getAvailableModels = deps.getAvailableModels
  }

  readSettings(): Promise<KiroSettingsData> {
    return readKiroSettingsFiles()
  }

  async saveSettings(
    settings: Record<string, unknown>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await writeKiroSettingsFile(settings)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save settings'
      }
    }
  }

  async availableModels(): Promise<{ models: KiroModelSummary[]; error?: string }> {
    if (!this.getAvailableModels) {
      return { models: [] }
    }
    return this.getAvailableModels()
  }

  async openMcpConfig(type: 'user' | 'workspace'): Promise<{ success: boolean; error?: string }> {
    const configPath =
      type === 'user'
        ? this.mcpUserPath
        : join(this.workspaceDir(), '.kiro', 'settings', 'mcp.json')
    this.ensureJsonFile(configPath, { mcpServers: {} }, 2)
    return this.openExistingPath(configPath, 'Failed to open MCP config')
  }

  async openSteeringFolder(): Promise<{ success: boolean; error?: string }> {
    this.ensureDir(this.steeringPath)
    return this.openExistingPath(this.steeringPath, 'Failed to open steering folder')
  }

  async openSettingsFile(): Promise<{ success: boolean; error?: string }> {
    this.ensureJsonFile(
      this.kiroSettingsPath,
      {
        'workbench.colorTheme': 'Kiro Light',
        'kiroAgent.modelSelection': 'claude-haiku-4.5'
      },
      4
    )
    return this.openExistingPath(this.kiroSettingsPath, 'Failed to open settings file')
  }

  async openSteeringFile(filename: string): Promise<{ success: boolean; error?: string }> {
    return this.openExistingPath(this.steeringFilePath(filename), 'Failed to open steering file')
  }

  async createDefaultRules(): Promise<{ success: boolean; error?: string }> {
    try {
      this.ensureDir(this.steeringPath)
      const rulesPath = this.steeringFilePath('rules.md')
      writeFileSync(rulesPath, DEFAULT_RULES_CONTENT, 'utf-8')
      console.log('[KiroSettings] Created default rules.md at:', rulesPath)
      if (this.openPath) {
        await this.openPath(rulesPath)
      }
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create default rules'
      }
    }
  }

  readSteeringFile(filename: string): { success: boolean; content?: string; error?: string } {
    try {
      const filePath = this.steeringFilePath(filename)
      if (!existsSync(filePath)) {
        return { success: false, error: '文件不存在' }
      }
      return { success: true, content: readFileSync(filePath, 'utf-8') }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read file'
      }
    }
  }

  saveSteeringFile(filename: string, content: string): { success: boolean; error?: string } {
    try {
      this.ensureDir(this.steeringPath)
      const filePath = this.steeringFilePath(filename)
      writeFileSync(filePath, content, 'utf-8')
      console.log('[KiroSettings] Saved steering file:', filePath)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save file'
      }
    }
  }

  deleteSteeringFile(filename: string): { success: boolean; error?: string } {
    try {
      const filePath = this.steeringFilePath(filename)
      if (!existsSync(filePath)) {
        return { success: false, error: '文件不存在' }
      }
      unlinkSync(filePath)
      console.log('[KiroSettings] Deleted steering file:', filePath)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete file'
      }
    }
  }

  saveMcpServer(
    name: string,
    config: McpServerConfig,
    oldName?: string
  ): { success: boolean; error?: string } {
    try {
      const mcpConfig = this.readMcpConfig()
      if (oldName && oldName !== name) {
        delete mcpConfig.mcpServers[oldName]
      }
      mcpConfig.mcpServers[name] = config
      this.writeMcpConfig(mcpConfig)
      console.log('[KiroSettings] Saved MCP server:', name)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save MCP server'
      }
    }
  }

  deleteMcpServer(name: string): { success: boolean; error?: string } {
    try {
      if (!existsSync(this.mcpUserPath)) {
        return { success: false, error: '配置文件不存在' }
      }
      const mcpConfig = this.readMcpConfig()
      if (!mcpConfig.mcpServers[name]) {
        return { success: false, error: '服务器不存在' }
      }
      delete mcpConfig.mcpServers[name]
      this.writeMcpConfig(mcpConfig)
      console.log('[KiroSettings] Deleted MCP server:', name)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete MCP server'
      }
    }
  }

  private get kiroSettingsPath(): string {
    return getKiroPaths(this.homeDir()).kiroSettingsPath
  }

  private get steeringPath(): string {
    return getKiroPaths(this.homeDir()).kiroSteeringPath
  }

  private get mcpUserPath(): string {
    return getKiroPaths(this.homeDir()).kiroMcpUserPath
  }

  private steeringFilePath(filename: string): string {
    return join(this.steeringPath, basename(filename))
  }

  private ensureDir(dirPath: string): void {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true })
    }
  }

  private ensureJsonFile(filePath: string, content: unknown, spaces: number): void {
    if (existsSync(filePath)) return
    this.ensureDir(dirname(filePath))
    writeFileSync(filePath, JSON.stringify(content, null, spaces))
  }

  private async openExistingPath(
    path: string,
    fallbackError: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.openPath) {
        return { success: false, error: '当前运行模式不支持打开本地路径' }
      }
      await this.openPath(path)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : fallbackError
      }
    }
  }

  private readMcpConfig(): { mcpServers: Record<string, unknown> } {
    if (!existsSync(this.mcpUserPath)) {
      return { mcpServers: {} }
    }
    return JSON.parse(readFileSync(this.mcpUserPath, 'utf-8')) as {
      mcpServers: Record<string, unknown>
    }
  }

  private writeMcpConfig(mcpConfig: { mcpServers: Record<string, unknown> }): void {
    this.ensureDir(dirname(this.mcpUserPath))
    writeFileSync(this.mcpUserPath, JSON.stringify(mcpConfig, null, 2))
  }
}

const DEFAULT_RULES_CONTENT = `# Role: 高级软件开发助手
一、系统为Windows10
二、调式文件、测试脚本、test相关文件都放在test文件夹里面，md文件放在docs文件夹里面
# 核心原则


## 1. 沟通与协作
- **诚实优先**：在任何情况下都严禁猜测或伪装。当需求不明确、存在技术风险或遇到知识盲区时，必须停止工作，并立即向用户澄清。
- **技术攻坚**：面对技术难题时，首要目标是寻找并提出高质量的解决方案。只有在所有可行方案均被评估后，才能与用户探讨降级或替换方案。
- **批判性思维**：在执行任务时，如果发现当前需求存在技术限制、潜在风险或有更优的实现路径，必须主动向用户提出你的见解和改进建议。
- **语言要求**：思考和回答时总是使用中文进行回复。


## 2. 架构设计
- **模块化设计**：所有设计都必须遵循功能解耦、职责单一的原则。严格遵守SOLID和DRY原则。
- **前瞻性思维**：在设计时必须考虑未来的可扩展性和可维护性，确保解决方案能够融入项目的整体架构。
- **技术债务优先**：在进行重构或优化时，优先处理对系统稳定性和可维护性影响最大的技术债务和基础架构问题。


## 3. 代码与交付物质量标准
### 编写规范
- **架构视角**：始终从整体项目架构出发编写代码，确保代码片段能够无缝集成，而不是孤立的功能。
- **零技术债务**：严禁创建任何形式的技术债务，包括但不限于：临时文件、硬编码值、职责不清的模块或函数。
- **问题暴露**：禁止添加任何用于掩盖或绕过错误的fallback机制。代码应设计为快速失败（Fail-Fast），确保问题在第一时间被发现。


### 质量要求
- **可读性**：使用清晰、有意义的变量名和函数名。代码逻辑必须清晰易懂，并辅以必要的注释。
- **规范遵循**：严格遵循目标编程语言的社区最佳实践和官方编码规范。
- **健壮性**：必须包含充分的错误处理逻辑和边界条件检查。
- **性能意识**：在保证代码质量和可读性的前提下，对性能敏感部分进行合理优化，避免不必要的计算复杂度和资源消耗。


### 交付物规范
- **无文档**：除非用户明确要求，否则不要创建任何Markdown文档或其他形式的说明文档。
- **无测试**：除非用户明确要求，否则不要编写单元测试或集成测试代码。
- **无编译/运行**：禁止编译或执行任何代码。你的任务是生成高质量的代码和设计方案。


# 注意事项
- 除非特别说明否则不要创建新的文档、不要测试、不要编译、不要运行、不需要总结，除非用户主动要求


- 需求不明确时使向用户询问澄清，提供预定义选项
- 在有多个方案的时候，需要向用户询问，而不是自作主张
- 在有方案/策略需要更新时，需要向用户询问，而不是自作主张


- ACE为augmentContextEngine工具的缩写
- 如果要求查看文档请使用 Context7 MCP
- 如果需要进行WEB前端页面测试请使用 Playwright MCP
- 如果用户回复'继续' 则请按照最佳实践继续完成任务
`
