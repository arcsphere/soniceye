import './style.css';
import { analyze, parseFeatures, serializeFeatures, type FeatureTrack } from './engine/analysis';
import { decodeAudio, encodeWav, makeDemoArt, synthDemoTrack } from './engine/audio';
import { exportMp4 } from './engine/exporter';
import { PRESETS, defaultVisualizer, normalizeTemplate } from './engine/presets';
import { formatTime, render, type Assets } from './engine/renderer';
import { ASPECTS, type Template, type VizStyle } from './engine/types';
import { button, check, color, download, el, fileButton, range, section, select, text } from './ui/controls';

const STORE_KEY = 'visualizer.template';
const FONTS = ['Montserrat', 'Bebas Neue', 'Playfair Display', 'Space Grotesk', 'Oswald', 'Georgia', 'Courier New'];

function loadSaved(): Template | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? normalizeTemplate(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

const state = {
  tpl: loadSaved() ?? PRESETS[0].build('16:9'),
  assets: {} as Assets,
  audio: null as AudioBuffer | null,
  features: null as FeatureTrack | null,
  /** set when features came from a .viz file, so a matching audio load can skip analysis */
  featuresFromFile: false,
  bgVideo: null as HTMLVideoElement | null,
  names: { audio: '', background: '', art: '', logo: '' },
  exporting: null as AbortController | null,
};

const canvas = document.querySelector<HTMLCanvasElement>('#preview')!;
const ctx = canvas.getContext('2d')!;
const panel = document.querySelector<HTMLElement>('#panel')!;
const stage = document.querySelector<HTMLElement>('#stage')!;
const playBtn = document.querySelector<HTMLButtonElement>('#play')!;
const seekBar = document.querySelector<HTMLInputElement>('#seek')!;
const timeLabel = document.querySelector<HTMLElement>('#time')!;
const statusEl = document.querySelector<HTMLElement>('#status')!;
const emptyHint = document.querySelector<HTMLElement>('#empty')!;

function setStatus(msg: string) {
  statusEl.textContent = msg;
}

// ---- transport -------------------------------------------------------------
// The <audio> element is the clock when audio is loaded; otherwise (a .viz file with
// no audio yet) a manual clock drives the preview.

const audioEl = new Audio();
audioEl.preload = 'auto';
let clock = { start: 0, offset: 0, playing: false };
let dirty = true;

const hasAudio = () => !!audioEl.src;
const duration = () => state.features?.duration ?? 0;

function currentTime(): number {
  if (hasAudio()) return audioEl.currentTime;
  return clock.playing ? clock.offset + (performance.now() - clock.start) / 1000 : clock.offset;
}

function isPlaying(): boolean {
  return hasAudio() ? !audioEl.paused : clock.playing;
}

function play() {
  if (!state.features) return;
  if (currentTime() >= duration() - 0.05) seekTo(0);
  if (hasAudio()) void audioEl.play();
  else clock = { start: performance.now(), offset: clock.offset, playing: true };
  void state.bgVideo?.play();
  playBtn.textContent = '❚❚';
}

function pause() {
  if (hasAudio()) audioEl.pause();
  else clock = { start: 0, offset: currentTime(), playing: false };
  state.bgVideo?.pause();
  playBtn.textContent = '▶';
  dirty = true;
}

function seekTo(t: number) {
  t = Math.max(0, Math.min(duration(), t));
  if (hasAudio()) audioEl.currentTime = t;
  else clock = { ...clock, start: performance.now(), offset: t };
  const v = state.bgVideo;
  if (v?.duration) v.currentTime = t % v.duration;
  dirty = true;
}

audioEl.addEventListener('ended', pause);
playBtn.addEventListener('click', () => (isPlaying() ? pause() : play()));
seekBar.addEventListener('input', () => seekTo((Number(seekBar.value) / 1000) * duration()));
document.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
    e.preventDefault();
    if (isPlaying()) pause();
    else play();
  }
});

