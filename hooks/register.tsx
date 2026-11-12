import { atom, read, update } from 'claude-code'
import type { CommandRunInput, CommandRunResult, EngineInterface, Register, SessionRateLimit, Settings } from 'claude-code'

import type { Limit, Usage } from '../types'

// xterm-256 colors from the original statusline-command.sh, as hex.
const WHITE = 'whiteBright' // ESC[97m
const FAINT = '#585858' // 240
const GRAY = '#8a8a8a' // 245
const EMPTY = '#444444' // 238
const ORANGE = '#ffaf00' // 214
const YELLOW = '#ffff00' // 226
const RED = '#ff0000' // 196

const EFFORT: Record<string, { glyph: string; color: string }> = {
  low: { glyph: 'Ⓛ', color: '#00ffff' }, // 51
  medium: { glyph: 'Ⓜ', color: '#00ff00' }, // 46
  high: { glyph: 'Ⓗ', color: ORANGE }, // 214
  xhigh: { glyph: 'Ⓧ', color: RED }, // 196
  max: { glyph: 'ⓂⓍ', color: '#ff00ff' }, // 201
}

const usage = atom({ plugin: 'usage-statusline', key: 'usage' } as const, {
  model: 'Unknown model',
  limits: [],
  compactPercent: 100,
} as Usage)
const now = atom({ plugin: 'usage-statusline', key: 'now' } as const, 0)

// "Opus 5.5 (1M context)" -> "O5.5"; "claude-opus-5-5[1m]" -> "O5.5"
const shortModel = (name: string): string => {
  const id = name.match(/^claude-([a-z])[a-z]*-(\d+)-(\d+)/i)
  if (id) return `${(id[1] ?? "").toUpperCase()}${id[2]}.${id[3]}`
  return name.replace(/ *\(.*\)/, '').replace(/^([A-Za-z])[A-Za-z]* (\d)/, '$1$2')
}

const limitsOf = (rateLimits: SessionRateLimit[]): Limit[] =>
  rateLimits.map(l => ({
    kind: l.kind,
    percentUsed: l.percentUsed,
    resetsAt: l.resetsAt ? Date.parse(l.resetsAt) : undefined,
  }))

const gitInfo = async ($: EngineInterface) => {
  const cwd = await $.session.cwd()
  try {
    const [b, t] = await Promise.all([
      $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs: 3000 }),
      $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd, timeoutMs: 3000 }),
    ])
    const top = t.exitCode === 0 ? t.stdout.trim() : ''
    return {
      branch: b.exitCode === 0 ? b.stdout.trim() || undefined : undefined,
      worktree: top ? top.split('/').pop() : undefined,
    }
  } catch {
    return { branch: undefined, worktree: undefined }
  }
}

// Time until a timestamp in its largest unit: "Xd" / "Xh" / "Xm"
const countdown = (resetsAt: number, at: number): string => {
  const diff = Math.floor((resetsAt - at) / 1000)
  if (diff >= 86400) return `${Math.floor(diff / 86400)}d`
  if (diff >= 3600) return `${Math.floor(diff / 3600)}h`
  if (diff > 0) return `${Math.floor(diff / 60)}m`
  return '0m'
}

// The effort the settings give the model: its `modelSettings` entry, else the top-level `effortLevel`.
const settingsEffort = (settings: Settings, model: string): string | undefined => {
  const perModel = settings.modelSettings
  if (perModel && typeof perModel === 'object') {
    const short = shortModel(model)
    for (const [id, entry] of Object.entries(perModel as Record<string, unknown>)) {
      if (id !== model && shortModel(id) !== short) continue
      const level = entry && typeof entry === 'object' ? (entry as { effortLevel?: unknown }).effortLevel : undefined
      if (typeof level === 'string') return level
    }
  }
  return typeof settings.effortLevel === 'string' ? settings.effortLevel : undefined
}

// What the session's model and effort last read as; a write happens only when one of them moves.
let seenModel: string | undefined
let seenEffort: string | undefined

const syncModelAndEffort = async ($: EngineInterface) => {
  const [model, settings] = await Promise.all([$.session.model(), $.settings.read()])
  const effort = settingsEffort(settings, model)
  const modelChanged = model !== seenModel
  const effortChanged = effort !== seenEffort
  seenModel = model
  seenEffort = effort
  if (!modelChanged && !effortChanged) return
  const short = shortModel(model)
  await update($, usage, u => ({
    ...u,
    model: modelChanged ? short : u.model,
    effort: effortChanged && effort !== undefined ? effort : u.effort,
  }))
}

