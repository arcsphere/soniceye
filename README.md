# Visualizer

Make YouTube-ready MP4s from a background (image, looping video, color, or blurred
cover art), an audio track, and an audio-reactive visualizer. See [PLAN.md](PLAN.md).

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173 in Chrome or Edge (MP4 export uses WebCodecs).

## Use

1. **Media**: choose an audio file (or **Load demo track**), plus optional background,
   cover art and logo. You can also drag files onto the preview.
2. **Template**: pick a preset and an aspect ratio (16:9, 9:16, 1:1), then adjust layers.
   Templates auto-save in the browser and can be saved and loaded as JSON.
3. **Export MP4**: try "First 10 s" to check the look, then export the full track.

**Save .viz** stores the audio analysis so long tracks don't need to be re-analyzed.

## Layout

```
src/engine/   UI-free core: analysis, renderer, exporter, presets, types
src/ui/       form control helpers
src/main.ts   app wiring: panel, transport, file loading, export
```
