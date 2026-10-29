// Deterministic frame renderer: render(ctx, template, assets, features, t) draws the
// frame at time t. Nothing depends on the previous frame, so preview, scrubbing and
// export all produce identical pixels for the same t.

import { beatAt, energyAt, frameAt, levelAt, spectrumAt, waveAt, type FeatureTrack } from './analysis';
import type { ArtLayer, BackgroundLayer, LogoLayer, ProgressLayer, Template, TextLayer, VisualizerLayer } from './types';

export interface Assets {
  background?: CanvasImageSource;
  art?: CanvasImageSource;
  logo?: CanvasImageSource;
}

type Ctx = CanvasRenderingContext2D;

interface Frame {
  W: number;
  H: number;
  U: number;
  t: number;
  ft: FeatureTrack | null;
  frame: number;
  level: number;
  beat: number;
}

export function sourceSize(src: CanvasImageSource): [number, number] {
  if (src instanceof HTMLVideoElement) return [src.videoWidth, src.videoHeight];
  if (src instanceof HTMLImageElement) return [src.naturalWidth, src.naturalHeight];
  if (src instanceof SVGImageElement) return [src.width.baseVal.value, src.height.baseVal.value];
  if (src instanceof VideoFrame) return [src.displayWidth, src.displayHeight];
  return [src.width, src.height];
}

/** Draw src scaled to cover (or contain) the box centered at (cx, cy). */
function drawFit(ctx: Ctx, src: CanvasImageSource, cx: number, cy: number, w: number, h: number, mode: 'cover' | 'contain') {
  const [sw, sh] = sourceSize(src);
  if (!sw || !sh) return;
  const s = mode === 'cover' ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh);
  ctx.drawImage(src, cx - (sw * s) / 2, cy - (sh * s) / 2, sw * s, sh * s);
}

export function render(ctx: Ctx, tpl: Template, assets: Assets, ft: FeatureTrack | null, t: number) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const frame = ft ? frameAt(ft, t) : 0;
  const f: Frame = {
    W,
    H,
    U: Math.min(W, H),
    t,
    ft,
    frame,
    level: ft ? levelAt(ft, frame) : 0,
    beat: ft ? beatAt(ft, frame) : 0,
  };

  ctx.save();
  ctx.clearRect(0, 0, W, H);
  drawBackground(ctx, tpl.background, assets, f);
  for (const v of tpl.visualizers) if (v.enabled && v.behindArt) drawVisualizer(ctx, v, f);
  if (tpl.art.enabled && assets.art) drawArt(ctx, tpl.art, assets.art, f);
  for (const v of tpl.visualizers) if (v.enabled && !v.behindArt) drawVisualizer(ctx, v, f);
  if (tpl.text.enabled) drawText(ctx, tpl.text, f);
  if (tpl.progress.enabled) drawProgress(ctx, tpl.progress, f);
  if (tpl.logo.enabled && assets.logo) drawLogo(ctx, tpl.logo, assets.logo, f);
  ctx.restore();
}

// ---- background ------------------------------------------------------------

// Blurring a full frame every tick is expensive, so still sources are blurred once and cached.
const blurCache = new WeakMap<object, { key: string; canvas: HTMLCanvasElement }>();

function blurredStill(src: CanvasImageSource, W: number, H: number, blur: number, pad: number): HTMLCanvasElement {
  const key = `${W}x${H}:${blur}:${pad}`;
  const hit = blurCache.get(src as object);
  if (hit && hit.key === key) return hit.canvas;
  const c = document.createElement('canvas');
  c.width = Math.round(W * pad);
  c.height = Math.round(H * pad);
  const g = c.getContext('2d')!;
  g.filter = blur > 0 ? `blur(${blur}px)` : 'none';
  // overdraw so the blur doesn't pull transparent edges in
  const over = 1 + (blur * 4) / Math.min(c.width, c.height);
  drawFit(g, src, c.width / 2, c.height / 2, c.width * over, c.height * over, 'cover');
  blurCache.set(src as object, { key, canvas: c });
  return c;
}

