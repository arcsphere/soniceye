// Offline audio analysis: turns an AudioBuffer into a per-frame feature track.
// Preview and export both read this track, so what you see is what you export,
// and long tracks can be analyzed once and saved as a .viz file.

export interface FeatureTrack {
  fps: number;
  frames: number;
  bands: number;
  waveSize: number;
  duration: number;
  sampleRate: number;
  minHz: number;
  maxHz: number;
  /** frames * bands, 0..255 */
  spectrum: Uint8Array;
  /** frames * waveSize, 128 = zero */
  wave: Uint8Array;
  /** frames, loudness 0..255 */
  level: Uint8Array;
  /** frames, onset strength 0..255 (0 = no beat) */
  beat: Uint8Array;
  /** derived: cumulative loudness in seconds, used to drive particles */
  energy: Float32Array;
}

const FFT_SIZE = 2048;

class FFT {
  private rev: Uint32Array;
  private cos: Float32Array;
  private sin: Float32Array;

  constructor(private n: number) {
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
  }

  transform(re: Float32Array, im: Float32Array) {
    const { n, rev, cos, sin } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const a = start + k;
          const b = a + half;
          const wr = cos[k * step];
          const wi = sin[k * step];
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

export async function analyze(
  buffer: AudioBuffer,
  opts: { fps?: number; bands?: number; onProgress?: (p: number) => void } = {},
): Promise<FeatureTrack> {
  const fps = opts.fps ?? 30;
  const bands = opts.bands ?? 64;
  const waveSize = 256;
  const minHz = 30;
  const maxHz = 16000;
  const sr = buffer.sampleRate;
  const N = FFT_SIZE;

  // mono mixdown
  const len = buffer.length;
  const mono = new Float32Array(len);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += ch[i] / buffer.numberOfChannels;
  }
  let peak = 1e-6;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(mono[i]));
  const waveGain = Math.min(1 / peak, 8);

  const frames = Math.max(1, Math.ceil((len / sr) * fps));
  const spectrum = new Uint8Array(frames * bands);
  const wave = new Uint8Array(frames * waveSize);
  const level = new Uint8Array(frames);
  const flux = new Float32Array(frames);

  const hann = new Float32Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));

  // log-spaced band edges
  const edges = new Float32Array(bands + 1);
  for (let b = 0; b <= bands; b++) edges[b] = minHz * Math.pow(maxHz / minHz, b / bands);
  const bassBands = edges.findIndex((e) => e > 150);

  const fft = new FFT(N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const pow = new Float32Array(N / 2);
  const prevBands = new Float32Array(bands);
  const hop = sr / fps;
  const binHz = sr / N;

  for (let f = 0; f < frames; f++) {
    const center = Math.round(f * hop + hop / 2);
    const start = center - N / 2;
    for (let k = 0; k < N; k++) {
      const idx = start + k;
      re[k] = idx >= 0 && idx < len ? mono[idx] * hann[k] : 0;
      im[k] = 0;
    }
    fft.transform(re, im);
    // normalize so a full-scale sine is ~1.0 (0 dB)
    const norm = 4 / N;
    for (let k = 0; k < N / 2; k++) pow[k] = (re[k] * re[k] + im[k] * im[k]) * norm * norm;

    let bassFlux = 0;
    for (let b = 0; b < bands; b++) {
      const lo = edges[b] / binHz;
      const hi = edges[b + 1] / binHz;
      const kLo = Math.ceil(lo);
      const kHi = Math.floor(hi);
      let p: number;
      if (kHi - kLo < 1) {
        // band narrower than a bin: interpolate at its center
        const c = Math.sqrt(lo * hi);
        const k0 = Math.floor(c);
        const fr = c - k0;
        p = pow[k0] * (1 - fr) + pow[Math.min(k0 + 1, N / 2 - 1)] * fr;
      } else {
        p = 0;
        for (let k = kLo; k <= kHi; k++) p += pow[k];
        p /= kHi - kLo + 1;
      }
      const fc = Math.sqrt(edges[b] * edges[b + 1]);
      // +3 dB/octave tilt so highs are visible next to the bass
      const db = 10 * Math.log10(p + 1e-12) + 3 * Math.log2(fc / 1000);
      const v = clamp01((db + 62) / 54);
      spectrum[f * bands + b] = Math.round(v * 255);
      if (b < bassBands) bassFlux += Math.max(0, v - prevBands[b]);
      prevBands[b] = v;
    }
    flux[f] = bassFlux / Math.max(1, bassBands);

    // loudness over this frame's hop
    let sum = 0;
    const h0 = Math.max(0, Math.round(f * hop));
    const h1 = Math.min(len, Math.round((f + 1) * hop));
    for (let i = h0; i < h1; i++) sum += mono[i] * mono[i];
    const rms = Math.sqrt(sum / Math.max(1, h1 - h0));
    level[f] = Math.round(clamp01((20 * Math.log10(rms + 1e-9) + 48) / 45) * 255);

    // waveform snapshot of the FFT window
    const stride = N / waveSize;
    for (let i = 0; i < waveSize; i++) {
      const idx = start + i * stride;
      const s = idx >= 0 && idx < len ? mono[idx] * waveGain : 0;
      wave[f * waveSize + i] = Math.round(128 + Math.max(-1, Math.min(1, s)) * 127);
    }

    if (f % 300 === 0) {
      opts.onProgress?.(f / frames);
      await yieldToUi();
    }
  }

  const beat = detectBeats(flux, fps);
  opts.onProgress?.(1);
  return withEnergy({ fps, frames, bands, waveSize, duration: len / sr, sampleRate: sr, minHz, maxHz, spectrum, wave, level, beat, energy: new Float32Array(0) });
}

