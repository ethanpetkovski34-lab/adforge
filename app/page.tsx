"use client";
import { useEffect, useRef } from "react";
import { CHECKOUT_URL, isLive } from "./checkout";

// Desktop builds — GitHub Releases. Until a real release exists these point at
// the releases page, which is honest rather than a dead download link.
const DOWNLOAD = {
  mac: "https://github.com/ethanpetkovski34-lab/adforge/releases/latest",
  win: "https://github.com/ethanpetkovski34-lab/adforge/releases/latest",
  all: "https://github.com/ethanpetkovski34-lab/adforge/releases/latest",
};

const STEPS = [
  ["1", "Tell it about your product", "Name, what it does, who it's for, and the vibe you want. Thirty seconds of typing."],
  ["2", "It writes the ad", "AI writes the hook, every on-screen line, the voiceover and picks a colour palette that fits your brand."],
  ["3", "Add a clip (or skip it)", "Upload a video of your product — or skip it entirely and let AdForge build the ad from your website."],
  ["4", "It edits and forges it", "Finds your best moments, cuts between them, frames each shot, adds kinetic text, transitions and narration — then hands you the file."],
];

const FEATURES = [
  ["✂️", "It actually edits — not a slideshow", "AdForge watches your recording, scores every moment for how much is happening, and cuts the ad from the best bits. Real cuts, real pacing."],
  ["🎬", "Six ways to frame a shot", "Device cards, punch-ins, slow pans across wide screens, split-screens — with whip-pans, flash cuts and glitch transitions between them."],
  ["🖥️", "Your app, not a cropped mess", "Wide videos sit in a device card on a branded backdrop, so people see your whole product instead of a zoomed-in third of it."],
  ["🗣️", "Real narration", "A proper voiceover in four directed styles — cinematic, hype, warm or premium."],
  ["🔗", "Reads your website for you", "Paste your link. It pulls your product, features, audience and real pricing, then writes the ad around them."],
  ["✨", "No footage? Still works", "It builds an animated motion-graphics ad using the images from your own site."],
];

const TIERS = [
  {
    name: "Free",
    price: "$0",
    per: "forever",
    color: "#4a8aff",
    cta: "Make an ad free",
    href: "/studio",
    features: ["15-second ads", "AI script + narration", "Auto-edited cuts & shots", "Reads your website", "Small AdForge watermark"],
  },
  {
    name: "Pro",
    price: "$9",
    per: "/month",
    tag: "Most popular",
    color: "#2aeeaa",
    cta: "Go Pro",
    href: isLive() ? CHECKOUT_URL : "/studio?upgrade=1",
    features: ["Unlimited ads", "15 and 30-second ads", "No watermark", "1080p export", "All 4 directed voices", "Every shot type & transition"],
  },
];

