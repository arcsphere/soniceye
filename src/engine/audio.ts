// Audio helpers: decoding, resampling, WAV encoding and a synthesized demo track.

let sharedCtx: AudioContext | null = null;

export async function decodeAudio(data: ArrayBuffer): Promise<AudioBuffer> {
  sharedCtx ??= new AudioContext();
  return sharedCtx.decodeAudioData(data);
}

export async function resample(buffer: AudioBuffer, rate: number): Promise<AudioBuffer> {
  if (buffer.sampleRate === rate) return buffer;
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, Math.ceil(buffer.duration * rate), rate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}

/** 16-bit PCM WAV, used to play synthesized audio through an <audio> element. */
export function encodeWav(buffer: AudioBuffer): Blob {
  const ch = buffer.numberOfChannels;
  const n = buffer.length;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  out.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, buffer.sampleRate, true);
  out.setUint32(28, buffer.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, n * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      out.setInt16(o, s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([out.buffer], { type: 'audio/wav' });
}

/** A ~24 second 120 bpm loop (kick, hats, bass, pad) so the app works without any files. */
export async function synthDemoTrack(seconds = 24): Promise<AudioBuffer> {
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, sr * seconds, sr);
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);

  const noise = ctx.createBuffer(1, sr, sr);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const beat = 0.5;
  const bassNotes = [55, 55, 65.41, 49];
  const chords = [
    [220, 261.63, 329.63],
    [196, 246.94, 293.66],
    [174.61, 220, 261.63],
    [196, 246.94, 329.63],
  ];

  for (let t = 0, i = 0; t < seconds; t += beat, i++) {
    // kick
    const k = ctx.createOscillator();
    const kg = ctx.createGain();
    k.frequency.setValueAtTime(130, t);
    k.frequency.exponentialRampToValueAtTime(42, t + 0.15);
    kg.gain.setValueAtTime(1, t);
    kg.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    k.connect(kg).connect(master);
    k.start(t);
    k.stop(t + 0.45);

    // off-beat hat
    const h = ctx.createBufferSource();
    h.buffer = noise;
    const hf = ctx.createBiquadFilter();
    hf.type = 'highpass';
    hf.frequency.value = 7000;
    const hg = ctx.createGain();
    const ht = t + beat / 2;
    hg.gain.setValueAtTime(0.25, ht);
    hg.gain.exponentialRampToValueAtTime(0.001, ht + 0.08);
    h.connect(hf).connect(hg).connect(master);
    h.start(ht);
    h.stop(ht + 0.1);

    // bass, one note per beat, chord changes every bar
    const bar = Math.floor(i / 4) % 4;
    const b = ctx.createOscillator();
    b.type = 'sawtooth';
    b.frequency.value = bassNotes[bar];
    const bf = ctx.createBiquadFilter();
    bf.type = 'lowpass';
    bf.frequency.setValueAtTime(900, t);
    bf.frequency.exponentialRampToValueAtTime(200, t + 0.4);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.35, t);
    bg.gain.exponentialRampToValueAtTime(0.01, t + 0.45);
    b.connect(bf).connect(bg).connect(master);
    b.start(t);
    b.stop(t + 0.5);

    if (i % 4 === 0) {
      for (const f of chords[bar]) {
        for (const detune of [-8, 8]) {
          const p = ctx.createOscillator();
          p.type = 'sawtooth';
          p.frequency.value = f;
          p.detune.value = detune;
          const pf = ctx.createBiquadFilter();
          pf.type = 'lowpass';
          pf.frequency.value = 1800;
          const pg = ctx.createGain();
          pg.gain.setValueAtTime(0, t);
          pg.gain.linearRampToValueAtTime(0.03, t + 0.3);
          pg.gain.linearRampToValueAtTime(0, t + beat * 4);
          p.connect(pf).connect(pg).connect(master);
          p.start(t);
          p.stop(t + beat * 4);
        }
      }
    }
  }
  return ctx.startRendering();
}

/** Procedural cover art for the demo. */
export function makeDemoArt(size = 1000): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#ff6a3d');
  bg.addColorStop(0.5, '#c2185b');
  bg.addColorStop(1, '#311b92');
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'screen';
  for (let i = 0; i < 9; i++) {
    g.beginPath();
    g.arc(size * 0.5, size * 0.62, size * (0.08 + i * 0.05), 0, Math.PI * 2);
    g.strokeStyle = `rgba(255,220,180,${0.5 - i * 0.05})`;
    g.lineWidth = size * 0.006;
    g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#fff';
  g.font = `800 ${size * 0.11}px Montserrat, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillText('DEMO', size / 2, size * 0.25);
  g.font = `500 ${size * 0.04}px Montserrat, system-ui, sans-serif`;
  g.fillText('synthesized loop', size / 2, size * 0.32);
  return c;
}
