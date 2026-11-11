export type Limit = { kind: string; percentUsed: number; resetsAt?: number }

export type Usage = {
  model: string
  effort?: string
  contextPercent?: number
  limits: Limit[]
  worktree?: string
  branch?: string
  compactPercent: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-statusline': { usage: Usage; now: number }
  }
}
