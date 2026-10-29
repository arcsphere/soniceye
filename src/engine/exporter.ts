// Offline MP4 export: renders every frame deterministically, encodes with WebCodecs
// (H.264 + AAC, falling back to Opus) and muxes into an MP4 in memory.

import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { resample } from './audio';
import type { FeatureTrack } from './analysis';
import { render, type Assets } from './renderer';
import { ASPECTS, type Template } from './types';

export interface ExportOptions {
  template: Template;
  assets: Assets;
  features: FeatureTrack;
  audio: AudioBuffer;
  /** background video to seek frame by frame, if the background is a video */
  bgVideo?: HTMLVideoElement;
  start?: number;
  end?: number;
  videoBitrate?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

const H264_CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028'];

async function pickVideoConfig(width: number, height: number, fps: number, bitrate: number): Promise<VideoEncoderConfig> {
  for (const codec of H264_CODECS) {
    const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: fps, avc: { format: 'avc' } };
    const res = await VideoEncoder.isConfigSupported(config);
    if (res.supported) return config;
  }
  throw new Error('This browser cannot encode H.264 with WebCodecs. Try Chrome or Edge.');
}

async function pickAudioConfig(buffer: AudioBuffer): Promise<{ config: AudioEncoderConfig; buffer: AudioBuffer; codec: 'aac' | 'opus' }> {
  const channels = Math.min(2, buffer.numberOfChannels);
  const aacRate = buffer.sampleRate === 44100 || buffer.sampleRate === 48000 ? buffer.sampleRate : 48000;
  const aac: AudioEncoderConfig = { codec: 'mp4a.40.2', sampleRate: aacRate, numberOfChannels: channels, bitrate: 192_000 };
  if ((await AudioEncoder.isConfigSupported(aac)).supported) {
    return { config: aac, buffer: await resample(buffer, aacRate), codec: 'aac' };
  }
  const opus: AudioEncoderConfig = { codec: 'opus', sampleRate: 48000, numberOfChannels: channels, bitrate: 160_000 };
  if ((await AudioEncoder.isConfigSupported(opus)).supported) {
    return { config: opus, buffer: await resample(buffer, 48000), codec: 'opus' };
  }
  throw new Error('This browser cannot encode AAC or Opus audio with WebCodecs.');
}

function seekVideo(v: HTMLVideoElement, t: number): Promise<void> {
  const target = v.duration ? t % v.duration : 0;
  if (Math.abs(v.currentTime - target) < 0.001 && v.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    v.addEventListener('seeked', () => resolve(), { once: true });
    v.currentTime = target;
  });
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
}

export async function exportMp4(opts: ExportOptions): Promise<Blob> {
  const { template, assets, features, signal } = opts;
  const { width, height } = ASPECTS[template.aspect];
  const fps = template.fps;
  const start = Math.max(0, opts.start ?? 0);
  const end = Math.min(features.duration, opts.end ?? features.duration);
  const total = Math.max(1, Math.round((end - start) * fps));

  const videoConfig = await pickVideoConfig(width, height, fps, opts.videoBitrate ?? 8_000_000);
  const audio = await pickAudioConfig(opts.audio);
  await document.fonts.ready;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height, frameRate: fps },
    audio: { codec: audio.codec, numberOfChannels: audio.config.numberOfChannels, sampleRate: audio.config.sampleRate },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let encodeError: unknown = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encodeError = e),
  });
  videoEncoder.configure(videoConfig);
  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => (encodeError = e),
  });
  audioEncoder.configure(audio.config);

  try {
    // audio: the selected range, in planar chunks
    const ab = audio.buffer;
    const sr = ab.sampleRate;
    const ch = audio.config.numberOfChannels;
    const a0 = Math.floor(start * sr);
    const a1 = Math.min(ab.length, Math.floor(end * sr));
    const CHUNK = 4096;
    for (let i = a0; i < a1; i += CHUNK) {
      const n = Math.min(CHUNK, a1 - i);
      const planar = new Float32Array(n * ch);
      for (let c = 0; c < ch; c++) planar.set(ab.getChannelData(Math.min(c, ab.numberOfChannels - 1)).subarray(i, i + n), c * n);
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate: sr,
        numberOfFrames: n,
        numberOfChannels: ch,
        timestamp: Math.round(((i - a0) / sr) * 1e6),
        data: planar,
      });
      audioEncoder.encode(data);
      data.close();
    }
    await audioEncoder.flush();

    // video
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    const frameDur = 1e6 / fps;
    for (let i = 0; i < total; i++) {
      checkAbort(signal);
      if (encodeError) throw encodeError;
      const t = start + i / fps;
      if (opts.bgVideo) await seekVideo(opts.bgVideo, t);
      render(ctx, template, assets, features, t);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameDur), duration: Math.round(frameDur) });
      videoEncoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (videoEncoder.encodeQueueSize > 6) {
        await new Promise((r) => setTimeout(r, 1));
      }
      if (i % 10 === 0) {
        opts.onProgress?.(i, total);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    await videoEncoder.flush();
    if (encodeError) throw encodeError;
    muxer.finalize();
    opts.onProgress?.(total, total);
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    if (videoEncoder.state !== 'closed') videoEncoder.close();
    if (audioEncoder.state !== 'closed') audioEncoder.close();
  }
}
