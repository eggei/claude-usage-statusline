import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-11-10T12:00:00Z')

const HINT = {
  plugin: 'usage-statusline',
  component: 'PromptHint',
  surface: 'terminal',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const

test('draws the status line above the engine hint, styled as the script', async ($, on) => {
  on('state.get', (_, e) => {
    if (e.key === 'usage') {
      return {
        value: {
          value: {
            model: 'O5.5',
            effort: 'high',
            contextPercent: 12,
            limits: [
              { kind: 'five_hour', percentUsed: 40, resetsAt: NOW + 2 * 3600_000 + 60_000 },
              { kind: 'seven_day', percentUsed: 95, resetsAt: NOW + 3 * 86400_000 + 60_000 },
            ],
            worktree: 'my-project',
            branch: 'main',
            compactPercent: 25,
          },
          version: 1,
        },
      }
    }
    return { value: { value: NOW, version: 1 } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>? for shortcuts</Text>
  })

  const ui = await $.ui.mount(HINT)
  const line = await ui.find({ type: 'Text', text: /^O5\.5/ })
  expect(line?.text).toBe('O5.5 Ⓗ | ▰▰▱▱ 12% | 40% 2h | 95% 3d | my-project ⎇  main')
  // 12% of a 25% auto-compact threshold fills two boxes; 12% is under 20%, so gray
  expect((await ui.find({ type: 'Text', text: /^▰+$/ }))?.props.color).toBe('#8a8a8a')
  expect((await ui.find({ type: 'Text', text: /^Ⓗ$/ }))?.props.color).toBe('#ffaf00')
  const red = await ui.find({ type: 'Text', text: /^95%$/ })
  expect(red?.props.color).toBe('#ff0000')
  expect(red?.props.bold).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^\? for shortcuts$/ }))?.text).toBe('? for shortcuts')
  await ui.unmount()
})

test('a model or effort change reaches the line without waiting for a turn', async ($, on) => {
  let model = 'Opus 5.5'
  let effortLevel = 'high'
  on('session.model', () => ({ value: model }))
  on('settings.read', () => ({ value: { effortLevel, modelSettings: { 'claude-sonnet-5-5': { effortLevel: 'low' } } } }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { percent: 0, window: 200_000 }, rateLimits: [] } }))
  on('session.cwd', () => ({ value: '/' }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('env.get', () => ({ value: undefined }))
  const clock = mock.clock(on, { now: NOW })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: undefined }))
  on('config.set', (_, e) => ({ value: e.value }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>hint</Text>
  })

  const typed = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  let ui = await $.ui.mount(HINT)
  expect((await ui.find({ type: 'Text', text: /^O5\.5/ }))?.text).toBe('O5.5 Ⓗ | ▱▱▱▱ 0%')
  await ui.unmount()

  // /effort with an argument: the setting has changed by the time the command returns
  effortLevel = 'max'
  await $.command.run({ ...typed, command: 'effort', args: 'max' })
  ui = await $.ui.mount(HINT)
  expect((await ui.find({ type: 'Text', text: /^O5\.5/ }))?.text).toBe('O5.5 ⓂⓍ | ▱▱▱▱ 0%')
  await ui.unmount()

  // /model with an argument: the new model's own effort setting wins over the top-level one
  model = 'Sonnet 5.5'
  await $.command.run({ ...typed, command: 'model', args: 'sonnet' })
  ui = await $.ui.mount(HINT)
  expect((await ui.find({ type: 'Text', text: /^S5\.5/ }))?.text).toBe('S5.5 Ⓛ | ▱▱▱▱ 0%')
  await ui.unmount()

  // The picker leaves no command behind: the poll picks the change up within a second
  model = 'Haiku 5.5'
  await clock.advance(1_000)
  ui = await $.ui.mount(HINT)
  expect((await ui.find({ type: 'Text', text: /^H5\.5/ }))?.text).toBe('H5.5 ⓂⓍ | ▱▱▱▱ 0%')
  await ui.unmount()
})
