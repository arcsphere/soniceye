# Visualizer — Plan

A personal browser app for making YouTube-ready MP4s:
**background + audio track + stylish audio-reactive visualizer**.

## Use case

Pick a looping video, a static image or a color background. Add a podcast or music
track, optional album cover art, title and logo. Place a reactive waveform or spectrum
below or around the art. Render a finished MP4 to upload.

## Inputs

- **Audio** (required): mp3 / wav / m4a / ogg — music or podcast.
- **Background**: looping video, static image, solid color or gradient.
  Options: blur, darken, slow zoom (Ken Burns).
- **Optional**: cover art, logo / watermark, title + artist text.

## Layers (all optional, set from config)

1. Background
2. Album art card
3. Visualizer — bars (linear / mirrored / circular), waveform (line / filled), particles
4. Title / artist text
5. Progress bar + timer
6. Logo / watermark

## Templates

A JSON file holding layout, styles, colors, fonts, visualizer settings and aspect ratio.
Positions are stored as fractions of the frame (0–1), so one template adapts to every
aspect ratio. For each episode: load the template, swap audio, art and title, render.

## Formats

- 16:9 — 1920×1080 (YouTube)
- 9:16 — 1080×1920 (Shorts)
- 1:1 — 1080×1080 (square)

All at 30 fps.

## Pipeline

1. **Analyze**: decode the audio once into a per-frame feature track (loudness,
   N log-spaced frequency bands, waveform snapshot, beat/onset flag).
2. **Design**: live preview in the web app, driven by the *same* feature track as
   export, so the preview matches the final render.
3. **Render**: deterministic frame-by-frame render → WebCodecs (H.264 + AAC) →
   MP4 muxer → download.

Because preview and export both read precomputed features (not a live `AnalyserNode`),
what you see is what you export.

### Pre-analysis files (for long tracks)

The feature track can be saved and loaded as a `.viz` file: a small JSON header
(fps, bands, duration) plus quantized `Uint8` data. About 7 MB per hour at 64 bands
and 30 fps. This avoids re-decoding long podcasts. It does **not** make encoding
faster; a future Node/FFmpeg CLI can consume the same file for long renders.

## Exports

- **Primary**: burn-in MP4 (H.264 + AAC).
- **Secondary** (later): transparent WebM overlay, green-screen MP4.

## Stack

TypeScript + Vite. The engine (`src/engine/`) is separate from the UI (`src/ui/`) so
it can later be reused as a library or behind a CLI. The prototype draws with Canvas 2D;
WebGL comes in when the shader-based visuals arrive.

## v1 scope

- Tracks of 2–10 minutes are the main target; longer tracks work but render slowly.
- Not in v1: effects on the footage itself (pulse/zoom/color shift on the video),
  native editor plugins, live mic input, custom shaders, 4K, batch rendering, CLI.

## Milestones

1. **Prototype**: load audio + background, bars/waveform/circular/particles,
   text, progress bar, logo, art card, aspect ratios, template save/load, MP4 export.
2. Polish: presets gallery, fonts, beat-driven accents, better particles, `.viz`
   import/export.
3. Overlay exports (transparent WebM, green screen).
4. Node CLI renderer for long podcasts and batch runs.
