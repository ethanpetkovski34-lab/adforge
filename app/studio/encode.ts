// Video encoding.
//
// MediaRecorder's mp4 output is a FRAGMENTED mp4: its moov carries empty sample
// tables (stts/stsc/stsz/stco all zero) plus an mvex box, and every real sample
// lives in moof/mdat fragments. Desktop players reconstruct that happily, but
// iOS Photos sees a movie with no samples and refuses to import it — the file
// lands in Files as a document instead of saving as a video, and social
// uploaders reject it for the same reason.
//
// So we encode with WebCodecs and mux with mp4-muxer, which writes a normal
// progressive mp4: populated sample tables, moov placed before mdat (fastStart)
// so it plays while downloading. MediaRecorder stays as a fallback for browsers
// without WebCodecs.

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export type Encoder = {
  kind: 'webcodecs' | 'mediarecorder';
  mime: string;
  /** Hand over one finished frame. `tSec` is its position in the ad. */
  addFrame(tSec: number): void;
  finish(): Promise<Blob>;
};

type Opts = {
  cv: HTMLCanvasElement;
  W: number; H: number;
  fps: number;
  bitrate: number;
  ac: AudioContext;
  mix: AudioNode;        // the narration bus
};

const AAC = 'mp4a.40.2';

/** H.264 level has to cover the frame size — 1080x1920 needs 4.0, not 3.1. */
function avcCodec(W: number, H: number) {
  const mb = Math.ceil(W / 16) * Math.ceil(H / 16);
  return mb > 3600 ? 'avc1.4D0028' : 'avc1.42001f';
}

