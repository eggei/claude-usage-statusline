import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Limit, Usage } from '../types'

// xterm-256 colors from the original statusline-command.sh, as hex.
const WHITE = 'whiteBright' // ESC[97m
const FAINT = '#585858' // 240
const GRAY = '#8a8a8a' // 245
const EMPTY = '#444444' // 238
const ORANGE = '#ffaf00' // 214
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

const refresh = async ($: EngineInterface) => {
  const [model, git] = await Promise.all([$.session.model(), gitInfo($)])
  await update($, usage, u => ({ ...u, model: shortModel(model), ...git }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const [stats, effort, compact] = await Promise.all([
      $.session.usage(),
      $.settings.read({ key: 'effortLevel' }),
      $.env.get('CLAUDE_AUTOCOMPACT_PCT_OVERRIDE'),
    ])
    await update($, usage, u => ({
      ...u,
      effort: u.effort ?? (typeof effort === 'string' ? effort : undefined),
      contextPercent: stats.context.percent,
      limits: limitsOf(stats.rateLimits),
      compactPercent: Number(compact) > 0 ? Number(compact) : 100,
    }))
    { const t = await $.clock.now(); await update($, now, () => t) }
    await refresh($)
    // Keep the reset countdowns current between turns.
    $.clock.every(60_000, async () => { const t = await $.clock.now(); await update($, now, () => t) })
    return result
  })

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