/** Onsets on bass flux: above an adaptive local threshold, local max, min gap 0.25s. */
function detectBeats(flux: Float32Array, fps: number): Uint8Array {
  const n = flux.length;
  const beat = new Uint8Array(n);
  const win = Math.round(fps * 0.5);
  const minGap = Math.round(fps * 0.25);
  let last = -minGap;
  for (let f = 1; f < n - 1; f++) {
    let mean = 0;
    let count = 0;
    for (let j = Math.max(0, f - win); j <= Math.min(n - 1, f + win); j++) {
      mean += flux[j];
      count++;
    }
    const threshold = (mean / count) * 1.5 + 0.01;
    const v = flux[f];
    if (v > threshold && v >= flux[f - 1] && v >= flux[f + 1] && f - last >= minGap) {
      beat[f] = Math.round(clamp01(v / threshold - 0.5) * 255) || 1;
      last = f;
    }
  }
  return beat;
}

function withEnergy(ft: FeatureTrack): FeatureTrack {
  const energy = new Float32Array(ft.frames);
  let acc = 0;
  for (let f = 0; f < ft.frames; f++) {
    acc += ft.level[f] / 255 / ft.fps;
    energy[f] = acc;
  }
  return { ...ft, energy };
}

// ---- sampling helpers used by the renderer ---------------------------------

export function frameAt(ft: FeatureTrack, t: number): number {
  return Math.max(0, Math.min(ft.frames - 1, Math.floor(t * ft.fps)));
}

/** How many frames of history a given decay needs before it fades below 2%. */
function lookback(decay: number): number {
  return decay <= 0 ? 0 : Math.min(30, Math.ceil(Math.log(0.02) / Math.log(decay)));
}

/** Spectrum with peak-hold decay, computed from history so any frame can be rendered directly. */
export function spectrumAt(ft: FeatureTrack, frame: number, decay: number, out: Float32Array) {
  const L = lookback(decay);
  for (let b = 0; b < ft.bands; b++) {
    let v = 0;
    let w = 1;
    for (let j = 0; j <= L && frame - j >= 0; j++) {
      v = Math.max(v, (ft.spectrum[(frame - j) * ft.bands + b] / 255) * w);
      w *= decay;
    }
    out[b] = v;
  }
}

export function levelAt(ft: FeatureTrack, frame: number, decay = 0.8): number {
  const L = lookback(decay);
  let v = 0;
  let w = 1;
  for (let j = 0; j <= L && frame - j >= 0; j++) {
    v = Math.max(v, (ft.level[frame - j] / 255) * w);
    w *= decay;
  }
  return v;
}

/** Beat envelope: 1 on the beat frame, decaying over ~10 frames. */
export function beatAt(ft: FeatureTrack, frame: number): number {
  let v = 0;
  let w = 1;
  for (let j = 0; j <= 10 && frame - j >= 0; j++) {
    v = Math.max(v, (ft.beat[frame - j] / 255) * w);
    w *= 0.78;
  }
  return v;
}

export function waveAt(ft: FeatureTrack, frame: number, out: Float32Array) {
  const off = frame * ft.waveSize;
  for (let i = 0; i < ft.waveSize; i++) out[i] = (ft.wave[off + i] - 128) / 127;
}

export function energyAt(ft: FeatureTrack, t: number): number {
  const x = t * ft.fps;
  const f = Math.max(0, Math.min(ft.frames - 1, Math.floor(x)));
  const g = Math.min(ft.frames - 1, f + 1);
  const fr = Math.max(0, Math.min(1, x - f));
  return ft.energy[f] * (1 - fr) + ft.energy[g] * fr;
}

// ---- .viz file format ------------------------------------------------------
// "VIZ1" | uint32 header length | header JSON | spectrum | wave | level | beat

export function serializeFeatures(ft: FeatureTrack): Blob {
  const { spectrum, wave, level, beat, energy: _energy, ...meta } = ft;
  const header = new TextEncoder().encode(JSON.stringify(meta));
  const prefix = new Uint8Array(8);
  prefix.set([86, 73, 90, 49]); // VIZ1
  new DataView(prefix.buffer).setUint32(4, header.length, true);
  return new Blob([prefix, header, spectrum, wave, level, beat], { type: 'application/octet-stream' });
}

export function parseFeatures(buf: ArrayBuffer): FeatureTrack {
  const bytes = new Uint8Array(buf);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'VIZ1') throw new Error('Not a .viz file');
  const hlen = new DataView(buf).getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hlen)));
  let o = 8 + hlen;
  const take = (n: number) => bytes.slice(o, (o += n));
  const spectrum = take(meta.frames * meta.bands);
  const wave = take(meta.frames * meta.waveSize);
  const level = take(meta.frames);
  const beat = take(meta.frames);
  return withEnergy({ ...meta, spectrum, wave, level, beat, energy: new Float32Array(0) });
}