function tick() {
  if (!state.exporting && (isPlaying() || dirty)) {
    let t = currentTime();
    if (!hasAudio() && clock.playing && t >= duration()) {
      pause();
      t = duration();
    }
    render(ctx, state.tpl, state.assets, state.features, t);
    const d = duration();
    seekBar.value = String(d ? Math.round((t / d) * 1000) : 0);
    timeLabel.textContent = `${formatTime(t)} / ${formatTime(d)}`;
    dirty = false;
  }
  requestAnimationFrame(tick);
}

// ---- template changes ------------------------------------------------------

let saveTimer = 0;
function onChange() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state.tpl));
    } catch {
      /* storage unavailable; templates can still be saved as files */
    }
  }, 300);
}

function applyAspect() {
  const { width, height } = ASPECTS[state.tpl.aspect];
  canvas.width = width;
  canvas.height = height;
  dirty = true;
}

function setTemplate(t: Template) {
  // keep per-episode text when switching looks
  t.text.title = state.tpl.text.title;
  t.text.artist = state.tpl.text.artist;
  state.tpl = t;
  applyAspect();
  void document.fonts.load(`700 40px "${t.text.font}"`).then(() => (dirty = true));
  buildPanel();
  onChange();
}

// ---- loading media ---------------------------------------------------------

const stripExt = (name: string) => name.replace(/\.[^.]+$/, '');
const isPlaceholderTitle = () => ['Track Title', 'Demo Loop', ''].includes(state.tpl.text.title);

