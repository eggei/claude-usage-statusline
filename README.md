# claude-usage-statusline

A Claude Code mod that shows your model, effort, context window and plan usage in one colored line, right under the prompt input.

![Preview of the status line](assets/preview.svg)

```
O5.5 Ⓗ | ▰▰▱▱ 55% | 41% 2h | 92% 3d | my-project ⎇  main
```

## What each part means

| Segment | Meaning |
| --- | --- |
| `O5.5` | The current model, shortened: Opus 5.5 → `O5.5`, Sonnet 5.5 → `S5.5`, Haiku 5.5 → `H5.5`. |
| `Ⓗ` | Reasoning effort: Ⓛ low (cyan), Ⓜ medium (green), Ⓗ high (orange), Ⓧ xhigh (red), ⓂⓍ max (magenta). Follows `/model`, `/effort` and the model picker within a second; the level a turn actually runs at wins once a request goes out. |
| `▰▰▱▱ 55%` | How full the context window is. The four boxes fill toward the auto-compact point (`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`, or the whole window if unset). Gray, then orange above 20%, then bold red when the meter is 90%+ full. |
| `41% 2h` | 5-hour usage limit: percent used and time until it resets. |
| `92% 3d` | Weekly usage limit: percent used and time until it resets. Either limit turns yellow at 70% and bold red at 90%. |
| `my-project ⎇  main` | The git repository (or worktree) folder and current branch. |

The usage limits only show on a Claude subscription. Claude Code's own hint line (`? for shortcuts`, `esc to interrupt`) stays underneath.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install usage-statusline --marketplace eggei/claude-usage-statusline
```

Answer `y` to add the marketplace, then press Enter to pick the user scope. From a shell instead:

```
claude plugin install usage-statusline --marketplace eggei/claude-usage-statusline
```

In the desktop app, where `/plugin` doesn't run: click + next to the prompt box, then Plugins, Add marketplace with `eggei/claude-usage-statusline`, then Add plugin.

If you also have a `statusLine` command in `settings.json`, remove it to avoid showing two lines.

## Updates

Claude Code doesn't auto-update plugins from third-party marketplaces by default. To get new versions automatically, run `/plugin`, open Marketplaces, select `claude-usage-statusline` and turn on auto-update. Updates then install when Claude Code starts.

To update by hand instead:

```
claude plugin marketplace update claude-usage-statusline
claude plugin update usage-statusline@claude-usage-statusline
```

Restart Claude Code to apply an update.

## License

MIT
