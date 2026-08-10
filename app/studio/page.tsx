"use client";
import { useEffect, useRef, useState } from "react";
import { CHECKOUT_URL, isLive } from "../checkout";
import { saveAd, listAds, deleteAd, clearAds, makeThumb, prettySize, prettyDate, type SavedAd } from "./library";
import { analyseFootage, buildEDL, drawShot, drawText, drawMotionOnly, drawFeatureAnim, pickAnim, lightLeak, letterbox, brandBar, type Script as EScript } from "./engine";
import { camera, applyCam, particles, bloom, grade, chroma, hud, drawEndCardPro } from "./motion";

type Script = EScript;

const VIBES = ["Bold & modern", "Cinematic", "Playful", "Premium & minimal", "High energy"];
const VOICES: [string, string][] = [
  ["cinematic", "Cinematic — deep trailer voice"],
  ["hype", "Hype — fast and punchy"],
  ["warm", "Warm — friendly and human"],
  ["premium", "Premium — calm and expensive"],
];
const PRO_CODE = "FORGE-PRO-e7Zk9Qp2";

export default function Studio() {
  const [step, setStep] = useState(1);
  const [pro, setPro] = useState(false);
  const [siteUrl, setSiteUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<{ features: string[]; pricing: string; images: string[]; brand: string[] } | null>(null);
  const [colA, setColA] = useState("");
  const [colB, setColB] = useState("");
  const [product, setProduct] = useState("");
  const [what, setWhat] = useState("");
  const [audience, setAudience] = useState("");
  const [vibe, setVibe] = useState(VIBES[0]);
  const [duration, setDuration] = useState(15);
  const [voice, setVoice] = useState("cinematic");
  const [voSpeed, setVoSpeed] = useState(1.1);
  const [script, setScript] = useState<Script | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [clipUrl, setClipUrl] = useState("");
  const [progress, setProgress] = useState(0);
  const [outUrl, setOutUrl] = useState("");
  const [outBlob, setOutBlob] = useState<Blob | null>(null);
  const [library, setLibrary] = useState<SavedAd[]>([]);
  const [showLib, setShowLib] = useState(false);
  const [playing, setPlaying] = useState<string>("");
  const [showPay, setShowPay] = useState(false);
  const [code, setCode] = useState("");
  const [previewing, setPreviewing] = useState(-1);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    try {
      const u = new URLSearchParams(location.search);
      if (u.get("unlock") === PRO_CODE) { localStorage.setItem("adforge-pro", "1"); history.replaceState({}, "", location.pathname); }
      setPro(localStorage.getItem("adforge-pro") === "1");
      if (u.get("upgrade")) setShowPay(true);
    } catch {}
    listAds().then(setLibrary);
  }, []);

  // ---------- 0. Read their website and fill the brief in for them ----------
  async function scanSite() {
    if (!siteUrl.trim()) { setErr("Paste your website link first."); return; }
    setErr(""); setScanning(true); setScanned(null);
    try {
      const r = await fetch("/api/scan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: siteUrl }),
      });
      const d = await r.json();
      if (d.error) { setErr(d.error); setScanning(false); return; }
      const i = d.info;
      setProduct(i.product || ""); setWhat(i.what || ""); setAudience(i.audience || "");
      if (i.tone) setVibe(i.tone);
      setScanned({ features: i.features || [], pricing: i.pricing || "", images: i.images || [], brand: i.brand || [] });
      if (i.brand?.[0]) setColA(i.brand[0]);
      if (i.brand?.[1]) setColB(i.brand[1]);
    } catch { setErr("Couldn't read that site. Fill it in yourself and carry on."); }
    setScanning(false);
  }

  // ---------- 1. AI writes the ad ----------
  async function writeScript() {
    if (!product.trim() || !what.trim()) { setErr("Tell me the product name and what it does."); return; }
    setErr(""); setBusy("Writing your ad…");
    try {
      const r = await fetch("/api/script", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product, what, audience, vibe, duration, features: scanned?.features || [], pricing: scanned?.pricing || "" }),
      });
      const d = await r.json();
      if (!r.ok || !d.script) throw new Error(d.error || "Could not write the script");
      // whatever the customer picked (or we read off their site) beats the AI's guess
      if (colA) d.script.palette.a = colA;
      if (colB) d.script.palette.b = colB;
      setScript(d.script); setStep(2);
    } catch (e: any) { setErr(e.message || "Something went wrong"); }
    setBusy("");
  }

  // Hear a line before you commit to a full render
  async function previewVo(i: number) {
    if (!script || previewing >= 0) return;
    setPreviewing(i); setErr("");
    try {
      const r = await fetch("/api/voice", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: script.scenes[i].vo, style: voice, pro }),
      });
      if (!r.ok) throw new Error("voice unavailable");
      const url = URL.createObjectURL(new Blob([await r.arrayBuffer()], { type: "audio/mpeg" }));
      const a = new Audio(url);
      a.playbackRate = voSpeed;
      a.onended = () => { URL.revokeObjectURL(url); setPreviewing(-1); };
      a.onerror = () => { URL.revokeObjectURL(url); setPreviewing(-1); };
      await a.play();
    } catch {
      setErr("Couldn't play that line — try again.");
      setPreviewing(-1);
    }
  }

  // ---------- 2. Footage: upload a file, or skip it entirely ----------
  async function onUpload(e: any) {
    const f = e.target.files?.[0]; if (!f) return;
    setClipUrl(u => { if (u) URL.revokeObjectURL(u); return URL.createObjectURL(f); });
  }

  // Downloading a blob via <a href> silently does nothing in the desktop app and
  // fails quietly on an empty render, so do it explicitly and say what happened.
  function downloadAd() {
    if (!outBlob || outBlob.size < 1000) {
      setErr("There's no finished video to download — forge the ad again.");
      return;
    }
    const name = `${(product || "ad").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ad"}-adforge.webm`;
    try {
      const url = URL.createObjectURL(outBlob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 4000);
      setErr("");
    } catch {
      // last resort: open it so they can right-click → Save
      try { window.open(outUrl, "_blank"); } catch {}
      setErr("If the download didn't start, right-click the video above and choose Save Video As.");
    }
  }

  function downloadSaved(ad: SavedAd) {
    try {
      const url = URL.createObjectURL(ad.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${ad.product.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ad"}-adforge.webm`;
      document.body.appendChild(a); a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 4000);
    } catch {}
  }
  async function removeAd(ad: SavedAd) {
    if (!confirm(`Delete this ad for "${ad.product}"? This can't be undone.`)) return;
    await deleteAd(ad.id);
    setLibrary(await listAds());
    if (playing === ad.id) setPlaying("");
  }
  async function removeAll() {
    if (!confirm(`Delete all ${library.length} saved ads? This can't be undone.`)) return;
    await clearAds();
    setLibrary([]); setPlaying("");
  }

  // ---------- 3. Forge the ad — analyse, cut, then render ----------
  async function render() {
    if (!script) return;
    try { await renderInner(); }
    catch (e: any) {
      console.error("AdForge render failed:", e);
      setErr("Render failed: " + (e?.message || e));
      setBusy(""); setProgress(0);
    }
  }

  async function renderInner() {
    if (!script) return;
    const noFootage = !clipUrl;
    setErr(""); setOutUrl(""); setProgress(0);

    const W = pro ? 1080 : 720, H = pro ? 1920 : 1280;
    const cv = canvasRef.current!; cv.width = W; cv.height = H;
    const g = cv.getContext("2d", { alpha: false })!;
    const blurCv = document.createElement("canvas"); blurCv.width = 40; blurCv.height = 71;
    // Grain is baked once into a tile and stamped at a random offset each frame.
    // Drawing ~70 random rects per frame was real render cost for a subtle effect.
    const grainCv = document.createElement("canvas"); grainCv.width = 256; grainCv.height = 256;
    (() => {
      const gx = grainCv.getContext("2d")!;
      const img = gx.createImageData(256, 256);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = Math.random() < 0.16 ? 40 : 0;
      }
      gx.putImageData(img, 0, 0);
    })();

    // --- narration (all lines at once — one at a time was the slowest part) ---
    setBusy("Recording narration…");
    const ac = new AudioContext();
    let voDone = 0;
    const bufs: (AudioBuffer | null)[] = await Promise.all(
      script.scenes.map(async (sc) => {
        try {
          const r = await fetch("/api/voice", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: sc.vo, style: voice, pro }),
          });
          if (!r.ok) return null;
          const buf = await ac.decodeAudioData(await r.arrayBuffer()).catch(() => null);
          return buf;
        } catch { return null; }
        finally {
          voDone++;
          setBusy(`Recording narration… ${voDone}/${script.scenes.length}`);
        }
      })
    );
    if (bufs.every(b => !b)) {
      // no voice at all — tell them rather than silently shipping a mute ad
      setErr("Narration failed — your ad will render without a voiceover.");
    }

    // --- footage + the edit ---
    let vid: HTMLVideoElement | null = null;
    let shots: ReturnType<typeof buildEDL> = [];
    const imgs: HTMLImageElement[] = [];

    if (!noFootage) {
      vid = document.createElement("video");
      vid.src = clipUrl; vid.muted = true; vid.playsInline = true; (vid as any).preload = "auto";
      videoRef.current = vid;
      await new Promise<void>(res => {
        vid!.onloadedmetadata = () => res(); vid!.onerror = () => res(); setTimeout(res, 6000);
      });
      setBusy("Watching your footage…");
      const an = await analyseFootage(vid, p => setProgress(Math.round(p * 100)));
      setBusy("Cutting the edit…");
      shots = buildEDL(script, an, /energy|playful|bold/i.test(vibe));
      // Single seek to the best moment, fully settled before we start recording.
      const v0 = vid!;
      v0.loop = true;
      try {
        const target = shots[0]?.srcIn || 0;
        if (target > 0.05) {
          await new Promise<void>(res => {
            let done = false; const fin = () => { if (done) return; done = true; res(); };
            v0.onseeked = fin; v0.currentTime = target; setTimeout(fin, 1500);
          });
        }
        await v0.play();
      } catch {}
    } else {
      // no footage: use real images off their site
      const urls = (scanned?.images || []).slice(0, 5);
      await Promise.all(urls.map(u => new Promise<void>(res => {
        const im = new Image(); im.crossOrigin = "anonymous";
        im.onload = () => { imgs.push(im); res(); };
        im.onerror = () => res();
        im.src = u; setTimeout(res, 5000);
      })));
    }

    setBusy("Forging your ad…"); setProgress(0);

    // --- mix audio + canvas into one recording ---
    const dest = ac.createMediaStreamDestination();
    const vStream = (cv as any).captureStream(30) as MediaStream;
    const mixed = new MediaStream([...vStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find(m => MediaRecorder.isTypeSupported(m)) || "";
    const rec = new MediaRecorder(mixed, mime ? { mimeType: mime, videoBitsPerSecond: pro ? 6_500_000 : 4_000_000 } : undefined);
    const out: Blob[] = [];
    rec.ondataavailable = e => { if (e.data.size) out.push(e.data); };

    const A = script.palette.a, B = script.palette.b;
    const punchy = /energy|playful|bold/i.test(vibe);
    let domain = "";
    try { if (siteUrl.trim()) domain = new URL(/^https?:\/\//i.test(siteUrl) ? siteUrl : "https://" + siteUrl).hostname.replace(/^www\./, ""); } catch {}
    const starts: number[] = []; let acc = 0;
    script.scenes.forEach(sc => { starts.push(acc); acc += sc.t; });
    const TOTAL = acc + 2.6;

    const done = new Promise<void>(res => { rec.onstop = () => res(); });
    rec.start();
    try { if (ac.state === "suspended") await Promise.race([ac.resume(), new Promise(r => setTimeout(r, 1200))]); } catch {}
    bufs.forEach((b, i) => {
      if (!b) return;
      const src = ac.createBufferSource(); src.buffer = b;
      src.playbackRate.value = voSpeed;   // keeps the natural voice, just paced
      src.connect(dest); src.start(ac.currentTime + starts[i] + 0.1);
    });

    let shotIdx = -1;
    let frameNo = 0;
    const t0 = performance.now();

    let clock: ScriptProcessorNode | null = null;
    await new Promise<void>(finish => {
      let stopped = false;
      let lastEl = -1;
      const STEP = 1 / 30;

      const frame = (el: number) => {
        try {
        g.fillStyle = "#04060f"; g.fillRect(0, 0, W, H);

        if (el > acc) {
          drawEndCardPro(g, W, H, product, script.cta, script.endline, domain, Math.min(1, (el - acc) / 2.6), A, B, el);
        }
        else {
          const si = Math.max(0, starts.findIndex((st, i) => el >= st && el < st + script.scenes[i].t));
          const sc = script.scenes[si];
          const lc = el - starts[si];

          // Work out where we are in the current SHOT first — the camera, the
          // impact shake and the chromatic punch all key off the cut, not the scene.
          let shot = shots[0];
          let cutLocal = lc, cutDur = sc.t;
          if (!noFootage && shots.length) {
            let idx = 0;
            for (let i = 0; i < shots.length; i++) if (el >= shots[i].start) idx = i;
            shot = shots[idx];
            cutLocal = el - shot.start; cutDur = shot.dur;
            if (idx !== shotIdx) {
              shotIdx = idx;
              // NOTE: deliberately NO seek here. Setting currentTime mid-render
              // stalls video decoding for 100-300ms and drawImage returns stale
              // frames — that was the stutter. The clip plays straight through
              // and each cut changes the FRAMING instead, which still reads as
              // an edit and stays perfectly smooth.
              try { if (vid && vid.paused) vid.play(); } catch {}
            }
          }

          // everything visual lives under one virtual camera: handheld drift,
          // a slow push, and a hard shake on every cut
          const cam = camera(el, cutLocal, cutDur, punchy ? 1 : 0.6);
          g.save();
          applyCam(g, W, H, cam);
          if (noFootage) {
            // background wash + light bands, then an ANIMATED MOCK-UP of the feature
            drawMotionOnly(g, W, H, sc, lc, lc / sc.t, A, B, si, imgs);
            if (!imgs.length) drawFeatureAnim(g, W, H, pickAnim(sc.headline + " " + sc.sub + " " + sc.vo, si), lc, lc / sc.t, A, B);
          } else if (vid) {
            drawShot({ g, W, H, vid, blurCv, shot, local: cutLocal, A, B });
          }
          g.restore();

          // depth: drifting specks in front of the footage, behind the type
          particles(g, W, H, el, A, B, 0.85);
          // glow the highlights, then colour-grade the whole frame
          bloom(g, cv, W, H, 0.26);
          grade(g, W, H, A, B, 0.32);

          // type goes on top of the grade so it stays crisp and pure white
          drawText(g, W, H, sc, lc, A, B);
          lightLeak(g, W, H, el, A);
          hud(g, W, H, el, A, B, si, script.scenes.length);
          // RGB split for a few frames after each cut — free when it's not firing
          chroma(g, cv, W, H, Math.exp(-cutLocal * 12));
        }
        // cinematic bars ease in for the first half-second and stay
        letterbox(g, W, H, Math.min(1, el / 0.5));
        if (el <= acc) brandBar(g, W, H, product, el, TOTAL, A, B);
        } catch (e) { if (!(window as any).__adfErr) { (window as any).__adfErr = String(e); console.error("AdForge draw error:", e); } }

        // grain on alternate frames only — same look, half the cost
        frameNo++;
        if (frameNo % 2 === 0) {
        g.save();
        g.globalAlpha = 0.05;
        const gox = -Math.random() * 256, goy = -Math.random() * 256;
        for (let ty = goy; ty < H; ty += 256) for (let tx = gox; tx < W; tx += 256) g.drawImage(grainCv, tx, ty);
        g.restore();
        }

        // progress line
        g.fillStyle = "rgba(255,255,255,0.16)"; g.fillRect(0, H - 7, W, 7);
        const pg = g.createLinearGradient(0, 0, W, 0); pg.addColorStop(0, A); pg.addColorStop(1, B);
        g.fillStyle = pg; g.fillRect(0, H - 7, W * (el / TOTAL), 7);

        if (!pro) {
          g.globalAlpha = 0.5; g.textAlign = "right";
          g.font = `800 ${W * 0.028}px ui-sans-serif,system-ui,sans-serif`;
          g.fillStyle = "#fff"; g.fillText("◈ ADFORGE", W - W * 0.05, H * 0.055);
          g.globalAlpha = 1;
        }
      };

      const tick = () => {
        if (stopped) return;
        const el = (performance.now() - t0) / 1000;
        if (el >= TOTAL) { stopped = true; finish(); return; }
        if (el - lastEl < STEP * 0.85) return;   // don't draw faster than we capture
        lastEl = el;
        setProgress(Math.min(100, Math.round((el / TOTAL) * 100)));
        frame(el);
      };

      // Visible tab: rAF, aligned to the display.
      const loop = () => { if (stopped) return; tick(); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);

      // Hidden tab: rAF freezes AND setTimeout gets clamped to once per second,
      // which silently rendered 1fps slideshows for anyone who switched tabs
      // mid-render. The audio thread is never throttled, so it drives the frames
      // whenever the page isn't on screen.
      try {
        clock = ac.createScriptProcessor(512, 1, 1);
        clock.onaudioprocess = () => { if (document.hidden) tick(); };
        const mute = ac.createGain(); mute.gain.value = 0;
        clock.connect(mute); mute.connect(ac.destination);
      } catch {}
    });
    // (cast: TS narrows `clock` to null because it's only assigned inside the callback)
    try { (clock as ScriptProcessorNode | null)?.disconnect(); } catch {}

    // Render health, so a future slowdown shows up as a number instead of
    // someone squinting at the video going "is this laggy?"
    const fps = frameNo / ((performance.now() - t0) / 1000);
    console.log(`AdForge: ${frameNo} frames in ${TOTAL.toFixed(1)}s = ${fps.toFixed(1)} fps (30 = perfect)`);
    (window as any).__adfFps = +fps.toFixed(1);

    try { rec.stop(); } catch {}
    await done;
    try { vid?.pause(); } catch {}
    try { await ac.close(); } catch {}
    const finalBlob = new Blob(out, { type: "video/webm" });
    setOutBlob(finalBlob);
    setOutUrl(URL.createObjectURL(finalBlob));
    // keep it — every ad you make lands in the library automatically
    if (finalBlob.size > 20000) {
      const ad: SavedAd = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        product: product || "Untitled",
        headline: script.hook || script.scenes[0]?.headline || "",
        created: Date.now(),
        duration: TOTAL,
        size: finalBlob.size,
        thumb: makeThumb(cv),
        blob: finalBlob,
      };
      await saveAd(ad);
      listAds().then(setLibrary);
    }
    if (finalBlob.size < 20000) setErr("The render produced an empty file — try again, or use a shorter clip.");
    setBusy(""); setProgress(100); setStep(4);
  }

  const S: any = {
    input: { width: "100%", padding: "13px 15px", borderRadius: 12, border: "1px solid #2a3a68", background: "rgba(8,12,30,.8)", color: "#e8edff", fontSize: 15, outline: "none", fontFamily: "inherit" },
    label: { fontSize: 12.5, letterSpacing: 1.2, color: "#7f9ad0", marginBottom: 7, display: "block", fontWeight: 700 },
    card: { background: "linear-gradient(180deg,rgba(18,26,54,.9),rgba(10,14,34,.9))", border: "1px solid #22305c", borderRadius: 18, padding: 24 },
    btn: { padding: "14px 26px", borderRadius: 30, border: "none", fontWeight: 800, fontSize: 15, cursor: "pointer", fontFamily: "inherit" },
    prime: { background: "linear-gradient(100deg,#2af0ff,#4a8aff 60%,#ffd24a)", color: "#04101f" },
    ghost: { background: "transparent", border: "1px solid #33477c", color: "#bcd0ff" },
  };

  return (
    <div style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 50% -10%,#0b1636,#05060f 60%)" }}>
      <style>{`@keyframes pulse{0%,100%{opacity:.55}50%{opacity:1}} input::placeholder,textarea::placeholder{color:#4d6294}`}</style>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "26px 20px 80px" }}>
        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 26 }}>
          <a href="/" style={{ fontWeight: 900, letterSpacing: 2, color: "#e8edff", textDecoration: "none" }}>◈ ADFORGE</a>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button onClick={() => setShowLib(v => !v)} className="zbtn" style={{ ...S.btn, ...S.ghost, padding: "8px 14px", fontSize: 12.5, borderColor: showLib ? "#2af0ff" : "#33477c", color: showLib ? "#2af0ff" : "#bcd0ff" }}>
              📁 My ads{library.length ? ` (${library.length})` : ""}
            </button>
            <span style={{ fontSize: 11, letterSpacing: 1.4, padding: "6px 12px", borderRadius: 20, border: `1px solid ${pro ? "#2aeeaa66" : "#33477c"}`, color: pro ? "#2aeeaa" : "#7f9ad0" }}>{pro ? "PRO" : "FREE"}</span>
            {!pro && <button onClick={() => setShowPay(true)} style={{ ...S.btn, ...S.ghost, padding: "8px 16px", fontSize: 12.5 }}>Upgrade</button>}
          </div>
        </div>

        {/* steps */}
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          {["Brief", "Script", "Footage", "Ad"].map((s, i) => (
            <div key={s} style={{ flex: 1, textAlign: "center", fontSize: 11.5, letterSpacing: 1, padding: "9px 4px", borderRadius: 10, background: step === i + 1 ? "rgba(42,240,255,.12)" : "transparent", border: `1px solid ${step === i + 1 ? "#2af0ff55" : "#1d2a52"}`, color: step > i ? "#2af0ff" : "#5d78ad", fontWeight: 700 }}>
              {step > i + 1 ? "✓ " : ""}{i + 1}. {s}
            </div>
          ))}
        </div>

        {showLib && (
          <div style={{ ...S.card, marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 10 }}>
              <h2 style={{ margin: 0, fontSize: 22 }}>📁 My ads</h2>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {library.length > 0 && (
                  <>
                    <span style={{ fontSize: 12, color: "#5d78ad" }}>
                      {library.length} saved · {prettySize(library.reduce((n, a) => n + a.size, 0))}
                    </span>
                    <button onClick={removeAll} className="zbtn" style={{ ...S.btn, ...S.ghost, padding: "7px 12px", fontSize: 11.5, borderColor: "#ff465a55", color: "#ff9aa8" }}>Delete all</button>
                  </>
                )}
                <button onClick={() => setShowLib(false)} className="zbtn" style={{ ...S.btn, ...S.ghost, padding: "7px 12px", fontSize: 11.5 }}>✕ Close</button>
              </div>
            </div>
            <p style={{ color: "#8ea5d4", margin: "0 0 18px", fontSize: 13.5 }}>
              Every ad you make is saved here on this device. Nothing is uploaded anywhere.
            </p>

            {library.length === 0 ? (
              <div style={{ textAlign: "center", padding: "34px 10px", color: "#5d78ad" }}>
                <div style={{ fontSize: 34, marginBottom: 10 }}>🎬</div>
                <div style={{ fontSize: 14.5, marginBottom: 16 }}>No ads yet — make your first one and it'll appear here.</div>
                <button onClick={() => { setShowLib(false); setStep(1); }} style={{ ...S.btn, ...S.prime }}>Make an ad</button>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 14 }}>
                {library.map(ad => (
                  <div key={ad.id} style={{ border: "1px solid #22305c", borderRadius: 14, overflow: "hidden", background: "rgba(8,12,30,.6)" }}>
                    <div style={{ position: "relative", background: "#000", aspectRatio: "9/16", maxHeight: 260, overflow: "hidden" }}>
                      {playing === ad.id ? (
                        <video src={URL.createObjectURL(ad.blob)} controls autoPlay loop style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      ) : (
                        <>
                          {ad.thumb
                            ? <img src={ad.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: .85 }} />
                            : <div style={{ width: "100%", height: "100%", background: "linear-gradient(160deg,#0a1230,#060a1e)" }} />}
                          <button onClick={() => setPlaying(ad.id)} aria-label="Play"
                            style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.25)", border: "none", color: "#fff", fontSize: 34, cursor: "pointer" }}>▶</button>
                        </>
                      )}
                    </div>
                    <div style={{ padding: "11px 12px" }}>
                      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ad.product}</div>
                      <div style={{ fontSize: 11.5, color: "#8ea5d4", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ad.headline}</div>
                      <div style={{ fontSize: 11, color: "#5d78ad", marginBottom: 10 }}>
                        {prettyDate(ad.created)} · {Math.round(ad.duration)}s · {prettySize(ad.size)}
                      </div>
                      <div style={{ display: "flex", gap: 7 }}>
                        <button onClick={() => downloadSaved(ad)} className="zbtn" style={{ ...S.btn, ...S.prime, flex: 1, padding: "9px", fontSize: 12 }}>⬇ Save</button>
                        <button onClick={() => removeAd(ad)} className="zbtn" title="Delete"
                          style={{ ...S.btn, ...S.ghost, padding: "9px 12px", fontSize: 12, borderColor: "#ff465a44", color: "#ff9aa8" }}>🗑</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {err && <div style={{ background: "rgba(255,70,90,.1)", border: "1px solid #ff465a55", color: "#ff9aa8", padding: "12px 16px", borderRadius: 12, marginBottom: 16, fontSize: 14 }}>{err}</div>}

        {/* STEP 1 — BRIEF */}
        {!showLib && step === 1 && (
          <div style={S.card}>
            <h2 style={{ margin: "0 0 6px", fontSize: 24 }}>Tell it about your product</h2>
            <p style={{ color: "#8ea5d4", margin: "0 0 18px", fontSize: 14.5 }}>Or just paste your link — it'll read your site and fill this in for you.</p>

            <div style={{ padding: 15, borderRadius: 14, background: "rgba(42,240,255,.06)", border: "1px solid #2af0ff33", marginBottom: 20 }}>
              <label style={{ ...S.label, color: "#7fe3ff" }}>🔗 READ MY WEBSITE</label>
              <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
                <input style={{ ...S.input, flex: 1, minWidth: 180 }} value={siteUrl} onChange={e => setSiteUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") scanSite(); }} placeholder="yoursite.com" />
                <button onClick={scanSite} disabled={scanning} style={{ ...S.btn, ...S.prime, padding: "13px 22px", fontSize: 14, opacity: scanning ? .6 : 1 }}>
                  {scanning ? "Reading…" : "Read it →"}
                </button>
              </div>
              {scanned && (
                <div style={{ marginTop: 12, fontSize: 13, color: "#8fe3c0" }}>
                  ✓ Read your site — filled in below{scanned.pricing ? `, including your pricing` : ""}.
                  {!!scanned.features.length && (
                    <div style={{ marginTop: 7, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {scanned.features.map(f => <span key={f} style={{ fontSize: 11.5, padding: "4px 10px", borderRadius: 20, background: "rgba(42,240,255,.1)", border: "1px solid #2af0ff33", color: "#bfe6ff" }}>{f}</span>)}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ display: "grid", gap: 16 }}>
              <div><label style={S.label}>PRODUCT NAME</label><input style={S.input} value={product} onChange={e => setProduct(e.target.value)} placeholder="Zenith" /></div>
              <div><label style={S.label}>WHAT DOES IT DO?</label><textarea style={{ ...S.input, minHeight: 88, resize: "vertical" }} value={what} onChange={e => setWhat(e.target.value)} placeholder="An AI assistant you talk to in real time. It remembers you, sees your screen, and you can control it with your hands." /></div>
              <div><label style={S.label}>WHO IS IT FOR?</label><input style={S.input} value={audience} onChange={e => setAudience(e.target.value)} placeholder="Students and busy people" /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div><label style={S.label}>VIBE</label>
                  <select style={S.input} value={vibe} onChange={e => setVibe(e.target.value)}>{VIBES.map(v => <option key={v} style={{ background: "#0b1024" }}>{v}</option>)}</select>
                </div>
                <div><label style={S.label}>LENGTH</label>
                  <select style={S.input} value={duration} onChange={e => { const v = +e.target.value; if (v === 30 && !pro) { setShowPay(true); return; } setDuration(v); }}>
                    <option value={15} style={{ background: "#0b1024" }}>15 seconds</option>
                    <option value={30} style={{ background: "#0b1024" }}>30 seconds {pro ? "" : "(Pro)"}</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{ ...S.label, display: "flex", justifyContent: "space-between" }}>
                  <span>BRAND COLOURS</span>
                  {scanned?.brand?.length ? <span style={{ color: "#8fe3c0", letterSpacing: 0 }}>✓ from your site</span> : null}
                </label>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  {([["Main", colA, setColA, "#2af0ff"], ["Accent", colB, setColB, "#ffd24a"]] as const).map(([lbl, val, setter, dflt]) => (
                    <label key={lbl} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(8,12,30,.7)", border: "1px solid #2a3a68", borderRadius: 12, padding: "8px 12px", cursor: "pointer", flex: 1, minWidth: 130 }}>
                      <input type="color" value={val || dflt} onChange={e => setter(e.target.value)}
                        style={{ width: 30, height: 30, border: "none", background: "none", padding: 0, cursor: "pointer" }} />
                      <span style={{ fontSize: 12.5, color: "#bcd0ff" }}>{lbl}</span>
                      <span style={{ fontSize: 11, color: "#5d78ad", marginLeft: "auto" }}>{(val || dflt).toUpperCase()}</span>
                    </label>
                  ))}
                  {(colA || colB) && (
                    <button onClick={() => { setColA(""); setColB(""); }} className="zbtn"
                      style={{ ...S.btn, ...S.ghost, padding: "9px 13px", fontSize: 11.5 }}>Let AI choose</button>
                  )}
                </div>
              </div>
              <div>
                <label style={{ ...S.label, display: "flex", justifyContent: "space-between" }}>
                  <span>VOICE SPEED</span>
                  <span style={{ color: "#7fe3ff", letterSpacing: 0 }}>{voSpeed.toFixed(2)}×{voSpeed >= 1.25 ? " · punchy" : voSpeed <= 0.95 ? " · weighty" : " · natural"}</span>
                </label>
                <input type="range" min={0.8} max={1.5} step={0.05} value={voSpeed}
                  onChange={e => setVoSpeed(parseFloat(e.target.value))}
                  style={{ width: "100%", accentColor: "#2af0ff", height: 30, cursor: "pointer" }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#5d78ad", marginTop: -4 }}>
                  <span>slower</span><span>faster</span>
                </div>
              </div>
              <div><label style={S.label}>VOICE</label>
                <select style={S.input} value={voice} onChange={e => { const v = e.target.value; if (v !== "cinematic" && !pro) { setShowPay(true); return; } setVoice(v); }}>
                  {VOICES.map(([v, l]) => <option key={v} value={v} style={{ background: "#0b1024" }}>{l}{v !== "cinematic" && !pro ? " (Pro)" : ""}</option>)}
                </select>
              </div>
            </div>
            <button onClick={writeScript} disabled={!!busy} style={{ ...S.btn, ...S.prime, width: "100%", marginTop: 22, opacity: busy ? .6 : 1 }}>
              {busy || "✨ Write my ad"}
            </button>
          </div>
        )}

        {/* STEP 2 — SCRIPT */}
        {!showLib && step === 2 && script && (
          <div style={S.card}>
            <h2 style={{ margin: "0 0 6px", fontSize: 24 }}>Your ad, written</h2>
            <p style={{ color: "#8ea5d4", margin: "0 0 20px", fontSize: 14.5 }}>Edit anything you don't like — it's your ad.</p>
            <div style={{ padding: "14px 16px", borderRadius: 12, background: "rgba(42,240,255,.07)", border: "1px solid #2af0ff33", marginBottom: 18 }}>
              <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#2af0ff", marginBottom: 5 }}>THE HOOK</div>
              <div style={{ fontSize: 19, fontWeight: 800 }}>{script.hook}</div>
            </div>
            {script.scenes.map((s, i) => (
              <div key={i} style={{ padding: 14, borderRadius: 12, border: "1px solid #22305c", marginBottom: 10, background: "rgba(8,12,30,.5)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#5d78ad", marginBottom: 8, letterSpacing: 1 }}>
                  <span>SCENE {i + 1} · {s.fx.toUpperCase()}</span><span>{s.t.toFixed(1)}s</span>
                </div>
                <input style={{ ...S.input, fontWeight: 800, fontSize: 16, marginBottom: 7 }} value={s.headline}
                  onChange={e => setScript({ ...script, scenes: script.scenes.map((x, j) => j === i ? { ...x, headline: e.target.value } : x) })} />
                <input style={{ ...S.input, fontSize: 13.5, marginBottom: 7, color: "#a9bde8" }} value={s.sub} placeholder="(sub-line, optional)"
                  onChange={e => setScript({ ...script, scenes: script.scenes.map((x, j) => j === i ? { ...x, sub: e.target.value } : x) })} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "6px 0 4px" }}>
                  <span style={{ fontSize: 11, color: "#5d78ad", letterSpacing: 1 }}>🗣 VOICEOVER</span>
                  <button onClick={() => previewVo(i)} disabled={previewing >= 0} className="zbtn"
                    style={{ ...S.btn, ...S.ghost, padding: "5px 11px", fontSize: 11, opacity: previewing >= 0 && previewing !== i ? .4 : 1 }}>
                    {previewing === i ? "♪ playing…" : "▶ hear it"}
                  </button>
                </div>
                <textarea style={{ ...S.input, fontSize: 13.5, minHeight: 52, resize: "vertical", color: "#c9d8f6" }} value={s.vo}
                  onChange={e => setScript({ ...script, scenes: script.scenes.map((x, j) => j === i ? { ...x, vo: e.target.value } : x) })} />
              </div>
            ))}
            <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
              <button onClick={() => setStep(1)} style={{ ...S.btn, ...S.ghost }}>← Back</button>
              <button onClick={writeScript} disabled={!!busy} style={{ ...S.btn, ...S.ghost }}>{busy ? "…" : "↻ Rewrite"}</button>
              <button onClick={() => setStep(3)} style={{ ...S.btn, ...S.prime, flex: 1, minWidth: 200 }}>Next — add footage →</button>
            </div>
          </div>
        )}

        {/* STEP 3 — FOOTAGE */}
        {!showLib && step === 3 && (
          <div style={S.card}>
            <h2 style={{ margin: "0 0 6px", fontSize: 24 }}>Add your visuals</h2>
            <p style={{ color: "#8ea5d4", margin: "0 0 20px", fontSize: 14.5 }}>
              Upload a clip of your product and AdForge finds the best moments and cuts the ad from them —
              or skip it and let it build the whole thing from your website.
            </p>
            {!clipUrl && (
              <div style={{ display: "grid", gap: 14 }}>
                <label style={{ ...S.btn, ...S.prime, textAlign: "center", display: "block", padding: "20px", cursor: "pointer" }}>
                  📁 Upload a video
                  <input type="file" accept="video/*" onChange={onUpload} style={{ display: "none" }} />
                  <div style={{ fontSize: 12, fontWeight: 400, marginTop: 6, opacity: .75 }}>mp4, mov or webm — any length</div>
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#3a4a7e", fontSize: 12 }}>
                  <div style={{ flex: 1, height: 1, background: "#22305c" }} /> OR <div style={{ flex: 1, height: 1, background: "#22305c" }} />
                </div>
                <button onClick={render} disabled={!!busy} style={{ ...S.btn, ...S.ghost, width: "100%", padding: "18px", borderColor: "#cc88ff66", color: "#d9b3ff", opacity: busy ? .6 : 1 }}>
                  ✨ No video — build it from my website
                  <div style={{ fontSize: 12, fontWeight: 400, marginTop: 6, color: "#8ea5d4" }}>
                    {scanned?.images?.length
                      ? `Uses the ${scanned.images.length} image${scanned.images.length > 1 ? "s" : ""} from your site + animated graphics`
                      : "Animated motion graphics built from your features"}
                  </div>
                </button>
              </div>
            )}
            {clipUrl && (
              <>
                <video src={clipUrl} controls style={{ width: "100%", borderRadius: 14, border: "1px solid #22305c", background: "#000", marginBottom: 14 }} />
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <button onClick={() => { URL.revokeObjectURL(clipUrl); setClipUrl(""); }} style={{ ...S.btn, ...S.ghost }}>↻ Choose another</button>
                  <button onClick={render} disabled={!!busy} style={{ ...S.btn, ...S.prime, flex: 1, minWidth: 220, opacity: busy ? .6 : 1 }}>
                    {busy || "⚒ Edit & forge my ad"}
                  </button>
                </div>
              </>
            )}
            {busy && (
              <div style={{ marginTop: 18 }}>
                <div style={{ height: 8, borderRadius: 5, background: "#132048", overflow: "hidden" }}>
                  <div style={{ width: `${progress}%`, height: "100%", background: "linear-gradient(90deg,#2af0ff,#ffd24a)", transition: "width .2s" }} />
                </div>
                <div style={{ fontSize: 12.5, color: "#7f9ad0", marginTop: 8, textAlign: "center" }}>{busy} {progress > 0 ? progress + "%" : ""} — keep this tab open</div>
              </div>
            )}
          </div>
        )}

        {/* STEP 4 — RESULT */}
        {!showLib && step === 4 && (
          <div style={S.card}>
            <h2 style={{ margin: "0 0 6px", fontSize: 24 }}>🔥 Your ad is ready</h2>
            <p style={{ color: "#8ea5d4", margin: "0 0 18px", fontSize: 14.5 }}>Download it and post it. WebM plays everywhere and uploads straight to TikTok, Reels and Shorts.</p>
            {outUrl && <video src={outUrl} controls autoPlay loop style={{ width: "100%", maxWidth: 320, display: "block", margin: "0 auto 18px", borderRadius: 16, border: "1px solid #2af0ff44", background: "#000" }} />}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
              <button onClick={downloadAd} style={{ ...S.btn, ...S.prime }}>
                ⬇ Download my ad{outBlob ? ` · ${(outBlob.size / 1048576).toFixed(1)} MB` : ""}
              </button>
              <button onClick={() => { setStep(3); setOutUrl(""); setOutBlob(null); }} style={{ ...S.btn, ...S.ghost }}>↻ Re-forge</button>
              <button onClick={() => { setStep(1); setScript(null); setOutUrl(""); setOutBlob(null); setClipUrl(""); }} style={{ ...S.btn, ...S.ghost }}>+ New ad</button>
            </div>
            {!pro && (
              <div style={{ marginTop: 22, padding: 16, borderRadius: 14, background: "rgba(42,238,170,.07)", border: "1px solid #2aeeaa33", textAlign: "center" }}>
                <div style={{ fontWeight: 800, marginBottom: 5 }}>Lose the watermark?</div>
                <div style={{ color: "#8ea5d4", fontSize: 14, marginBottom: 12 }}>Pro removes it, unlocks 30-second ads, all four voices and 1080p.</div>
                <button onClick={() => setShowPay(true)} style={{ ...S.btn, background: "linear-gradient(100deg,#2aeeaa,#7fe3ff)", color: "#04101f" }}>Go Pro — $9/mo</button>
              </div>
            )}
          </div>
        )}

        <canvas ref={canvasRef} style={{ display: "none" }} />
      </div>

      {/* PAYWALL */}
      {showPay && (
        <div onClick={() => setShowPay(false)} style={{ position: "fixed", inset: 0, background: "rgba(2,4,12,.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }}>
          <div onClick={e => e.stopPropagation()} style={{ ...S.card, maxWidth: 400, width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: 34, marginBottom: 8 }}>◈</div>
            <h3 style={{ margin: "0 0 8px", fontSize: 22 }}>AdForge Pro</h3>
            <div style={{ color: "#8ea5d4", fontSize: 14, marginBottom: 18, lineHeight: 1.6 }}>
              Unlimited ads · no watermark · 30-second ads · all four voices · 1080p export
            </div>
            <div style={{ fontSize: 36, fontWeight: 900, marginBottom: 4 }}>$9<span style={{ fontSize: 15, color: "#7f95c4", fontWeight: 400 }}>/month</span></div>
            <a href={isLive() ? CHECKOUT_URL : "https://meetzenith.vercel.app/#waitlist"} target="_blank" rel="noreferrer" style={{ ...S.btn, background: "linear-gradient(100deg,#2aeeaa,#7fe3ff)", color: "#04101f", display: "block", margin: "16px 0 12px", textDecoration: "none" }}>{isLive() ? "Get Pro — $9/month" : "Join the Pro waitlist"}</a>
            <div style={{ borderTop: "1px solid #22305c", paddingTop: 14, marginTop: 6 }}>
              <div style={{ fontSize: 11, color: "#5d78ad", letterSpacing: 1, marginBottom: 8 }}>HAVE A CODE?</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={code} onChange={e => setCode(e.target.value)} placeholder="enter code" style={{ ...S.input, padding: "10px 12px", fontSize: 13 }} />
                <button onClick={() => {
                  if (code.trim() === PRO_CODE) { localStorage.setItem("adforge-pro", "1"); setPro(true); setShowPay(false); setCode(""); }
                  else setErr("That code isn't valid");
                }} style={{ ...S.btn, ...S.ghost, padding: "10px 16px", fontSize: 13 }}>Unlock</button>
              </div>
            </div>
            <button onClick={() => setShowPay(false)} style={{ background: "none", border: "none", color: "#5d78ad", marginTop: 14, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>maybe later</button>
          </div>
        </div>
      )}
    </div>
  );
}
