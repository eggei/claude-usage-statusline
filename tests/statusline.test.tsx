import { expect, test } from 'claude-code/testing'

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