function drawBackground(ctx: Ctx, bg: BackgroundLayer, assets: Assets, f: Frame) {
  const { W, H, U, t } = f;
  const src = bg.kind === 'media' ? assets.background : bg.kind === 'art' ? assets.art : undefined;

  if (src) {
    const blurPx = (bg.blur * U) / 1080;
    // slow 20 s breathing zoom
    const zoom = 1 + bg.zoom * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 20));
    const pad = 1 + bg.zoom;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom / pad, zoom / pad);
    if (src instanceof HTMLVideoElement) {
      if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`;
      const over = 1 + (blurPx * 4) / U;
      drawFit(ctx, src, 0, 0, W * pad * over, H * pad * over, 'cover');
    } else {
      const still = blurredStill(src, W, H, blurPx, pad);
      ctx.drawImage(still, -still.width / 2, -still.height / 2);
    }
    ctx.restore();
  } else if (bg.kind === 'gradient' || (bg.kind !== 'color' && !src)) {
    const a = (bg.angle * Math.PI) / 180;
    const r = Math.hypot(W, H) / 2;
    const dx = Math.cos(a) * r;
    const dy = Math.sin(a) * r;
    const g = ctx.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy);
    g.addColorStop(0, bg.color);
    g.addColorStop(1, bg.color2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, W, H);
  }

  if (bg.darken > 0) {
    ctx.fillStyle = `rgba(0,0,0,${bg.darken})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (bg.vignette > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, U * 0.3, W / 2, H / 2, Math.hypot(W, H) / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${bg.vignette})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}

// ---- cover art -------------------------------------------------------------

