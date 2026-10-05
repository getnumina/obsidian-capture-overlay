# Capture Overlay

A macOS-only Obsidian plugin. One global hotkey (default Cmd+Shift+2) shows a single note in a small always-on-top panel over whatever you are doing, including another app in full screen, and hides it again. The note is the real Obsidian editor, and edits are saved about half a second after you type.

I built it because capturing a thought on my laptop was slower than on my phone. It is published as a worked example of debugging by measurement with an AI coding agent, and it is not a maintained product. The full account is in [docs/case-study.md](docs/case-study.md).

## Result

| What | First version | Now |
|---|---|---|
| Obsidian frozen after each show | median 2,033 ms | median 1.4 ms |
| Key presses lost | 3 to 4 per show | none |
| Shows over an app in full screen | no | yes, with the Dock icon kept |

The freeze was macOS's Share-menu lookup waiting two seconds on a broken Spotlight index. The case study has the method, the dead ends, the evidence, and what is still not fixed.

## Status

Version 0.1.0. It has run on one Mac: Apple Silicon, macOS 26.5, Obsidian 1.13.7 on Electron 39.2.6. It is not in Obsidian's community directory, and I make no promise to maintain it.

## Build and install

There are no dependencies and no build tools beyond Node.

    npm run build     # joins src/pure.js and src/plugin.js into main.js
    npm test

Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/capture-overlay/`, or make that folder a symlink to a clone of this repository. A clone under `~/Desktop`, `~/Documents` or `~/Downloads` will not load, because macOS stops Obsidian reading plugin files there. Turn community plugins on in the vault and enable Capture Overlay. Enable it in one vault only.

The plugin never creates the note. Create it yourself, then set its path in settings.

## Settings

- Capture note: a path inside the vault. The default is `Capture.md`.
- Global hotkey: an Electron accelerator such as `Command+Shift+2`. It must be one key plus Command or Control. A rejected value keeps the previous hotkey.

## What it touches

Read this before installing. All four are undocumented, and any of them could break on an Obsidian update.

- Electron's remote module (`window.electron.remote`), which Obsidian attaches to every window. The plugin uses it for the global shortcut and for screen geometry.
- `electronWindow` on the popout window, for always-on-top, bounds, show and hide.
- `window.open`, wrapped for the one call that opens the popout, to add `type=panel` so the overlay is a macOS panel.
- `ipcRenderer.send`, wrapped to drop Obsidian's Share-menu update. On a Mac whose Spotlight is healthy this filter has a cost and no benefit: File > Share in the vault stops following the active note.

The plugin starts no child processes and makes no network calls. The note is written only through Obsidian's own save, and the plugin adds no content to it.

## Measuring

Create `debug.json` beside `main.js`, for example `{ "variant": "baseline", "arrangement": "windowed" }`. Each hotkey press then appends one line of timings to `latency.jsonl`. `node tools/latency.mjs` prints the median, worst case and noise for each stage. Delete `debug.json` to turn measurement off. It is off by default.

## Known limits

- Under rapid pressing, about one show in eight and one hide in twenty stall for up to half a second.
- File > Share in the host vault's windows does not follow the active note.
- The hotkey does not exist when Obsidian or the host vault window is closed, or when another app holds the chord. The status line in settings says which.
- It is a real Obsidian window, so Cmd-Q quits Obsidian.
- At start-up an overlay restored from the last session is closed and replaced, which may flash.
- Escape may hide the overlay while a suggester is open. I have not checked.
- A freeze loses at most about half a second of typing. A power loss can lose more.

## Licence

MIT. See [LICENSE](LICENSE).
