# ILM Demo Animation

Open `ILM-Demo-zh.html` or `ILM-Demo-en.html` by double-clicking it — no server needed (works from `file://`).
Press F11 for fullscreen; the animation starts automatically after 1 s of black. Total run ≈ 64 s, then the outro holds.
The demo is structured as a story: S0 Hook (the pain of assembling figures by hand) → S1 Brand (icon + Microsoft Store badge) → A1 drop-in / Auto Layout / labels → A2 annotations (scale bar, PiP) → A3 Plot Editor + Reflow → A4 unified type → A5 undo + AI/MCP → A6 export → outro. Each feature scene opens with a struck-through pain → teal solution kicker. Scenes are a duration list in `demo.js` (`scene(id, dur, fn)`), so re-timing one scene never requires editing the later ones.
Append `?loop=1` to the URL to loop (restarts ~6 s after the outro). Dev aids: `?t=<sec>` seeks, `&pause=1` freezes, `?speed=2` speeds up.
Everything is plain HTML/CSS/vanilla JS — no network, fonts or libraries are loaded at playback.
Images in `assets/` come from the project website showcase (drone photos, GUI screenshots); the `.ilmplot.svg` charts and plot-editor data are illustrative.
The animation plays real ILM screenshots from `frames/<lang>/` (captured from a running instance by `capture_live.py`, run it with the `imagelayout` conda env to refresh after UI changes; `hotspots.js` there feeds the cursor/zoom targets).
`optimize_assets.py` regenerates the optimized `*.jpg`/`*.webp` assets (needs Pillow).
Frames in `_frames/` are verification screenshots and are not part of the demo.
UI text lives in `strings.js` (zh + en); both pages share `demo.js`/`demo.css`.
No commits needed — double-click and screen-record.