function drawArt(ctx: Ctx, art: ArtLayer, src: CanvasImageSource, f: Frame) {
  const { W, H, U, t } = f;
  const bump = 1 + art.pulse * (0.06 * f.beat + 0.025 * f.level);
  const s = art.size * U * bump;
  const cx = art.x * W;
  const cy = art.y * H;
  const r = Math.min(0.5, art.radius) * s;

  ctx.save();
  ctx.translate(cx, cy);
  if (art.spin) ctx.rotate((t * art.spin * 2 * Math.PI) / 60);

  if (art.shadow > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${0.35 + 0.4 * art.shadow})`;
    ctx.shadowBlur = art.shadow * U * 0.06;
    ctx.shadowOffsetY = art.shadow * U * 0.015;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.roundRect(-s / 2, -s / 2, s, s, r);
    ctx.fill();
    ctx.restore();
  }

  ctx.beginPath();
  ctx.roundRect(-s / 2, -s / 2, s, s, r);
  ctx.save();
  ctx.clip();
  drawFit(ctx, src, 0, 0, s, s, 'cover');
  ctx.restore();

  if (art.border > 0) {
    ctx.lineWidth = art.border * U;
    ctx.strokeStyle = art.borderColor;
    ctx.stroke();
  }
  ctx.restore();
}

// ---- visualizers -----------------------------------------------------------

const scratchBands = new Float32Array(256);
const scratchWave = new Float32Array(256);

/** n values in 0..1 sampled log-uniformly over [minHz, maxHz], with smoothing and sensitivity. */
function barValues(v: VisualizerLayer, f: Frame, n: number): Float32Array {
  const out = new Float32Array(n);
  const { ft } = f;
  if (!ft) {
    // idle shape so the layout is visible before audio is loaded
    for (let i = 0; i < n; i++) out[i] = 0.12 + 0.08 * Math.sin(i * 0.35 + f.t * 2);
    return out;
  }
  spectrumAt(ft, f.frame, v.smoothing, scratchBands);
  const lo = Math.max(ft.minHz, Math.min(v.minHz, v.maxHz - 1));
  const hi = Math.min(ft.maxHz, Math.max(v.maxHz, lo + 1));
  const span = Math.log(ft.maxHz / ft.minHz);
  for (let i = 0; i < n; i++) {
    const hz = lo * Math.pow(hi / lo, (i + 0.5) / n);
    const pos = Math.max(0, Math.min(ft.bands - 1, (Math.log(hz / ft.minHz) / span) * ft.bands - 0.5));
    const b0 = Math.floor(pos);
    const b1 = Math.min(ft.bands - 1, b0 + 1);
    const fr = pos - b0;
    const raw = scratchBands[b0] * (1 - fr) + scratchBands[b1] * fr;
    // expand contrast, then apply sensitivity
    const shaped = Math.pow(Math.max(0, raw - 0.05) / 0.95, 1.2);
    out[i] = Math.min(1, shaped * v.sensitivity);
  }
  return out;
}

function applyGlow(ctx: Ctx, v: VisualizerLayer, U: number) {
  if (v.glow > 0) {
    ctx.shadowColor = v.color;
    ctx.shadowBlur = v.glow * U * 0.03;
  }
}

function drawVisualizer(ctx: Ctx, v: VisualizerLayer, f: Frame) {
  ctx.save();
  ctx.globalAlpha = v.opacity;
  switch (v.style) {
    case 'bars':
    case 'mirror':
      drawBars(ctx, v, f);
      break;
    case 'circle':
      drawCircle(ctx, v, f);
      break;
    case 'wave':
      drawWave(ctx, v, f);
      break;
    case 'envelope':
      drawEnvelope(ctx, v, f);
      break;
    case 'particles':
      drawParticles(ctx, v, f);
      break;
  }
  ctx.restore();
}

function drawBars(ctx: Ctx, v: VisualizerLayer, f: Frame) {
  const { W, H, U } = f;
  const n = Math.max(2, Math.round(v.count));
  const vals = barValues(v, f, n);
  const w = v.width * W;
  const h = v.height * U;
  const cx = v.x * W;
  const cy = v.y * H;
  const x0 = cx - w / 2;
  const slot = w / n;
  const bw = Math.max(1, slot * (1 - v.gap));
  const mirror = v.style === 'mirror';
  const base = mirror ? cy : cy + h / 2;

  const g = ctx.createLinearGradient(0, base, 0, base - h * (mirror ? 0.5 : 1));
  g.addColorStop(0, v.color);
  g.addColorStop(1, v.color2);
  ctx.fillStyle = g;
  applyGlow(ctx, v, U);

  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const bh = Math.max(bw * 0.5, vals[i] * h * (mirror ? 1 : 1));
    const x = x0 + i * slot + (slot - bw) / 2;
    if (mirror) ctx.roundRect(x, cy - bh / 2, bw, bh, bw / 2);
    else ctx.roundRect(x, base - bh, bw, bh, [bw / 2, bw / 2, 0, 0]);
  }
  ctx.fill();
}

function drawCircle(ctx: Ctx, v: VisualizerLayer, f: Frame) {
  const { W, H, U } = f;
  const n = Math.max(8, Math.round(v.count));
  // mirror left/right: bass at the top, highs meeting at the bottom
  const half = Math.ceil(n / 2);
  const vals = barValues(v, f, half);
  const cx = v.x * W;
  const cy = v.y * H;
  const r = v.radius * U * (1 + 0.03 * f.beat);
  const len = v.height * U;

  const g = ctx.createRadialGradient(cx, cy, r, cx, cy, r + len);
  g.addColorStop(0, v.color);
  g.addColorStop(1, v.color2);
  ctx.strokeStyle = g;
  ctx.lineWidth = Math.max(1, ((2 * Math.PI * r) / n) * (1 - v.gap));
  ctx.lineCap = 'round';
  applyGlow(ctx, v, U);

  ctx.beginPath();
  for (let k = 0; k < n; k++) {
    const idx = k < half ? k : n - 1 - k;
    const a = -Math.PI / 2 + (k / n) * Math.PI * 2;
    const l = Math.max(ctx.lineWidth * 0.5, vals[Math.min(half - 1, idx)] * len);
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.moveTo(cx + c * r, cy + s * r);
    ctx.lineTo(cx + c * (r + l), cy + s * (r + l));
  }
  ctx.stroke();
}

function horizontalGradient(ctx: Ctx, v: VisualizerLayer, x0: number, w: number) {
  const g = ctx.createLinearGradient(x0, 0, x0 + w, 0);
  g.addColorStop(0, v.color);
  g.addColorStop(0.5, v.color2);
  g.addColorStop(1, v.color);
  return g;
}

function drawWave(ctx: Ctx, v: VisualizerLayer, f: Frame) {
  const { W, H, U, ft } = f;
  const w = v.width * W;
  const h = v.height * U;
  const x0 = v.x * W - w / 2;
  const cy = v.y * H;
  const n = ft ? ft.waveSize : 128;
  if (ft) waveAt(ft, f.frame, scratchWave);
  else for (let i = 0; i < n; i++) scratchWave[i] = 0.15 * Math.sin(i * 0.2 + f.t * 3);

  ctx.strokeStyle = horizontalGradient(ctx, v, x0, w);
  ctx.lineWidth = Math.max(1, v.thickness * U * 0.004);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  applyGlow(ctx, v, U);

  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    // taper the ends to zero so the line meets the axis
    const taper = Math.sin((Math.PI * i) / (n - 1));
    const y = cy + scratchWave[i] * taper * v.sensitivity * (h / 2);
    const x = x0 + (i / (n - 1)) * w;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawEnvelope(ctx: Ctx, v: VisualizerLayer, f: Frame) {
  const { W, H, U } = f;
  const n = Math.max(8, Math.round(v.count));
  // bass in the middle, highs toward both edges
  const half = Math.ceil(n / 2);
  const vals = barValues(v, f, half);
  const w = v.width * W;
  const h = v.height * U;
  const x0 = v.x * W - w / 2;
  const cy = v.y * H;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const d = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2);
    const idx = Math.min(half - 1, Math.floor(d * half));
    const edge = Math.sin(Math.PI * (i / (n - 1)));
    pts.push([x0 + (i / (n - 1)) * w, Math.max(h * 0.01, vals[idx] * edge * (h / 2))]);
  }

  ctx.fillStyle = horizontalGradient(ctx, v, x0, w);
  applyGlow(ctx, v, U);
  ctx.beginPath();
  ctx.moveTo(x0, cy);
  smoothPath(ctx, pts, cy, -1);
  ctx.lineTo(x0 + w, cy);
  smoothPath(ctx, [...pts].reverse(), cy, 1);
  ctx.closePath();
  ctx.fill();
}

function smoothPath(ctx: Ctx, pts: [number, number][], cy: number, dir: number) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x, a] = pts[i];
    const [nx, na] = pts[i + 1];
    ctx.quadraticCurveTo(x, cy + dir * a, (x + nx) / 2, cy + (dir * (a + na)) / 2);
  }
}

// Per-particle shadowBlur is very slow in Canvas 2D, so glow comes from a cached
// radial sprite per color instead.
const spriteCache = new Map<string, HTMLCanvasElement>();

function glowSprite(color: string, glow: number): HTMLCanvasElement {
  const key = `${color}:${glow.toFixed(2)}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const core = 1 / (1 + glow * 3);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(core * 0.5, color);
  grad.addColorStop(core, color);
  grad.addColorStop(Math.min(1, core + 0.01), hexAlpha(color, glow > 0 ? 0.35 : 0));
  grad.addColorStop(1, hexAlpha(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  if (spriteCache.size > 32) spriteCache.clear();
  spriteCache.set(key, c);
  return c;
}

function hexAlpha(hex: string, a: number): string {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return `rgba(255,255,255,${a})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}

function hash(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Particles drift outward from a ring. Their progress is a function of cumulative
 * loudness, so they speed up when the music is loud without needing per-frame state.
 */
function drawParticles(ctx: Ctx, v: VisualizerLayer, f: Frame) {
  const { W, H, U, t, ft } = f;
  const cx = v.x * W;
  const cy = v.y * H;
  const r0 = v.radius * U;
  const span = v.height * U;
  const energy = ft ? energyAt(ft, t) : t * 0.3;
  const n = Math.max(1, Math.round(v.count));
  const lvl = f.level;

  ctx.globalCompositeOperation = 'lighter';
  const sprites = [glowSprite(v.color, v.glow), glowSprite(v.color2, v.glow)];
  const spriteScale = 1 + v.glow * 3;
  for (let i = 0; i < n; i++) {
    const h1 = hash(i, 1);
    const h2 = hash(i, 2);
    const h3 = hash(i, 3);
    const h4 = hash(i, 4);
    const speed = 0.5 + h2;
    const raw = h3 + (energy * 0.35 * v.sensitivity + t * 0.03) * speed;
    const p = raw - Math.floor(raw);
    const a = h1 * Math.PI * 2 + 0.25 * Math.sin(t * 0.3 + i);
    const d = r0 + p * span;
    const size = U * 0.0035 * v.thickness * (0.4 + h4) * (1 + lvl * 1.2 + f.beat * 0.8);
    ctx.globalAlpha = v.opacity * Math.sin(p * Math.PI) * (0.35 + 0.65 * lvl);
    const r = size * spriteScale;
    ctx.drawImage(sprites[h4 > 0.5 ? 0 : 1], cx + Math.cos(a) * d - r, cy + Math.sin(a) * d - r, r * 2, r * 2);
  }
}

// ---- text, progress, logo --------------------------------------------------

function setSpacing(ctx: Ctx, px: number) {
  if ('letterSpacing' in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${px}px`;
}

function drawText(ctx: Ctx, tx: TextLayer, f: Frame) {
  const { W, H, U } = f;
  const x = tx.x * W;
  let y = tx.y * H;
  const fmt = (s: string) => (tx.uppercase ? s.toUpperCase() : s);
  ctx.save();
  ctx.textAlign = tx.align;
  ctx.textBaseline = 'alphabetic';
  if (tx.shadow > 0) {
    ctx.shadowColor = `rgba(0,0,0,${0.6 * tx.shadow})`;
    ctx.shadowBlur = tx.shadow * U * 0.02;
    ctx.shadowOffsetY = tx.shadow * U * 0.004;
  }
  if (tx.title) {
    const size = tx.titleSize * U;
    ctx.font = `${tx.weight} ${size}px "${tx.font}", system-ui, sans-serif`;
    setSpacing(ctx, tx.spacing * size);
    ctx.fillStyle = tx.titleColor;
    ctx.fillText(fmt(tx.title), x, y);
    y += size * 0.35;
  }
  if (tx.artist) {
    const size = tx.artistSize * U;
    ctx.font = `400 ${size}px "${tx.font}", system-ui, sans-serif`;
    setSpacing(ctx, tx.spacing * size);
    ctx.fillStyle = tx.artistColor;
    ctx.fillText(fmt(tx.artist), x, y + size * 1.2);
  }
  ctx.restore();
}

export function formatTime(s: number): string {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function drawProgress(ctx: Ctx, p: ProgressLayer, f: Frame) {
  const { W, H, U, t, ft } = f;
  const dur = ft?.duration ?? 0;
  const frac = dur ? Math.min(1, t / dur) : 0;
  const w = p.width * W;
  const th = Math.max(1, p.thickness * U);
  const x0 = p.x * W - w / 2;
  const y = p.y * H;

  ctx.save();
  ctx.fillStyle = p.trackColor;
  ctx.beginPath();
  ctx.roundRect(x0, y - th / 2, w, th, th / 2);
  ctx.fill();
  ctx.fillStyle = p.fillColor;
  ctx.beginPath();
  ctx.roundRect(x0, y - th / 2, Math.max(th, w * frac), th, th / 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x0 + w * frac, y, th * 1.4, 0, Math.PI * 2);
  ctx.fill();

  if (p.showTime) {
    const size = p.timeSize * U;
    ctx.font = `500 ${size}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(formatTime(t), x0, y + th + size * 0.5);
    ctx.textAlign = 'right';
    ctx.fillText(formatTime(dur), x0 + w, y + th + size * 0.5);
  }
  ctx.restore();
}

function drawLogo(ctx: Ctx, l: LogoLayer, src: CanvasImageSource, f: Frame) {
  const s = l.size * f.U;
  ctx.save();
  ctx.globalAlpha = l.opacity;
  drawFit(ctx, src, l.x * f.W, l.y * f.H, s, s, 'contain');
  ctx.restore();
}
