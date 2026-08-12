"use client";
// Dev-only harness. Runs the REAL frame pipeline at Pro resolution and reports
// ms/frame, so "it looks better" can be checked against the 33ms budget instead
// of guessed at.
import { useEffect, useRef, useState } from "react";
import { notFound } from "next/navigation";
import { buildEDL, drawShot, drawText, drawMotionOnly, drawFeatureAnim, pickAnim, lightLeak, letterbox, brandBar, type Script } from "../studio/engine";
import { camera, applyCam, particles, bloom, grade, chroma, hud, drawEndCardPro } from "../studio/motion";
import { makeEncoder } from "../studio/encode";

const SCRIPT: Script = {
  hook: "Your workday just got 3x faster",
  scenes: [
    { t: 3.2, headline: "Stop wasting hours on admin", sub: "Built for small teams", vo: "x", fx: "" },
    { t: 3.4, headline: "One click and it's done", sub: "No setup, no training", vo: "x", fx: "" },
    { t: 3.2, headline: "Save 12 hours a week", sub: "From $9 a month", vo: "x", fx: "" },
    { t: 3.2, headline: "Try it free today", sub: "Cancel anytime", vo: "x", fx: "" },
  ],
  cta: "Start free →",
  endline: "The ad builder that actually edits",
  palette: { a: "#7fe3ff", b: "#c08bff" },
  duration: 15,
};