export default function Landing() {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const x = c.getContext("2d")!;
    let W = (c.width = window.innerWidth), H = (c.height = window.innerHeight), raf = 0, t = 0;
    const onR = () => { W = c.width = window.innerWidth; H = c.height = window.innerHeight; };
    window.addEventListener("resize", onR);
    const beams = Array.from({ length: 26 }, () => ({
      x: Math.random(), y: Math.random(), len: 60 + Math.random() * 260,
      sp: 0.0006 + Math.random() * 0.0022, w: 0.6 + Math.random() * 1.8,
      c: Math.random() > 0.5 ? "42,240,255" : "255,210,74", o: 0.12 + Math.random() * 0.3,
    }));
    const draw = () => {
      raf = requestAnimationFrame(draw); t += 1;
      x.clearRect(0, 0, W, H);
      const g = x.createRadialGradient(W * 0.5, H * 0.1, 0, W * 0.5, H * 0.1, H * 0.9);
      g.addColorStop(0, "rgba(30,60,140,0.30)"); g.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      beams.forEach(b => {
        b.x += b.sp; if (b.x > 1.2) b.x = -0.2;
        const px = b.x * W, py = b.y * H + Math.sin(t * 0.004 + b.y * 9) * 14;
        const lg = x.createLinearGradient(px, py, px + b.len, py);
        lg.addColorStop(0, `rgba(${b.c},0)`); lg.addColorStop(0.5, `rgba(${b.c},${b.o})`); lg.addColorStop(1, `rgba(${b.c},0)`);
        x.strokeStyle = lg; x.lineWidth = b.w;
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + b.len, py); x.stroke();
      });
    };
    draw();
    return () => { window.removeEventListener("resize", onR); cancelAnimationFrame(raf); };
  }, []);

  return (
    <>
      <style>{`
        *{box-sizing:border-box}
        a{text-decoration:none}
        .wrap{position:relative;z-index:2;max-width:1080px;margin:0 auto;padding:0 22px}
        .btn{display:inline-block;padding:15px 30px;border-radius:40px;font-weight:800;font-size:15px;letter-spacing:.3px;transition:transform .18s,box-shadow .18s}
        .btn:hover{transform:translateY(-2px)}
        .prime{background:linear-gradient(100deg,#2af0ff,#4a8aff 55%,#ffd24a);color:#04101f;box-shadow:0 10px 40px rgba(42,240,255,.28)}
        .ghost{border:1px solid #2e3f6b;color:#bcd0ff}
        .card{background:linear-gradient(180deg,rgba(18,26,54,.86),rgba(10,14,34,.86));border:1px solid #22305c;border-radius:18px;padding:22px}
        .grad{background:linear-gradient(100deg,#7fe3ff,#fff 40%,#ffd24a);-webkit-background-clip:text;background-clip:text;color:transparent}
        @keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
        @media(max-width:720px){.h1{font-size:40px!important}.grid2{grid-template-columns:1fr!important}.grid3{grid-template-columns:1fr!important}}
      `}</style>
      <canvas ref={cv} style={{ position: "fixed", inset: 0, zIndex: 0 }} />
      <div style={{ position: "fixed", inset: 0, zIndex: 1, pointerEvents: "none", background: "radial-gradient(ellipse at 50% 0%, rgba(10,20,60,.5), rgba(5,6,15,.9) 70%)" }} />

      {/* NAV */}
      <div className="wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "22px", position: "relative", zIndex: 3 }}>
        <div style={{ fontWeight: 900, letterSpacing: 2, fontSize: 18 }}>◈ ADFORGE</div>
        <a href="/studio" className="btn ghost" style={{ padding: "10px 20px", fontSize: 13 }}>Open Studio</a>
      </div>

      {/* HERO */}
      <div className="wrap" style={{ textAlign: "center", paddingTop: 60, paddingBottom: 70 }}>
        <div style={{ display: "inline-block", padding: "7px 16px", borderRadius: 30, border: "1px solid #2a3a6a", fontSize: 12, letterSpacing: 1.5, color: "#8fb4ff", marginBottom: 26 }}>
          POWERED BY ZENITH AI
        </div>
        <h1 className="h1" style={{ fontSize: 64, lineHeight: 1.05, margin: "0 0 20px", fontWeight: 900, letterSpacing: -1.5 }}>
          Turn your app into a<br /><span className="grad">$10,000 ad.</span>
        </h1>
        <p style={{ fontSize: 19, color: "#9fb2dd", maxWidth: 620, margin: "0 auto 34px", lineHeight: 1.65 }}>
          Upload a clip — or just paste your link. AI writes the script, narrates it, finds your best moments and cuts a properly edited ad in under two minutes.
        </p>
        <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
          <a href="/studio" className="btn prime">Make an ad free →</a>
          <a href="#how" className="btn ghost">See how it works</a>
        </div>
        <div style={{ marginTop: 18, fontSize: 13, color: "#5d78ad" }}>No card needed · Your first ad is free</div>

        <div style={{ marginTop: 60, animation: "floaty 6s ease-in-out infinite" }}>
          <div className="card" style={{ padding: 0, overflow: "hidden", maxWidth: 760, margin: "0 auto", boxShadow: "0 30px 90px rgba(0,0,0,.6)" }}>
            <div style={{ display: "flex", gap: 7, padding: "13px 16px", borderBottom: "1px solid #1e2a52" }}>
              {["#ff5f56", "#ffbd2e", "#27c93f"].map(c => <span key={c} style={{ width: 11, height: 11, borderRadius: "50%", background: c }} />)}
            </div>
            <div style={{ padding: "44px 26px", background: "linear-gradient(160deg,#0a1230,#060a1e)" }}>
              <div style={{ fontSize: 12, letterSpacing: 4, color: "#2af0ff", marginBottom: 14 }}>◉ NOW RENDERING</div>
              <div style={{ fontSize: 34, fontWeight: 900, marginBottom: 10 }}>Your hook lands here</div>
              <div style={{ color: "#8fa8d8", marginBottom: 22 }}>then the benefit, then the call to action</div>
              <div style={{ height: 5, background: "#132048", borderRadius: 4, overflow: "hidden", maxWidth: 420, margin: "0 auto" }}>
                <div style={{ width: "72%", height: "100%", background: "linear-gradient(90deg,#2af0ff,#ffd24a)" }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* HOW */}
      <div className="wrap" id="how" style={{ padding: "70px 22px" }}>
        <h2 style={{ fontSize: 36, fontWeight: 900, textAlign: "center", marginBottom: 12 }}>Four steps. Two minutes.</h2>
        <p style={{ textAlign: "center", color: "#8ea5d4", marginBottom: 44 }}>You bring the product. It brings everything else.</p>
        <div className="grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {STEPS.map(([n, t, d]) => (
            <div key={n} className="card">
              <div style={{ width: 38, height: 38, borderRadius: 12, background: "linear-gradient(135deg,#2af0ff,#4a8aff)", color: "#04101f", fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>{n}</div>
              <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 7 }}>{t}</div>
              <div style={{ color: "#93a9d6", lineHeight: 1.6, fontSize: 14.5 }}>{d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* FEATURES */}
      <div className="wrap" style={{ padding: "50px 22px" }}>
        <div className="grid3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          {FEATURES.map(([i, t, d]) => (
            <div key={t} className="card">
              <div style={{ fontSize: 26, marginBottom: 10 }}>{i}</div>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>{t}</div>
              <div style={{ color: "#93a9d6", lineHeight: 1.6, fontSize: 14 }}>{d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* DOWNLOAD */}
      <div className="wrap" style={{ padding: "50px 22px" }}>
        <div className="card" style={{ textAlign: "center", border: "1px solid #2af0ff33" }}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: "#7fe3ff", marginBottom: 10 }}>💻 DESKTOP APP</div>
          <h2 style={{ fontSize: 28, fontWeight: 900, margin: "0 0 10px" }}>Get AdForge on your computer</h2>
          <p style={{ color: "#9fb2dd", maxWidth: 560, margin: "0 auto 22px", lineHeight: 1.65, fontSize: 15 }}>
            Same studio, in its own window — finished ads drop straight into your Downloads folder.
            Not from an app store; you just install it.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <a href={DOWNLOAD.mac} target="_blank" rel="noreferrer" className="btn prime">⬇ Download for Mac</a>
            <a href={DOWNLOAD.win} target="_blank" rel="noreferrer" className="btn ghost">⬇ Windows</a>
            <a href="/studio" className="btn ghost">or use it in the browser</a>
          </div>
          <div style={{ marginTop: 14, fontSize: 12.5, color: "#5d78ad" }}>
            First launch on Mac: right-click the app → Open (it isn't signed by Apple yet).
          </div>
        </div>
      </div>

      {/* PRICING */}
      <div className="wrap" id="pricing" style={{ padding: "70px 22px" }}>
        <h2 style={{ fontSize: 36, fontWeight: 900, textAlign: "center", marginBottom: 10 }}>Cheaper than one hour of an editor</h2>
        <p style={{ textAlign: "center", color: "#8ea5d4", marginBottom: 44 }}>Agencies charge thousands per ad. Start free.</p>
        <div className="grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, maxWidth: 760, margin: "0 auto" }}>
          {TIERS.map(t => (
            <div key={t.name} className="card" style={{ border: `1px solid ${t.color}55`, position: "relative", boxShadow: t.tag ? `0 0 50px ${t.color}20` : "none" }}>
              {t.tag && <div style={{ position: "absolute", top: -11, left: "50%", transform: "translateX(-50%)", background: t.color, color: "#04101f", fontSize: 11, fontWeight: 900, padding: "4px 14px", borderRadius: 20, letterSpacing: .5 }}>{t.tag}</div>}
              <div style={{ fontSize: 13, letterSpacing: 2, color: t.color, marginBottom: 12, marginTop: 4 }}>{t.name.toUpperCase()}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 18 }}>
                <span style={{ fontSize: 42, fontWeight: 900 }}>{t.price}</span>
                <span style={{ color: "#7f95c4" }}>{t.per}</span>
              </div>
              {t.features.map(f => (
                <div key={f} style={{ display: "flex", gap: 9, marginBottom: 9, fontSize: 14.5, color: "#c3d3f5" }}>
                  <span style={{ color: t.color }}>✓</span>{f}
                </div>
              ))}
              <a href={t.href} className="btn" style={{ display: "block", textAlign: "center", marginTop: 20, background: t.tag ? `linear-gradient(100deg,${t.color},#7fe3ff)` : "transparent", color: t.tag ? "#04101f" : t.color, border: t.tag ? "none" : `1px solid ${t.color}66` }}>{t.cta}</a>
            </div>
          ))}
        </div>
      </div>

      {/* FOOTER */}
      <div className="wrap" style={{ padding: "50px 22px 70px", textAlign: "center", borderTop: "1px solid #16214a", marginTop: 40 }}>
        <div style={{ fontWeight: 900, letterSpacing: 2, marginBottom: 10 }}>◈ ADFORGE</div>
        <div style={{ color: "#6c84b8", fontSize: 14, marginBottom: 16 }}>Built on Zenith AI · made by Ethan Petkovski</div>
        <a href="https://meetzenith.vercel.app" style={{ color: "#7fb4ff", fontSize: 14 }}>Meet Zenith, the AI behind it →</a>
      </div>
    </>
  );
}