const refresh = async ($: EngineInterface) => {
  const [git] = await Promise.all([gitInfo($), syncModelAndEffort($)])
  await update($, usage, u => (u.branch === git.branch && u.worktree === git.worktree ? u : { ...u, ...git }))
}

const syncAfterCommand = async (
  $: EngineInterface,
  e: CommandRunInput,
  next: (e: CommandRunInput) => Promise<CommandRunResult>,
) => {
  const result = await next(e)
  await syncModelAndEffort($)
  return result
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const [stats, compact] = await Promise.all([
      $.session.usage(),
      $.env.get('CLAUDE_AUTOCOMPACT_PCT_OVERRIDE'),
    ])
    await update($, usage, u => ({
      ...u,
      contextPercent: stats.context.percent,
      limits: limitsOf(stats.rateLimits),
      compactPercent: Number(compact) > 0 ? Number(compact) : 100,
    }))
    { const t = await $.clock.now(); await update($, now, () => t) }
    await refresh($)
    // Keep the reset countdowns current between turns.
    $.clock.every(60_000, async () => { const t = await $.clock.now(); await update($, now, () => t) })
    // No event fires when the model picker or /effort changes the session, so poll; a write happens only on a change.
    $.clock.every(1_000, () => syncModelAndEffort($).catch(() => undefined))
    return result
  })

  // /model and /effort with arguments change the session at once; the picker they open without arguments is caught by the poll.
  on('command.run', { command: 'model' }, syncAfterCommand).catch(($, e, next) => next(e))
  on('command.run', { command: 'effort' }, syncAfterCommand).catch(($, e, next) => next(e))

  on('config.set', async ($, e, next) => {
    const result = await next(e)
    if (/model|effort/i.test(e.key)) await syncModelAndEffort($)
    return result
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    await update($, usage, u => ({
      ...u,
      contextPercent: e.context.percent ?? u.contextPercent,
      limits: limitsOf(e.rateLimits),
    }))
    { const t = await $.clock.now(); await update($, now, () => t) }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && typeof e.effort === 'string') {
      const effort = e.effort
      await update($, usage, u => (u.effort === effort ? u : { ...u, effort }))
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const [u, at] = await Promise.all([read($, usage), read($, now)])
    const hint = await next(e)
    const { Box, Text } = $.ui.resolve(e)

    const sep = <Text color={FAINT}> | </Text>

    const percent = (pct: number) =>
      pct >= 90 ? (
        <Text color={RED} bold>{Math.round(pct)}%</Text>
      ) : pct >= 70 ? (
        <Text color={YELLOW}>{Math.round(pct)}%</Text>
      ) : (
        <Text color={FAINT}>{Math.round(pct)}%</Text>
      )

    // 4-box meter: gray, orange above 20%, bold red when the meter is 90%+ full.
    const meter = (fillRaw: number, pct: number) => {
      const fill = Math.trunc(Math.min(100, Math.max(0, fillRaw)))
      let filled = Math.floor((fill * 4 + 50) / 100)
      if (filled === 0 && fill > 0) filled = 1
      const isRed = fill >= 90
      const color = isRed ? RED : pct > 20 ? ORANGE : GRAY
      return (
        <Text>
          <Text color={color} bold={isRed}>{'▰'.repeat(filled)}</Text>
          <Text color={EMPTY}>{'▱'.repeat(4 - filled)}</Text>{' '}
          <Text color={color} bold={isRed}>{Math.round(pct)}%</Text>
        </Text>
      )
    }

    const effort = u.effort ? EFFORT[u.effort] : undefined
    const used = u.contextPercent ?? 0
    const five = u.limits.find(l => l.kind === 'five_hour')
    const week = u.limits.find(l => l.kind === 'seven_day')
    const limit = (l: Limit | undefined) =>
      l && l.resetsAt !== undefined ? (
        <Text>
          {sep}
          {percent(l.percentUsed)}
          <Text color={FAINT}> {countdown(l.resetsAt, at || Date.now())}</Text>
        </Text>
      ) : null

    const line = (
      <Text>
        <Text color={WHITE} bold>{u.model}</Text>
        {effort ? (
          <Text>
            {' '}
            <Text color={effort.color}>{effort.glyph}</Text>
          </Text>
        ) : u.effort ? (
          <Text> {u.effort}</Text>
        ) : null}
        {sep}
        {meter((used * 100) / u.compactPercent, used)}
        {limit(five)}
        {limit(week)}
        {u.worktree ? (
          <Text color={FAINT}>
            {' | '}
            {u.worktree}
            {u.branch ? ` ⎇  ${u.branch}` : ''}
          </Text>
        ) : null}
      </Text>
    )

    return (
      <Box flexDirection="column">
        {line}
        {hint}
      </Box>
    )
  })
}