export default function Bench() {
  const isProd = process.env.NODE_ENV === "production";
  const ref = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLCanvasElement>(null);
  const [out, setOut] = useState("idle");

  useEffect(() => {
    if (isProd) return;
    (window as any).runBench = (frames = 240, withFootage = true, F: Record<string, boolean> = {}) => {
      const on = (k: string) => F[k] !== false;
      const W = 1080, H = 1920;
      const cv = ref.current!; cv.width = W; cv.height = H;
      const g = cv.getContext("2d", { alpha: false })!;
      const blurCv = document.createElement("canvas"); blurCv.width = 40; blurCv.height = 71;

      // stand-in for footage: a canvas with real detail, quacking like a video
      const fake = document.createElement("canvas"); fake.width = 1920; fake.height = 1080;
      const fx = fake.getContext("2d")!;
      fx.fillStyle = "#12203f"; fx.fillRect(0, 0, 1920, 1080);
      for (let i = 0; i < 400; i++) {
        fx.fillStyle = `hsl(${(i * 7) % 360} 70% ${30 + (i % 40)}%)`;
        fx.fillRect((i * 137) % 1920, (i * 79) % 1080, 60, 22);
      }
      Object.defineProperty(fake, "videoWidth", { value: 1920 });
      Object.defineProperty(fake, "videoHeight", { value: 1080 });
      Object.defineProperty(fake, "paused", { value: false });
      const vid = fake as unknown as HTMLVideoElement;

      const an = { times: [0, 1, 2, 3, 4], scores: [5, 40, 12, 30, 8], duration: 12 };
      const shots = buildEDL(SCRIPT, an, true);
      const starts: number[] = []; let acc = 0;
      SCRIPT.scenes.forEach(s => { starts.push(acc); acc += s.t; });
      const A = SCRIPT.palette.a, B = SCRIPT.palette.b;

      const one = (el: number) => {
        g.fillStyle = "#04060f"; g.fillRect(0, 0, W, H);
        if (el > acc) { drawEndCardPro(g, W, H, "Northwind", SCRIPT.cta, SCRIPT.endline, "northwind.com", Math.min(1, (el - acc) / 2.6), A, B, el); }
        else {
          const si = Math.max(0, starts.findIndex((st, i) => el >= st && el < st + SCRIPT.scenes[i].t));
          const sc = SCRIPT.scenes[si];
          const lc = el - starts[si];
          let shot = shots[0], cutLocal = lc, cutDur = sc.t;
          if (withFootage) {
            let idx = 0;
            for (let i = 0; i < shots.length; i++) if (el >= shots[i].start) idx = i;
            shot = shots[idx]; cutLocal = el - shot.start; cutDur = shot.dur;
          }
          g.save();
          if (on("cam")) applyCam(g, W, H, camera(el, cutLocal, cutDur, 1));
          if (withFootage) drawShot({ g, W, H, vid, blurCv, shot, local: cutLocal, A, B });
          else {
            drawMotionOnly(g, W, H, sc, lc, lc / sc.t, A, B, si, []);
            drawFeatureAnim(g, W, H, pickAnim(sc.headline, si), lc, lc / sc.t, A, B);
          }
          g.restore();
          if (on("particles")) particles(g, W, H, el, A, B, 0.85);
          if (on("bloom")) bloom(g, cv, W, H, 0.26);
          if (on("grade")) grade(g, W, H, A, B, 0.32);
          if (on("text")) drawText(g, W, H, sc, lc, A, B);
          if (on("leak")) lightLeak(g, W, H, el, A);
          if (on("hud")) hud(g, W, H, el, A, B, si, SCRIPT.scenes.length);
          if (on("chroma")) chroma(g, cv, W, H, Math.exp(-cutLocal * 12));
        }
        letterbox(g, W, H, Math.min(1, el / 0.5));
        if (el <= acc) brandBar(g, W, H, "Northwind", el, acc + 2.6, A, B);
      };

      (window as any).__one = one; (window as any).__cv = cv; (window as any).__total = acc + 2.6;
      // warm up (first frames build every cached canvas)
      for (let i = 0; i < 20; i++) one(i / 30);
      g.getImageData(0, 0, 1, 1);

      // Flush after EVERY frame. Without this the driver batches work across
      // frames and you measure JS dispatch, not the actual per-frame cost —
      // which is how you end up "optimising" something into being slower.
      const TOTAL = acc + 2.6;
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) { one((i / frames) * TOTAL); g.getImageData(0, 0, 1, 1); }
      const ms = (performance.now() - t0) / frames;
      const res = `${ms.toFixed(2)} ms/frame  →  ${(1000 / ms).toFixed(0)} fps  (budget 33.3ms)`;
      setOut(res);
      return res;
    };

    // Contact sheet of key moments, so the look can be eyeballed without
    // sitting through a render.
    (window as any).strip = (times: number[]) => {
      const one = (window as any).__one, src = (window as any).__cv as HTMLCanvasElement;
      if (!one) return "run runBench first";
      const cols = times.length, cw = 300, ch = Math.round((src.height / src.width) * cw);
      const s = stripRef.current!; s.width = cols * cw; s.height = ch;
      const sx = s.getContext("2d")!;
      sx.fillStyle = "#000"; sx.fillRect(0, 0, s.width, s.height);
      times.forEach((t, i) => { one(t); sx.drawImage(src, i * cw, 0, cw, ch); });
      return `${cols} frames @ ${times.join(", ")}s`;
    };

    // Encoder round-trip: a short render through the real encoder, then walk the
    // resulting MP4's boxes. Far faster than sitting through a full ad each time.
    (window as any).testEncode = async (secs = 3, W = 720, H = 1280) => {
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const g = cv.getContext("2d", { alpha: false })!;
      const ac = new AudioContext();
      const mix = ac.createGain();
      const osc = ac.createOscillator(); osc.frequency.value = 220;
      const gn = ac.createGain(); gn.gain.value = 0.2;
      osc.connect(gn); gn.connect(mix); osc.start();
      await ac.resume();

      const enc = await makeEncoder({ cv, W, H, fps: 30, bitrate: 4_000_000, ac, mix });
      const t0 = performance.now();
      let n = 0;
      while ((performance.now() - t0) / 1000 < secs) {
        const t = (performance.now() - t0) / 1000;
        g.fillStyle = `hsl(${(t * 90) % 360} 70% 45%)`; g.fillRect(0, 0, W, H);
        g.fillStyle = "#fff"; g.font = "900 90px sans-serif"; g.fillText("T" + n, 60, 640);
        enc.addFrame(t); n++;
        await new Promise(r => setTimeout(r, 33));
      }
      const blob = await enc.finish();
      osc.stop(); await ac.close();

      // walk top-level boxes + sample tables
      const buf = new Uint8Array(await blob.arrayBuffer());
      const dv = new DataView(buf.buffer);
      const s4 = (o: number) => String.fromCharCode(...buf.slice(o, o + 4));
      const top: string[] = []; let o = 0;
      while (o + 8 <= buf.length && top.length < 40) {
        let size = dv.getUint32(o); const type = s4(o + 4);
        if (size === 1) size = Number(dv.getBigUint64(o + 8));
        if (size === 0) size = buf.length - o;
        if (size < 8) break;
        top.push(type); o += size;
      }
      const res = {
        kind: enc.kind, mime: enc.mime, bytes: blob.size, framesSent: n,
        boxes: top, fragmented: top.includes("moof"),
        moovBeforeMdat: top.indexOf("moov") >= 0 && top.indexOf("mdat") >= 0 && top.indexOf("moov") < top.indexOf("mdat"),
        stats: (globalThis as any).__adfEnc,
      };
      (window as any).__enc = res;
      (window as any).__encBlob = blob;
      setOut(JSON.stringify(res));
      return res;
    };
  }, [isProd]);

  // dev harness only — never expose this on the live site
  if (isProd) notFound();

  return (
    <div style={{ padding: 24, color: "#dbe6ff", background: "#04060f", minHeight: "100vh", fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 20 }}>AdForge frame benchmark</h1>
      <p id="bench-out" style={{ fontFamily: "monospace" }}>{out}</p>
      <canvas ref={ref} style={{ width: 240, border: "1px solid #234" }} />
      <canvas ref={stripRef} id="strip" style={{ width: "100%", marginTop: 16, border: "1px solid #234" }} />
    </div>
  );
}
