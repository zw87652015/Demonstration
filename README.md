# ILM Demo Animation

Open `ILM-Demo-zh.html` or `ILM-Demo-en.html` by double-clicking it — no server needed (works from `file://`).
Press F11 for fullscreen; the animation starts after a 0.35 s fade from black. Total run ≈ 70 s, then the outro holds.
The demo is structured as a story: C0 cold open (the finished figure's panels snap together from a scattered state) → S0 Hook (the pain of assembling figures by hand) → S1 Brand (icon + Microsoft Store badge) → A1 drop-in / Auto Layout / labels → A2 scale bar + inset (dropped on the cell's top-right Inset zone, the real GUI flow) → A3a Plot Editor → A3b Reflow on the real canvas (red x-axis guides + offset arrow turn into one teal line) → A4 unified type → A5 AI/MCP, ending on the real History panel → A6 export with a close-up → outro. Every feature scene opens with a struck-through pain → teal solution kicker. Scenes are a duration list in `demo.js` (`scene(id, dur, fn)`), so re-timing one scene never requires editing the later ones.
The app is shown as a floating window (84 %) so captions sit underneath it instead of covering the figure; a translate+scale camera (`zoomTo`) pans smoothly between close-ups.
Append `?loop=1` to the URL to loop. Dev aids: `?t=<sec>` seeks (animations spend their real duration on the virtual clock, so seeks land where playback would be), `&pause=1` freezes, `?speed=2` speeds up.
Everything is plain HTML/CSS/vanilla JS — no network, fonts or libraries are loaded at playback.
Images in `assets/` come from the project website showcase (drone photos, GUI screenshots); `river-detail.jpg` is a crop of `river.JPG` used as the dropped inset; the `.ilmplot.svg` charts and plot-editor data are illustrative.
The animation plays real ILM screenshots from `frames/<lang>/` (captured from a running instance by `capture_live.py`, run it with the `imagelayout` conda env to refresh after UI changes; `hotspots.js` there feeds the cursor/zoom targets, the Inset zone and the before/after x-axis lines). Frames are kept at the physical 2880×1620 so zoomed shots stay sharp; hotspots are in 1920×1080 stage coordinates.
`optimize_assets.py` regenerates the optimized `*.jpg`/`*.webp` assets (needs Pillow).
Frames in `_frames/` are verification screenshots and are not part of the demo.
UI text lives in `strings.js` (zh + en); both pages share `demo.js`/`demo.css`.

Recording: run Edge fullscreen without browser chrome and capture with OBS at 1920×1080, 60 fps — keep the tab in front, the clock pauses while the page is hidden:
`msedge --kiosk "file:///E:/Codes/ImageLayoutManager/Demonstration/ILM-Demo-en.html" --edge-kiosk-type=fullscreen`