async function tryWebCodecs(o: Opts): Promise<Encoder | null> {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') return null;
  const codec = avcCodec(o.W, o.H);
  try {
    const v = await VideoEncoder.isConfigSupported({
      codec, width: o.W, height: o.H, bitrate: o.bitrate, framerate: o.fps,
    });
    const a = await AudioEncoder.isConfigSupported({
      codec: AAC, sampleRate: o.ac.sampleRate, numberOfChannels: 2, bitrate: 128000,
    });
    if (!v.supported || !a.supported) return null;
  } catch { return null; }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: o.W, height: o.H, frameRate: o.fps },
    audio: { codec: 'aac', sampleRate: o.ac.sampleRate, numberOfChannels: 2 },
    // moov at the FRONT — this is what makes it a normal, streamable mp4
    fastStart: 'in-memory',
    // The first drawn frame lands a few ms after zero, never exactly on it, and
    // the muxer rejects a track whose first chunk isn't at 0 — which silently
    // threw away every video chunk and left the file with no video track at all.
    firstTimestampBehavior: 'offset',
  });

  let failed = '';
  const stats = { encoded: 0, vChunks: 0, aChunks: 0, gotVideoConfig: false, gotAudioConfig: false, errs: [] as string[] };
  (globalThis as any).__adfEnc = stats;
  const note = (e: unknown) => { const s = String(e); if (stats.errs.length < 6 && !stats.errs.includes(s)) stats.errs.push(s); };

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      stats.vChunks++;
      if (meta?.decoderConfig) stats.gotVideoConfig = true;
      try { muxer.addVideoChunk(chunk, meta); } catch (e) { note('mux video: ' + e); }
    },
    error: e => { failed = String(e); note('venc: ' + e); },
  });
  videoEncoder.configure({
    codec, width: o.W, height: o.H, bitrate: o.bitrate, framerate: o.fps,
    latencyMode: 'quality',
  });

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => {
      stats.aChunks++;
      if (meta?.decoderConfig) stats.gotAudioConfig = true;
      try { muxer.addAudioChunk(chunk, meta); } catch (e) { note('mux audio: ' + e); }
    },
    error: e => { failed = String(e); note('aenc: ' + e); },
  });
  audioEncoder.configure({
    codec: AAC, sampleRate: o.ac.sampleRate, numberOfChannels: 2, bitrate: 128000,
  });

  // Tap the narration bus for raw PCM. A ScriptProcessorNode keeps running when
  // the tab is hidden, which is exactly why the render clock uses one too.
  const BUF = 4096;
  const capture = o.ac.createScriptProcessor(BUF, 2, 2);
  const silent = o.ac.createGain();
  silent.gain.value = 0;
  o.mix.connect(capture);
  capture.connect(silent);
  silent.connect(o.ac.destination);

  let audioSamples = 0;   // exact audio clock, independent of wall time
  capture.onaudioprocess = e => {
    const inBuf = e.inputBuffer;
    const n = inBuf.length;
    // f32-planar wants each channel laid end to end, not interleaved
    const planar = new Float32Array(n * 2);
    planar.set(inBuf.getChannelData(0), 0);
    planar.set(inBuf.numberOfChannels > 1 ? inBuf.getChannelData(1) : inBuf.getChannelData(0), n);
    try {
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate: inBuf.sampleRate,
        numberOfFrames: n,
        numberOfChannels: 2,
        timestamp: Math.round((audioSamples / inBuf.sampleRate) * 1e6),
        data: planar,
      });
      audioEncoder.encode(data);
      data.close();
    } catch {}
    audioSamples += n;
  };

  let frames = 0;
  let dropped = 0;
  const keyEvery = o.fps * 2;

  return {
    kind: 'webcodecs',
    mime: 'video/mp4',
    addFrame(tSec: number) {
      // Never let the encoder queue run away and eat memory.
      if (videoEncoder.encodeQueueSize > 30) { dropped++; return; }
      try {
        const frame = new VideoFrame(o.cv, {
          timestamp: Math.round(tSec * 1e6),
          duration: Math.round(1e6 / o.fps),
        });
        videoEncoder.encode(frame, { keyFrame: frames % keyEvery === 0 });
        frame.close();
        frames++;
        stats.encoded = frames;
      } catch (e) { note('frame: ' + e); }
    },
    async finish() {
      try { capture.onaudioprocess = null; capture.disconnect(); silent.disconnect(); } catch {}
      await videoEncoder.flush();
      await audioEncoder.flush();
      videoEncoder.close();
      audioEncoder.close();
      if (dropped) console.warn(`AdForge: encoder fell behind, dropped ${dropped} frames`);
      if (failed) console.warn('AdForge: encoder reported', failed);
      // Don't hand back a file with no video in it — say so instead.
      if (!stats.vChunks || !stats.gotVideoConfig) {
        throw new Error('Video encoding produced no frames' + (stats.errs.length ? ` (${stats.errs[0]})` : ''));
      }
      muxer.finalize();
      const { buffer } = muxer.target as ArrayBufferTarget;
      return new Blob([buffer], { type: 'video/mp4' });
    },
  };
}

/** Fallback: the old MediaRecorder path. Produces a fragmented mp4 (or webm). */
function mediaRecorderEncoder(o: Opts): Encoder {
  const dest = o.ac.createMediaStreamDestination();
  o.mix.connect(dest);

  let vStream = (o.cv as any).captureStream(0) as MediaStream;
  let vTrack = vStream.getVideoTracks()[0] as any;
  const manual = !!vTrack && typeof vTrack.requestFrame === 'function';
  if (!manual) {
    vStream = (o.cv as any).captureStream(o.fps) as MediaStream;
    vTrack = vStream.getVideoTracks()[0];
  }

  const mime = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm',
  ].find(m => MediaRecorder.isTypeSupported(m)) || '';

  const mixed = new MediaStream([...vStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(mixed, mime ? { mimeType: mime, videoBitsPerSecond: o.bitrate } : undefined);
  const parts: Blob[] = [];
  rec.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
  const stopped = new Promise<void>(res => { rec.onstop = () => res(); });
  rec.start();

  const outMime = (rec.mimeType || mime || 'video/webm').split(';')[0];
  return {
    kind: 'mediarecorder',
    mime: outMime,
    addFrame() { if (manual) { try { vTrack.requestFrame(); } catch {} } },
    async finish() {
      try { rec.stop(); } catch {}
      await stopped;
      return new Blob(parts, { type: outMime });
    },
  };
}

export async function makeEncoder(o: Opts): Promise<Encoder> {
  return (await tryWebCodecs(o)) || mediaRecorderEncoder(o);
}