async function runAnalysis(buffer: AudioBuffer) {
  const t0 = performance.now();
  state.features = await analyze(buffer, {
    fps: state.tpl.fps,
    onProgress: (p) => setStatus(`Analyzing audio… ${Math.round(p * 100)}%`),
  });
  state.featuresFromFile = false;
  setStatus(`Analyzed ${formatTime(buffer.duration)} of audio in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
}

async function loadAudio(file: File) {
  pause();
  setStatus('Decoding audio…');
  try {
    const buffer = await decodeAudio(await file.arrayBuffer());
    state.audio = buffer;
    if (audioEl.src) URL.revokeObjectURL(audioEl.src);
    audioEl.src = URL.createObjectURL(file);
    state.names.audio = file.name;
    if (state.featuresFromFile && state.features && Math.abs(state.features.duration - buffer.duration) < 0.5) {
      setStatus('Using the loaded .viz analysis for this audio');
    } else {
      await runAnalysis(buffer);
    }
    if (isPlaceholderTitle()) state.tpl.text.title = stripExt(file.name);
    afterMediaChange();
  } catch (e) {
    setStatus(`Could not load audio: ${(e as Error).message}`);
  }
}

async function loadImage(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

async function loadBackground(file: File) {
  try {
    if (file.type.startsWith('video/')) {
      const v = el('video', { muted: true, loop: true, playsInline: true, preload: 'auto', src: URL.createObjectURL(file) });
      await new Promise<void>((res, rej) => {
        v.addEventListener('loadeddata', () => res(), { once: true });
        v.addEventListener('error', () => rej(new Error('unsupported video')), { once: true });
      });
      state.bgVideo = v;
      state.assets.background = v;
      if (isPlaying()) void v.play();
    } else {
      state.bgVideo = null;
      state.assets.background = await loadImage(file);
    }
    state.names.background = file.name;
    state.tpl.background.kind = 'media';
    afterMediaChange();
  } catch (e) {
    setStatus(`Could not load background: ${(e as Error).message}`);
  }
}

async function loadArt(file: File) {
  state.assets.art = await loadImage(file);
  state.names.art = file.name;
  afterMediaChange();
}

async function loadLogo(file: File) {
  state.assets.logo = await loadImage(file);
  state.names.logo = file.name;
  afterMediaChange();
}

async function loadDemo() {
  pause();
  setStatus('Synthesizing demo track…');
  const buffer = await synthDemoTrack();
  state.audio = buffer;
  if (audioEl.src) URL.revokeObjectURL(audioEl.src);
  audioEl.src = URL.createObjectURL(encodeWav(buffer));
  state.names.audio = 'demo loop (synth)';
  if (!state.assets.art) {
    state.assets.art = makeDemoArt();
    state.names.art = 'demo cover';
  }
  if (isPlaceholderTitle()) {
    state.tpl.text.title = 'Demo Loop';
    state.tpl.text.artist = 'Visualizer';
  }
  await runAnalysis(buffer);
  afterMediaChange();
}

async function loadViz(file: File) {
  try {
    state.features = parseFeatures(await file.arrayBuffer());
    state.featuresFromFile = true;
    setStatus(`Loaded analysis: ${formatTime(state.features.duration)}. Load the matching audio to export.`);
    afterMediaChange();
  } catch (e) {
    setStatus(`Could not load .viz: ${(e as Error).message}`);
  }
}

async function loadTemplateFile(file: File) {
  try {
    const t = normalizeTemplate(JSON.parse(await file.text()));
    state.tpl = t;
    applyAspect();
    buildPanel();
    onChange();
    setStatus(`Loaded template “${t.name}”`);
  } catch (e) {
    setStatus(`Could not load template: ${(e as Error).message}`);
  }
}

function afterMediaChange() {
  emptyHint.hidden = !!state.features;
  seekTo(Math.min(currentTime(), duration()));
  buildPanel();
  onChange();
}

stage.addEventListener('dragover', (e) => e.preventDefault());
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  for (const f of e.dataTransfer?.files ?? []) {
    if (f.type.startsWith('audio/')) void loadAudio(f);
    else if (f.type.startsWith('video/')) void loadBackground(f);
    else if (f.type.startsWith('image/')) void loadArt(f);
    else if (f.name.endsWith('.viz')) void loadViz(f);
    else if (f.name.endsWith('.json')) void loadTemplateFile(f);
  }
});

// ---- export ----------------------------------------------------------------

const slug = (s: string) => s.trim().replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'visualizer';
const exportUi = { range: 'full', bitrate: '8000000' };
let exportProgress: HTMLProgressElement | null = null;
let exportLabel: HTMLElement | null = null;

async function doExport() {
  const { audio, features } = state;
  if (!audio || !features) {
    setStatus('Load audio (or the demo) before exporting');
    return;
  }
  pause();
  const start = exportUi.range === 'playhead' ? currentTime() : 0;
  const len = { full: Infinity, '10': 10, '30': 30, playhead: 15 }[exportUi.range] ?? Infinity;
  const ac = new AbortController();
  state.exporting = ac;
  buildPanel();
  const t0 = performance.now();
  try {
    const blob = await exportMp4({
      template: structuredClone(state.tpl),
      assets: state.assets,
      features,
      audio,
      bgVideo: state.bgVideo ?? undefined,
      start,
      end: start + len,
      videoBitrate: Number(exportUi.bitrate),
      signal: ac.signal,
      onProgress: (done, total) => {
        const elapsed = (performance.now() - t0) / 1000;
        const eta = done ? (elapsed / done) * (total - done) : 0;
        if (exportProgress) exportProgress.value = done / total;
        if (exportLabel) exportLabel.textContent = `Frame ${done} / ${total} · ${formatTime(eta)} left`;
        // show what's being encoded
        render(ctx, state.tpl, state.assets, features, start + done / state.tpl.fps);
      },
    });
    const secs = (performance.now() - t0) / 1000;
    (window as unknown as { __lastExport: unknown }).__lastExport = { size: blob.size, seconds: secs };
    download(blob, `${slug(state.tpl.text.title || state.tpl.name)}.mp4`);
    setStatus(`Exported ${(blob.size / 1e6).toFixed(1)} MB in ${secs.toFixed(1)}s`);
  } catch (e) {
    setStatus((e as Error).name === 'AbortError' ? 'Export cancelled' : `Export failed: ${(e as Error).message}`);
  } finally {
    state.exporting = null;
    dirty = true;
    buildPanel();
  }
}

// ---- panel -----------------------------------------------------------------

function fileRow(label: string, name: string, accept: string, onFile: (f: File) => void, onClear?: () => void) {
  const r = el('div', { className: 'file-row' }, el('span', { className: 'label' }, label), el('span', { className: 'name', title: name }, name || '—'));
  r.append(fileButton(name ? 'Replace' : 'Choose', accept, onFile));
  if (onClear && name) r.append(button('✕', onClear, 'btn icon'));
  return r;
}

const STYLES: [VizStyle, string][] = [
  ['bars', 'Bars'],
  ['mirror', 'Mirrored bars'],
  ['circle', 'Circular spectrum'],
  ['wave', 'Waveform line'],
  ['envelope', 'Filled envelope'],
  ['particles', 'Particles'],
];

function buildPanel() {
  const tpl = state.tpl;
  const ch = onChange;
  panel.replaceChildren();

  // media
  const media = section(panel, 'Media', true);
  media.append(
    fileRow('Audio', state.names.audio, 'audio/*', loadAudio),
    fileRow('Background', state.names.background, 'image/*,video/*', loadBackground, () => {
      state.assets.background = undefined;
      state.bgVideo = null;
      state.names.background = '';
      if (tpl.background.kind === 'media') tpl.background.kind = 'gradient';
      afterMediaChange();
    }),
    fileRow('Cover art', state.names.art, 'image/*', loadArt, () => {
      state.assets.art = undefined;
      state.names.art = '';
      afterMediaChange();
    }),
    fileRow('Logo', state.names.logo, 'image/*', loadLogo, () => {
      state.assets.logo = undefined;
      state.names.logo = '';
      afterMediaChange();
    }),
    el(
      'div',
      { className: 'actions' },
      button('Load demo track', () => void loadDemo()),
      fileButton('Load .viz', '.viz', loadViz),
      button('Save .viz', () => {
        if (state.features) download(serializeFeatures(state.features), `${slug(state.names.audio ? stripExt(state.names.audio) : 'analysis')}.viz`);
        else setStatus('Nothing analyzed yet');
      }),
    ),
  );

  // template
  const tsec = section(panel, 'Template', true);
  const presetPick = { id: PRESETS.find((p) => p.label === tpl.name)?.id ?? PRESETS[0].id };
  select(tsec, 'Preset', presetPick, 'id', PRESETS.map((p) => [p.id, p.label]), () => {});
  tsec.append(
    el(
      'div',
      { className: 'actions' },
      button('Apply preset', () => setTemplate(PRESETS.find((p) => p.id === presetPick.id)!.build(tpl.aspect)), 'btn primary'),
      button('Save template', () => download(new Blob([JSON.stringify(tpl, null, 2)], { type: 'application/json' }), `${slug(tpl.name)}.json`)),
      fileButton('Load template', '.json,application/json', loadTemplateFile),
    ),
  );
  select(tsec, 'Aspect', tpl, 'aspect', [['16:9', '16:9 · YouTube'], ['9:16', '9:16 · Shorts'], ['1:1', '1:1 · Square']], () => {
    applyAspect();
    ch();
  });
  text(tsec, 'Name', tpl, 'name', ch);

  // background
  const bg = section(panel, 'Background');
  select(bg, 'Type', tpl.background, 'kind', [['color', 'Solid color'], ['gradient', 'Gradient'], ['media', 'Uploaded image / video'], ['art', 'Blurred cover art']], ch);
  color(bg, 'Color', tpl.background, 'color', ch);
  color(bg, 'Color 2', tpl.background, 'color2', ch);
  range(bg, 'Angle', tpl.background, 'angle', 0, 360, 1, ch);
  range(bg, 'Blur', tpl.background, 'blur', 0, 80, 1, ch);
  range(bg, 'Darken', tpl.background, 'darken', 0, 0.9, 0.01, ch);
  range(bg, 'Slow zoom', tpl.background, 'zoom', 0, 0.3, 0.01, ch);
  range(bg, 'Vignette', tpl.background, 'vignette', 0, 1, 0.01, ch);

  // art
  const art = section(panel, 'Cover art', false, { obj: tpl.art, key: 'enabled', onChange: ch });
  range(art, 'X', tpl.art, 'x', 0, 1, 0.005, ch);
  range(art, 'Y', tpl.art, 'y', 0, 1, 0.005, ch);
  range(art, 'Size', tpl.art, 'size', 0.05, 1, 0.005, ch);
  range(art, 'Roundness', tpl.art, 'radius', 0, 0.5, 0.01, ch);
  range(art, 'Shadow', tpl.art, 'shadow', 0, 1, 0.01, ch);
  range(art, 'Beat pulse', tpl.art, 'pulse', 0, 1, 0.01, ch);
  range(art, 'Spin (rpm)', tpl.art, 'spin', 0, 33, 0.5, ch);
  range(art, 'Border', tpl.art, 'border', 0, 0.03, 0.001, ch);
  color(art, 'Border color', tpl.art, 'borderColor', ch);

  // visualizers
  tpl.visualizers.forEach((v, i) => {
    const label = STYLES.find(([s]) => s === v.style)?.[1] ?? v.style;
    const vs = section(panel, `Visualizer ${i + 1} · ${label}`, i === 0, { obj: v, key: 'enabled', onChange: ch });
    select(vs, 'Style', v, 'style', STYLES, () => {
      buildPanel();
      ch();
    });
    range(vs, 'X', v, 'x', 0, 1, 0.005, ch);
    range(vs, 'Y', v, 'y', 0, 1, 0.005, ch);
    if (v.style !== 'circle' && v.style !== 'particles') range(vs, 'Width', v, 'width', 0.05, 1, 0.005, ch);
    range(vs, v.style === 'particles' ? 'Spread' : v.style === 'circle' ? 'Bar length' : 'Height', v, 'height', 0.02, 1, 0.005, ch);
    if (v.style === 'circle' || v.style === 'particles') range(vs, 'Radius', v, 'radius', 0, 0.5, 0.005, ch);
    if (v.style !== 'wave') range(vs, v.style === 'particles' ? 'Particles' : 'Bars', v, 'count', 8, v.style === 'particles' ? 600 : 256, 1, ch);
    if (v.style === 'bars' || v.style === 'mirror' || v.style === 'circle') range(vs, 'Gap', v, 'gap', 0, 0.9, 0.01, ch);
    if (v.style === 'wave' || v.style === 'particles') range(vs, 'Thickness', v, 'thickness', 0.2, 4, 0.1, ch);
    color(vs, 'Color', v, 'color', ch);
    color(vs, 'Color 2', v, 'color2', ch);
    range(vs, 'Glow', v, 'glow', 0, 1.5, 0.01, ch);
    range(vs, 'Opacity', v, 'opacity', 0, 1, 0.01, ch);
    range(vs, 'Sensitivity', v, 'sensitivity', 0.2, 3, 0.05, ch);
    if (v.style !== 'wave' && v.style !== 'particles') {
      range(vs, 'Smoothing', v, 'smoothing', 0, 0.95, 0.01, ch);
      range(vs, 'Low Hz', v, 'minHz', 20, 2000, 10, ch);
      range(vs, 'High Hz', v, 'maxHz', 1000, 16000, 100, ch);
    }
    check(vs, 'Behind cover art', v, 'behindArt', ch);
    vs.append(
      el(
        'div',
        { className: 'actions' },
        button('Duplicate', () => {
          tpl.visualizers.splice(i + 1, 0, structuredClone(v));
          buildPanel();
          ch();
        }),
        button('Remove', () => {
          tpl.visualizers.splice(i, 1);
          buildPanel();
          ch();
        }),
      ),
    );
  });
  panel.append(
    el(
      'div',
      { className: 'actions pad' },
      button('+ Add visualizer', () => {
        tpl.visualizers.push(defaultVisualizer());
        buildPanel();
        ch();
      }),
    ),
  );

  // text
  const tx = section(panel, 'Title & artist', false, { obj: tpl.text, key: 'enabled', onChange: ch });
  text(tx, 'Title', tpl.text, 'title', ch);
  text(tx, 'Artist', tpl.text, 'artist', ch);
  range(tx, 'X', tpl.text, 'x', 0, 1, 0.005, ch);
  range(tx, 'Y', tpl.text, 'y', 0, 1, 0.005, ch);
  select(tx, 'Align', tpl.text, 'align', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], ch);
  select(tx, 'Font', tpl.text, 'font', FONTS.map((f) => [f, f]), () => {
    void document.fonts.load(`700 40px "${tpl.text.font}"`).then(() => (dirty = true));
    ch();
  });
  select(tx, 'Weight', tpl.text, 'weight', [['400', 'Regular'], ['500', 'Medium'], ['700', 'Bold'], ['800', 'Extra bold']], ch);
  range(tx, 'Title size', tpl.text, 'titleSize', 0.01, 0.15, 0.001, ch);
  range(tx, 'Artist size', tpl.text, 'artistSize', 0.01, 0.1, 0.001, ch);
  color(tx, 'Title color', tpl.text, 'titleColor', ch);
  color(tx, 'Artist color', tpl.text, 'artistColor', ch);
  check(tx, 'Uppercase', tpl.text, 'uppercase', ch);
  range(tx, 'Letter spacing', tpl.text, 'spacing', 0, 0.4, 0.01, ch);
  range(tx, 'Shadow', tpl.text, 'shadow', 0, 1, 0.01, ch);

  // progress
  const pr = section(panel, 'Progress bar', false, { obj: tpl.progress, key: 'enabled', onChange: ch });
  range(pr, 'X', tpl.progress, 'x', 0, 1, 0.005, ch);
  range(pr, 'Y', tpl.progress, 'y', 0, 1, 0.005, ch);
  range(pr, 'Width', tpl.progress, 'width', 0.05, 1, 0.005, ch);
  range(pr, 'Thickness', tpl.progress, 'thickness', 0.001, 0.03, 0.001, ch);
  color(pr, 'Track', tpl.progress, 'trackColor', ch);
  color(pr, 'Fill', tpl.progress, 'fillColor', ch);
  check(pr, 'Show timer', tpl.progress, 'showTime', ch);
  range(pr, 'Timer size', tpl.progress, 'timeSize', 0.01, 0.06, 0.001, ch);

  // logo
  const lg = section(panel, 'Logo', false, { obj: tpl.logo, key: 'enabled', onChange: ch });
  range(lg, 'X', tpl.logo, 'x', 0, 1, 0.005, ch);
  range(lg, 'Y', tpl.logo, 'y', 0, 1, 0.005, ch);
  range(lg, 'Size', tpl.logo, 'size', 0.02, 0.4, 0.005, ch);
  range(lg, 'Opacity', tpl.logo, 'opacity', 0, 1, 0.01, ch);

  // export
  const ex = section(panel, 'Export MP4', true);
  select(ex, 'Range', exportUi, 'range', [['full', 'Full track'], ['10', 'First 10 s (test)'], ['30', 'First 30 s'], ['playhead', '15 s from playhead']], () => {});
  select(ex, 'Quality', exportUi, 'bitrate', [['5000000', 'Standard · 5 Mbps'], ['8000000', 'High · 8 Mbps'], ['12000000', 'Max · 12 Mbps']], () => {});
  const { width, height } = ASPECTS[tpl.aspect];
  ex.append(el('p', { className: 'hint' }, `${width}×${height} · ${tpl.fps} fps · H.264 + AAC`));
  if (state.exporting) {
    exportProgress = el('progress', { max: 1, value: 0 });
    exportLabel = el('span', { className: 'hint' }, 'Starting…');
    const ac = state.exporting;
    ex.append(exportProgress, exportLabel, el('div', { className: 'actions' }, button('Cancel', () => ac.abort())));
  } else {
    exportProgress = exportLabel = null;
    ex.append(el('div', { className: 'actions' }, button('Export MP4', () => void doExport(), 'btn primary big')));
  }
}

// ---- boot ------------------------------------------------------------------

applyAspect();
buildPanel();
void document.fonts.ready.then(() => (dirty = true));
requestAnimationFrame(tick);
