// Template schema. Positions (x, y) are fractions of the frame and mark a layer's
// center. Sizes are fractions of U = min(width, height) so a template survives a
// change of aspect ratio; horizontal spans (viz width, progress width) use the width.

export type Aspect = '16:9' | '9:16' | '1:1';

export const ASPECTS: Record<Aspect, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

export type VizStyle = 'bars' | 'mirror' | 'circle' | 'wave' | 'envelope' | 'particles';

export interface BackgroundLayer {
  /** 'media' = uploaded image/video, 'art' = the cover art blown up behind everything */
  kind: 'color' | 'gradient' | 'media' | 'art';
  color: string;
  color2: string;
  angle: number;
  blur: number;
  darken: number;
  /** slow breathing zoom amount, 0 = off */
  zoom: number;
  vignette: number;
}

export interface ArtLayer {
  enabled: boolean;
  x: number;
  y: number;
  size: number;
  /** corner radius as a fraction of size; 0.5 = circle */
  radius: number;
  shadow: number;
  /** how much the card bumps on beats */
  pulse: number;
  /** rotations per minute, for a vinyl look */
  spin: number;
  border: number;
  borderColor: string;
}

export interface VisualizerLayer {
  enabled: boolean;
  style: VizStyle;
  x: number;
  y: number;
  /** span as a fraction of frame width (bars, mirror, wave, envelope) */
  width: number;
  /** max height / length as a fraction of U */
  height: number;
  /** inner radius as a fraction of U (circle, particles) */
  radius: number;
  /** bars or particles */
  count: number;
  /** gap between bars, fraction of each slot */
  gap: number;
  /** line width / particle size multiplier */
  thickness: number;
  color: string;
  color2: string;
  glow: number;
  opacity: number;
  sensitivity: number;
  /** peak decay per frame, 0 = raw, 0.95 = very smooth */
  smoothing: number;
  minHz: number;
  maxHz: number;
  behindArt: boolean;
}

export interface TextLayer {
  enabled: boolean;
  title: string;
  artist: string;
  x: number;
  y: number;
  align: CanvasTextAlign;
  font: string;
  weight: number;
  titleSize: number;
  artistSize: number;
  titleColor: string;
  artistColor: string;
  uppercase: boolean;
  shadow: number;
  spacing: number;
}

export interface ProgressLayer {
  enabled: boolean;
  x: number;
  y: number;
  width: number;
  thickness: number;
  trackColor: string;
  fillColor: string;
  showTime: boolean;
  timeSize: number;
}

export interface LogoLayer {
  enabled: boolean;
  x: number;
  y: number;
  size: number;
  opacity: number;
}

export interface Template {
  version: 1;
  name: string;
  aspect: Aspect;
  fps: number;
  background: BackgroundLayer;
  art: ArtLayer;
  visualizers: VisualizerLayer[];
  text: TextLayer;
  progress: ProgressLayer;
  logo: LogoLayer;
}
