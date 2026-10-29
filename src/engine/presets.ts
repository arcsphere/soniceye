import type { Aspect, Template, VisualizerLayer } from './types';

export function defaultVisualizer(): VisualizerLayer {
  return {
    enabled: true,
    style: 'bars',
    x: 0.5,
    y: 0.75,
    width: 0.6,
    height: 0.2,
    radius: 0.2,
    count: 64,
    gap: 0.3,
    thickness: 1,
    color: '#7cf7ff',
    color2: '#ff4fd8',
    glow: 0.4,
    opacity: 1,
    sensitivity: 1.1,
    smoothing: 0.8,
    minHz: 40,
    maxHz: 12000,
    behindArt: false,
  };
}

export function defaultTemplate(aspect: Aspect = '16:9'): Template {
  return {
    version: 1,
    name: 'Untitled',
    aspect,
    fps: 30,
    background: {
      kind: 'gradient',
      color: '#0d0b1e',
      color2: '#3a1450',
      angle: 135,
      blur: 0,
      darken: 0,
      zoom: 0,
      vignette: 0.3,
    },
    art: {
      enabled: true,
      x: 0.5,
      y: 0.42,
      size: 0.4,
      radius: 0.04,
      shadow: 0.6,
      pulse: 0.3,
      spin: 0,
      border: 0,
      borderColor: '#ffffff',
    },
    visualizers: [defaultVisualizer()],
    text: {
      enabled: true,
      title: 'Track Title',
      artist: 'Artist Name',
      x: 0.5,
      y: 0.84,
      align: 'center',
      font: 'Montserrat',
      weight: 700,
      titleSize: 0.05,
      artistSize: 0.03,
      titleColor: '#ffffff',
      artistColor: '#c9c3e6',
      uppercase: false,
      shadow: 0.5,
      spacing: 0,
    },
    progress: {
      enabled: true,
      x: 0.5,
      y: 0.95,
      width: 0.6,
      thickness: 0.006,
      trackColor: 'rgba(255,255,255,0.2)',
      fillColor: '#ffffff',
      showTime: false,
      timeSize: 0.022,
    },
    logo: { enabled: true, x: 0.93, y: 0.08, size: 0.08, opacity: 0.85 },
  };
}

/** Deep-merge a loaded (possibly partial or older) template onto the defaults. */
export function normalizeTemplate(raw: unknown): Template {
  const r = (raw ?? {}) as Partial<Template>;
  const base = defaultTemplate(r.aspect ?? '16:9');
  return {
    ...base,
    ...r,
    version: 1,
    background: { ...base.background, ...r.background },
    art: { ...base.art, ...r.art },
    visualizers: (r.visualizers ?? base.visualizers).map((v) => ({ ...defaultVisualizer(), ...v })),
    text: { ...base.text, ...r.text },
    progress: { ...base.progress, ...r.progress },
    logo: { ...base.logo, ...r.logo },
  };
}

type Preset = { id: string; label: string; build: (aspect: Aspect) => Template };

const portrait = (a: Aspect) => a === '9:16';
const square = (a: Aspect) => a === '1:1';

export const PRESETS: Preset[] = [
  {
    id: 'cover-bars',
    label: 'Cover + Bars',
    build(aspect) {
      const t = defaultTemplate(aspect);
      t.name = 'Cover + Bars';
      t.background = { ...t.background, kind: 'art', blur: 40, darken: 0.45, zoom: 0.06, vignette: 0.5 };
      const v = t.visualizers[0];
      if (portrait(aspect) || square(aspect)) {
        t.art = { ...t.art, x: 0.5, y: square(aspect) ? 0.36 : 0.34, size: square(aspect) ? 0.46 : 0.72 };
        Object.assign(t.text, { x: 0.5, y: square(aspect) ? 0.69 : 0.58, align: 'center' });
        Object.assign(v, { x: 0.5, y: square(aspect) ? 0.84 : 0.72, width: 0.8, height: 0.12, count: 48 });
        Object.assign(t.progress, { x: 0.5, y: square(aspect) ? 0.92 : 0.8, width: 0.8, showTime: true });
      } else {
        t.art = { ...t.art, x: 0.3, y: 0.5, size: 0.6 };
        Object.assign(t.text, { x: 0.53, y: 0.36, align: 'left', titleSize: 0.065, artistSize: 0.035 });
        Object.assign(v, { x: 0.72, y: 0.6, width: 0.38, height: 0.18, count: 48, gap: 0.35 });
        Object.assign(t.progress, { x: 0.72, y: 0.76, width: 0.38, showTime: true });
      }
      Object.assign(v, { color: '#ffffff', color2: '#ffd0a8', glow: 0.3, smoothing: 0.82 });
      return t;
    },
  },
  {
    id: 'circle-pulse',
    label: 'Circle Pulse',
    build(aspect) {
      const t = defaultTemplate(aspect);
      t.name = 'Circle Pulse';
      const cy = portrait(aspect) ? 0.4 : 0.44;
      t.background = { ...t.background, kind: 'color', color: '#07060f', vignette: 0.6 };
      t.art = { ...t.art, x: 0.5, y: cy, size: 0.36, radius: 0.5, spin: 6, pulse: 0.5, border: 0.006 };
      const ring: VisualizerLayer = {
        ...t.visualizers[0],
        style: 'circle',
        x: 0.5,
        y: cy,
        radius: 0.195,
        height: 0.13,
        count: 120,
        gap: 0.45,
        color: '#7cf7ff',
        color2: '#ff4fd8',
        glow: 0.8,
        smoothing: 0.85,
        behindArt: true,
      };
      const dust: VisualizerLayer = {
        ...ring,
        style: 'particles',
        radius: 0.2,
        height: 0.6,
        count: 180,
        thickness: 1,
        glow: 0.5,
        opacity: 0.8,
      };
      t.visualizers = [dust, ring];
      Object.assign(t.text, { y: portrait(aspect) ? 0.66 : 0.86, align: 'center' });
      Object.assign(t.progress, { y: portrait(aspect) ? 0.74 : 0.95, width: 0.5 });
      return t;
    },
  },
  {
    id: 'podcast-wave',
    label: 'Podcast Wave',
    build(aspect) {
      const t = defaultTemplate(aspect);
      t.name = 'Podcast Wave';
      t.background = { ...t.background, kind: 'gradient', color: '#101826', color2: '#1d3b4a', angle: 160 };
      const v = t.visualizers[0];
      Object.assign(v, {
        style: 'envelope',
        x: 0.5,
        y: 0.78,
        width: 0.92,
        height: 0.22,
        count: 96,
        color: '#5ef2c2',
        color2: '#4aa8ff',
        glow: 0.5,
        sensitivity: 1.2,
        smoothing: 0.88,
        minHz: 60,
        maxHz: 8000,
      });
      if (portrait(aspect)) {
        t.art = { ...t.art, x: 0.5, y: 0.3, size: 0.7, radius: 0.06 };
        Object.assign(t.text, { x: 0.5, y: 0.56, align: 'center' });
      } else {
        t.art = { ...t.art, x: square(aspect) ? 0.5 : 0.22, y: square(aspect) ? 0.3 : 0.36, size: square(aspect) ? 0.38 : 0.42 };
        Object.assign(t.text, square(aspect)
          ? { x: 0.5, y: 0.58, align: 'center' }
          : { x: 0.42, y: 0.28, align: 'left', titleSize: 0.06, artistSize: 0.034 });
      }
      Object.assign(t.progress, { x: 0.5, y: 0.95, width: 0.92, showTime: true, fillColor: '#5ef2c2' });
      return t;
    },
  },
  {
    id: 'neon-mirror',
    label: 'Neon Mirror',
    build(aspect) {
      const t = defaultTemplate(aspect);
      t.name = 'Neon Mirror';
      t.background = { ...t.background, kind: 'color', color: '#050507', vignette: 0.4 };
      t.art.enabled = false;
      const v = t.visualizers[0];
      Object.assign(v, {
        style: 'mirror',
        x: 0.5,
        y: 0.5,
        width: 0.86,
        height: 0.4,
        count: 80,
        gap: 0.4,
        color: '#ff2fb4',
        color2: '#ffd23f',
        glow: 1,
        smoothing: 0.75,
      });
      const line: VisualizerLayer = { ...v, style: 'wave', height: 0.18, thickness: 1.2, color: '#ffffff', color2: '#ffffff', glow: 0.6, opacity: 0.7 };
      t.visualizers = [v, line];
      Object.assign(t.text, { y: 0.16, uppercase: true, spacing: 0.15, font: 'Bebas Neue', weight: 400, titleSize: 0.08 });
      Object.assign(t.progress, { y: 0.9, width: 0.86, fillColor: '#ff2fb4' });
      return t;
    },
  },
];
