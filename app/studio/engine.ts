// AdForge render engine.
// Analyses the footage, decides where to cut, then renders a properly edited ad.

export type Scene = { t: number; headline: string; sub: string; vo: string; fx: string };
export type Script = {
  hook: string; scenes: Scene[]; cta: string; endline: string;
  palette: { a: string; b: string }; duration: number;
};

export type Shot = {
  start: number;      // when this shot appears in the ad
  dur: number;
  srcIn: number;      // where to seek in the source footage
  kind: 'card' | 'pan' | 'punch' | 'split' | 'full';
  trans: 'cut' | 'whip' | 'flash' | 'glitch' | 'slide';
  scene: number;      // which script scene it belongs to
};

const ease = (x: number) => 1 - Math.pow(1 - x, 3);
const easeIO = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Walks the footage and scores how much is *happening* at each moment.
 * Busy moments (typing, clicking, things appearing) score high — those are the
 * bits worth putting in an ad. Dead still frames score low and get skipped.
 */
export async function analyseFootage(
  vid: HTMLVideoElement,
  onProgress?: (p: number) => void
): Promise<{ times: number[]; scores: number[]; duration: number }> {
  const dur = isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 0;
  const times: number[] = [];
  const scores: number[] = [];
  if (!dur) return { times, scores, duration: 0 };

  const w = 48, h = 27;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  const step = clamp(dur / 60, 0.25, 0.8);   // ~60 samples max
  let prev: Uint8ClampedArray | null = null;

  const seek = (t: number) => new Promise<void>(res => {
    let done = false;
    const fin = () => { if (done) return; done = true; res(); };
    vid.onseeked = fin;
    try { vid.currentTime = t; } catch { fin(); }
    setTimeout(fin, 600);
  });

  const wasPaused = vid.paused;
  try { vid.pause(); } catch {}
  for (let t = 0; t < dur; t += step) {
    await seek(t);
    try { x.drawImage(vid, 0, 0, w, h); } catch { continue; }
    const d = x.getImageData(0, 0, w, h).data;
    let score = 0;
    if (prev) {
      let diff = 0;
      for (let i = 0; i < d.length; i += 4) {
        diff += Math.abs(d[i] - prev[i]) + Math.abs(d[i + 1] - prev[i + 1]) + Math.abs(d[i + 2] - prev[i + 2]);
      }
      score = diff / (d.length / 4) / 3;       // 0..255 average channel change
    }
    // penalise near-black / near-white frames (loading screens, flashes of blank)
    let lum = 0;
    for (let i = 0; i < d.length; i += 4) lum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    lum /= d.length / 4;
    if (lum < 12 || lum > 246) score *= 0.15;

    times.push(t); scores.push(score);
    onProgress?.(Math.min(1, t / dur));
  }
  prev = null;
  if (!wasPaused) { try { await vid.play(); } catch {} }
  return { times, scores, duration: dur };
}

/**
 * Turns the script + the footage analysis into an edit: which bit of footage
 * each shot uses, how it's framed, and how it cuts in. Busy scenes get more,
 * faster cuts — the way a real edit breathes.
 */
export function buildEDL(script: Script, an: { times: number[]; scores: number[]; duration: number }, energetic: boolean): Shot[] {
  const shots: Shot[] = [];
  const dur = an.duration || 0;

  // rank moments by how much is happening
  const ranked = an.times
    .map((t, i) => ({ t, s: an.scores[i] || 0 }))
    .sort((a, b) => b.s - a.s);

  const used: number[] = [];
  const pick = (want: number) => {
    if (!dur) return 0;
    // best-scoring moment that isn't too close to one we've already used
    for (const r of ranked) {
      if (r.t + want > dur) continue;
      if (used.some(u => Math.abs(u - r.t) < Math.max(1.2, want * 0.8))) continue;
      used.push(r.t); return r.t;
    }
    const fallback = (used.length * want) % Math.max(0.1, dur - want);
    used.push(fallback); return fallback;
  };

  const kinds: Shot['kind'][] = ['card', 'pan', 'punch', 'card', 'split', 'punch'];
  const transes: Shot['trans'][] = ['whip', 'flash', 'glitch', 'slide', 'whip', 'cut'];

  let clock = 0;
  script.scenes.forEach((sc, i) => {
    // how many cuts inside this scene
    const cuts = energetic ? (sc.t >= 3.4 ? 3 : 2) : (sc.t >= 4 ? 2 : 1);
    const each = sc.t / cuts;
    for (let c = 0; c < cuts; c++) {
      shots.push({
        start: clock,
        dur: each,
        srcIn: pick(each + 0.35),
        kind: i === 0 && c === 0 ? 'card' : kinds[(i * 2 + c) % kinds.length],
        trans: clock === 0 ? 'cut' : transes[(i + c) % transes.length],
        scene: i,
      });
      clock += each;
    }
  });
  return shots;
}

type DrawOpts = {
  g: CanvasRenderingContext2D;
  W: number; H: number;
  vid: HTMLVideoElement;
  blurCv: HTMLCanvasElement;
  shot: Shot;
  local: number;      // seconds into this shot
  A: string; B: string;
};

/** Blurred, darkened backdrop so the frame is never empty — and never cropped to death. */
function backdrop({ g, W, H, vid, blurCv, A, B }: DrawOpts) {
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#05070f'); bg.addColorStop(0.55, A + '18'); bg.addColorStop(1, '#05070f');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  try {
    const bx = blurCv.getContext('2d')!;
    const vw = vid.videoWidth || 16, vh = vid.videoHeight || 9;
    const s = Math.max(blurCv.width / vw, blurCv.height / vh);
    bx.drawImage(vid, (blurCv.width - vw * s) / 2, (blurCv.height - vh * s) / 2, vw * s, vh * s);
    g.globalAlpha = 0.55;
    g.drawImage(blurCv, 0, 0, W, H);   // upscaling the tiny copy = a cheap, smooth blur
    g.globalAlpha = 1;
  } catch {}
  g.fillStyle = 'rgba(4,6,15,0.55)'; g.fillRect(0, 0, W, H);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/**
 * Draws one frame of footage using the shot's framing.
 * The whole point: a landscape screen recording must NOT be cover-cropped into a
 * vertical frame — you'd only see a third of it. It sits in a device card instead.
 */
export function drawShot(o: DrawOpts) {
  const { g, W, H, vid, shot, local, A } = o;
  const p = clamp(local / Math.max(0.2, shot.dur), 0, 1);
  const vw = vid.videoWidth || 1920, vh = vid.videoHeight || 1080;
  const aspect = vw / vh;
  const landscape = aspect > 1.15;

  backdrop(o);

  // where the footage sits — upper 62% of frame, text lives underneath
  const zoneY = H * 0.10, zoneH = H * 0.52;

  const drawCrop = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number, radius: number) => {
    g.save();
    roundRect(g, dx, dy, dw, dh, radius);
    g.shadowColor = 'rgba(0,0,0,0.65)'; g.shadowBlur = 34; g.shadowOffsetY = 12;
    g.fillStyle = '#000'; g.fill();
    g.shadowBlur = 0; g.shadowOffsetY = 0;
    g.clip();
    try { g.drawImage(vid, sx, sy, sw, sh, dx, dy, dw, dh); } catch {}
    g.restore();
    // thin bright edge — makes it read as a screen, not a hole
    g.save();
    roundRect(g, dx, dy, dw, dh, radius);
    g.strokeStyle = A; g.globalAlpha = 0.5; g.lineWidth = Math.max(1.5, W * 0.003);
    g.stroke(); g.restore();
  };

  if (shot.kind === 'card' || (!landscape && shot.kind !== 'punch')) {
    // whole frame, in a card. Gentle drift only — no aggressive zoom.
    const grow = 1 + 0.035 * ease(p);
    let cw = Math.min(W * 0.94, zoneH * aspect) * grow;
    let ch = cw / aspect;
    if (ch > zoneH * grow) { ch = zoneH * grow; cw = ch * aspect; }
    const dx = (W - cw) / 2, dy = zoneY + (zoneH - ch) / 2 + (1 - ease(p)) * H * 0.012;
    drawCrop(0, 0, vw, vh, dx, dy, cw, ch, W * 0.035);
  } else if (shot.kind === 'pan') {
    // slide across a wide recording — reveals content instead of hiding it
    const cw = Math.min(W * 0.94, zoneH * aspect), ch = cw / aspect;
    const dx = (W - cw) / 2, dy = zoneY + (zoneH - ch) / 2;
    const visW = vw * 0.72;                       // show 72% of the width at a time
    const maxPan = vw - visW;
    const sx = maxPan * easeIO(p);
    drawCrop(sx, 0, visW, vh, dx, dy, cw, ch, W * 0.035);
  } else if (shot.kind === 'punch') {
    // a real punch-in: crop to the middle of the action, fills more of the frame
    const zoom = 0.52 - 0.06 * ease(p);
    const sw = vw * zoom, sh = sw / (W / (zoneH * 1.22));
    const sx = clamp(vw * 0.5 - sw / 2, 0, Math.max(0, vw - sw));
    const sy = clamp(vh * 0.46 - sh / 2, 0, Math.max(0, vh - sh));
    const cw = W * 0.94, ch = Math.min(zoneH * 1.22, cw * (sh / sw));
    drawCrop(sx, sy, sw, Math.min(sh, vh - sy), (W - cw) / 2, zoneY + (zoneH - ch) / 2, cw, ch, W * 0.035);
  } else {
    // split: two different parts of the screen stacked — busy, editorial look
    const cw = W * 0.94, ch = zoneH * 0.47, gap = zoneH * 0.06;
    const off = ease(p) * W * 0.02;
    drawCrop(0, 0, vw, vh * 0.55, (W - cw) / 2 - off, zoneY, cw, ch, W * 0.03);
    drawCrop(0, vh * 0.45, vw, vh * 0.55, (W - cw) / 2 + off, zoneY + ch + gap, cw, ch, W * 0.03);
  }

  // transition treatment on the first moments of a cut
  const tIn = 0.26;
  if (local < tIn && shot.trans !== 'cut') {
    const k = 1 - local / tIn;
    if (shot.trans === 'flash') { g.fillStyle = `rgba(255,255,255,${k * 0.5})`; g.fillRect(0, 0, W, H); }
    else if (shot.trans === 'whip') {
      // motion-blur streak: a few offset ghosts of the frame
      g.save(); g.globalAlpha = k * 0.35; g.globalCompositeOperation = 'lighter';
      for (let i = 1; i <= 3; i++) {
        try { g.drawImage(o.g.canvas, -k * i * W * 0.06, 0); } catch {}
      }
      g.restore();
    } else if (shot.trans === 'glitch') {
      g.save(); g.globalAlpha = k * 0.55; g.globalCompositeOperation = 'screen';
      try {
        g.drawImage(o.g.canvas, -k * 14, 0);
        g.drawImage(o.g.canvas, k * 14, 0);
      } catch {}
      g.restore();
      for (let i = 0; i < 5; i++) {
        const sy = Math.random() * H, sh = 6 + Math.random() * 22;
        try { g.drawImage(o.g.canvas, 0, sy, W, sh, (Math.random() - 0.5) * k * 70, sy, W, sh); } catch {}
      }
    } else if (shot.trans === 'slide') {
      g.fillStyle = A; g.globalAlpha = k * 0.9;
      g.fillRect(0, 0, W * k, H); g.globalAlpha = 1;
    }
  }
}

/** Kinetic headline + sub, sitting under the footage card. */
export function drawText(
  g: CanvasRenderingContext2D, W: number, H: number,
  sc: Scene, local: number, A: string, B: string
) {
  const scrim = g.createLinearGradient(0, H * 0.58, 0, H);
  scrim.addColorStop(0, 'rgba(4,6,15,0)'); scrim.addColorStop(0.45, 'rgba(4,6,15,0.85)'); scrim.addColorStop(1, 'rgba(4,6,15,0.97)');
  g.fillStyle = scrim; g.fillRect(0, H * 0.58, W, H * 0.42);

  const words = sc.headline.split(' ').filter(Boolean);
  const baseSize = W * 0.108;
  let fs = baseSize;
  g.font = `900 ${fs}px ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif`;
  while (g.measureText(sc.headline).width > W * 0.88 && fs > W * 0.05) {
    fs -= W * 0.004;
    g.font = `900 ${fs}px ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif`;
  }
  const lineY = H * 0.74;
  g.textAlign = 'center';
  const widths = words.map(w => g.measureText(w + ' ').width);
  const total = widths.reduce((a, b) => a + b, 0);
  let cx = W / 2 - total / 2;
  words.forEach((w, i) => {
    const app = clamp((local - i * 0.06) / 0.3, 0, 1);
    const e = ease(app);
    g.save();
    g.globalAlpha = e;
    g.translate(cx + widths[i] / 2, lineY + (1 - e) * fs * 0.42);
    g.scale(0.94 + e * 0.06, 0.94 + e * 0.06);
    g.shadowColor = A; g.shadowBlur = 22 * e;
    g.fillStyle = '#fff';
    g.fillText(w, 0, 0);
    g.restore();
    cx += widths[i];
  });

  if (sc.sub) {
    const sa = clamp((local - 0.3) / 0.36, 0, 1);
    g.globalAlpha = ease(sa);
    g.font = `600 ${W * 0.04}px ui-sans-serif,system-ui,sans-serif`;
    g.fillStyle = B;
    g.fillText(sc.sub, W / 2, lineY + fs * 0.85);
    g.globalAlpha = 1;
  }

  const uw = clamp(local / 0.5, 0, 1) * W * 0.26;
  g.fillStyle = A; g.globalAlpha = 0.9;
  g.fillRect(W / 2 - uw / 2, lineY + fs * (sc.sub ? 1.25 : 0.5), uw, Math.max(3, W * 0.006));
  g.globalAlpha = 1;
}

/** End card. */
export function drawEndCard(
  g: CanvasRenderingContext2D, W: number, H: number,
  product: string, script: Script, p: number
) {
  const A = script.palette.a, B = script.palette.b;
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#05070f'); bg.addColorStop(0.5, A + '26'); bg.addColorStop(1, '#05070f');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const e = ease(clamp(p * 1.7, 0, 1));
  g.textAlign = 'center';
  g.save();
  g.translate(W / 2, H * 0.45); g.scale(0.9 + e * 0.1, 0.9 + e * 0.1); g.globalAlpha = e;
  let fs = W * 0.11;
  g.font = `900 ${fs}px ui-sans-serif,system-ui,sans-serif`;
  while (g.measureText(product).width > W * 0.84 && fs > W * 0.05) { fs -= W * 0.005; g.font = `900 ${fs}px ui-sans-serif,system-ui,sans-serif`; }
  g.shadowColor = A; g.shadowBlur = 40; g.fillStyle = '#fff';
  g.fillText(product || 'Your product', 0, 0);
  g.restore();
  g.globalAlpha = ease(clamp((p - 0.16) * 2, 0, 1));
  g.font = `600 ${W * 0.042}px ui-sans-serif,system-ui,sans-serif`;
  g.fillStyle = B; g.fillText(script.endline, W / 2, H * 0.45 + W * 0.095);
  const ca = ease(clamp((p - 0.32) * 2.2, 0, 1));
  g.globalAlpha = ca;
  const cw = W * 0.58, ch = W * 0.13, cxp = W / 2 - cw / 2, cyp = H * 0.60;
  const pg = g.createLinearGradient(cxp, 0, cxp + cw, 0); pg.addColorStop(0, A); pg.addColorStop(1, B);
  g.fillStyle = pg; roundRect(g, cxp, cyp, cw, ch, ch / 2); g.fill();
  g.fillStyle = '#04101f'; g.font = `800 ${W * 0.044}px ui-sans-serif,system-ui,sans-serif`;
  g.fillText(script.cta, W / 2, cyp + ch * 0.64);
  g.globalAlpha = 1;
}

/** Motion-graphics frame for ads made with no footage at all. */
export function drawMotionOnly(
  g: CanvasRenderingContext2D, W: number, H: number,
  sc: Scene, local: number, p: number, A: string, B: string, idx: number, imgs: HTMLImageElement[]
) {
  const bg = g.createLinearGradient(0, 0, W, H);
  const shift = Math.sin(p * Math.PI) * 0.1;
  bg.addColorStop(0, '#04060f');
  bg.addColorStop(clamp(0.4 + shift, 0.05, 0.95), (idx % 2 ? B : A) + '30');
  bg.addColorStop(1, '#04060f');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);

  // drifting light bands
  g.save(); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const y = ((i / 5 + p * 0.25 + idx * 0.13) % 1) * H;
    const lg = g.createLinearGradient(0, y - H * 0.1, 0, y + H * 0.1);
    lg.addColorStop(0, 'rgba(0,0,0,0)');
    lg.addColorStop(0.5, (i % 2 ? A : B) + '22');
    lg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = lg; g.fillRect(0, y - H * 0.1, W, H * 0.2);
  }
  g.restore();

  // a real image from their site, if we found one
  const img = imgs[idx % Math.max(1, imgs.length)];
  if (img && img.complete && img.naturalWidth) {
    const zoneY = H * 0.12, zoneH = H * 0.46;
    const ar = img.naturalWidth / img.naturalHeight;
    let cw = Math.min(W * 0.86, zoneH * ar) * (1 + 0.05 * ease(p));
    let ch = cw / ar;
    if (ch > zoneH) { ch = zoneH; cw = ch * ar; }
    const dx = (W - cw) / 2, dy = zoneY + (zoneH - ch) / 2;
    g.save();
    roundRect(g, dx, dy, cw, ch, W * 0.035);
    g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 30; g.shadowOffsetY = 10;
    g.fillStyle = '#000'; g.fill(); g.shadowBlur = 0; g.shadowOffsetY = 0;
    g.clip();
    g.globalAlpha = ease(clamp(local / 0.4, 0, 1));
    g.drawImage(img, dx, dy, cw, ch);
    g.restore();
  } else {
    // no image — a big animated glyph keeps the frame alive
    g.save();
    g.translate(W / 2, H * 0.32);
    const s = 0.9 + ease(clamp(local / 0.6, 0, 1)) * 0.1;
    g.scale(s, s); g.globalAlpha = 0.9;
    g.strokeStyle = A; g.lineWidth = W * 0.012;
    g.beginPath(); g.arc(0, 0, W * 0.16, p * 6.283, p * 6.283 + 4.4); g.stroke();
    g.strokeStyle = B; g.lineWidth = W * 0.007;
    g.beginPath(); g.arc(0, 0, W * 0.115, -p * 5 + 1, -p * 5 + 4.8); g.stroke();
    g.restore();
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   FEATURE ANIMATIONS — for ads made with no footage.
   Instead of an abstract gradient, each scene draws an animated mock-up of the
   thing being described: a conversation, a memory filling up, a screen being
   scanned, tasks ticking off, hands controlling panels, speed.
   ──────────────────────────────────────────────────────────────────────────── */

export type AnimKind = 'chat' | 'memory' | 'vision' | 'tasks' | 'hands' | 'speed' | 'app';

export function pickAnim(text: string, i: number): AnimKind {
  const t = (text || '').toLowerCase();
  if (/voice|talk|speak|conversat|listen|ask|say|reply|answer/.test(t)) return 'chat';
  if (/remember|memory|learn|knows|brain|recall|forget/.test(t)) return 'memory';
  if (/see|screen|camera|vision|watch|look|scan|read/.test(t)) return 'vision';
  if (/task|remind|plan|schedule|todo|organi|day|list|done/.test(t)) return 'tasks';
  if (/hand|gesture|pinch|touch|wave|holo|air/.test(t)) return 'hands';
  if (/fast|instant|second|speed|quick|real.?time|delay|wait/.test(t)) return 'speed';
  return (['app', 'chat', 'tasks', 'vision'] as AnimKind[])[i % 4];
}

function panel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, A: string, fill = 'rgba(10,16,34,0.92)') {
  g.save();
  roundRect(g, x, y, w, h, r);
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 26; g.shadowOffsetY = 8;
  g.fillStyle = fill; g.fill();
  g.shadowBlur = 0; g.shadowOffsetY = 0;
  g.strokeStyle = A; g.globalAlpha = 0.45; g.lineWidth = Math.max(1.4, w * 0.004); g.stroke();
  g.restore();
}

function label(g: CanvasRenderingContext2D, t: string, x: number, y: number, size: number, col: string, align: CanvasTextAlign = 'left', weight = '600') {
  g.font = `${weight} ${size}px ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif`;
  g.textAlign = align; g.fillStyle = col; g.fillText(t, x, y);
}

/** The animated mock-up for one scene. Fills the upper zone; text sits below. */
export function drawFeatureAnim(
  g: CanvasRenderingContext2D, W: number, H: number,
  kind: AnimKind, local: number, p: number, A: string, B: string
) {
  const zx = W * 0.08, zw = W * 0.84;
  const zy = H * 0.11, zh = H * 0.44;
  const step = (n: number, delay: number, dur = 0.45) => ease(clamp((local - delay) / dur, 0, 1));

  if (kind === 'chat') {
    panel(g, zx, zy, zw, zh, W * 0.045, A);
    // incoming question
    const a1 = step(0, 0.15);
    g.save(); g.globalAlpha = a1;
    const bw = zw * 0.62, bh = zh * 0.15;
    roundRect(g, zx + zw - bw - zw * 0.06, zy + zh * 0.12 + (1 - a1) * 20, bw, bh, bh * 0.42);
    g.fillStyle = A + 'cc'; g.fill();
    label(g, 'Hey, what’s my day look like?', zx + zw - bw - zw * 0.06 + bw / 2, zy + zh * 0.12 + bh * 0.62 + (1 - a1) * 20, W * 0.028, '#04121f', 'center', '700');
    g.restore();
    // reply typing then text
    const a2 = step(0, 0.7);
    g.save(); g.globalAlpha = a2;
    const rw = zw * 0.72, rh = zh * 0.24;
    const ry = zy + zh * 0.36 + (1 - a2) * 22;
    roundRect(g, zx + zw * 0.06, ry, rw, rh, rh * 0.28);
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.fill();
    if (local < 1.35) {
      for (let i = 0; i < 3; i++) {
        const bob = Math.sin(local * 9 + i * 1.1) * rh * 0.06;
        g.beginPath(); g.fillStyle = '#dbe6ff';
        g.arc(zx + zw * 0.06 + rw * (0.2 + i * 0.1), ry + rh / 2 + bob, rh * 0.07, 0, 7); g.fill();
      }
    } else {
      const lines = ['Three things, then you’re free.', 'I’ll nudge you at each one.'];
      lines.forEach((ln, i) => {
        const rev = clamp((local - 1.35 - i * 0.3) / 0.5, 0, 1);
        g.save(); g.beginPath();
        g.rect(zx + zw * 0.06, ry, rw * rev, rh); g.clip();
        label(g, ln, zx + zw * 0.06 + rw * 0.06, ry + rh * (0.42 + i * 0.32), W * 0.031, '#eaf2ff');
        g.restore();
      });
    }
    g.restore();
    // live waveform = it's speaking
    const wy = zy + zh * 0.82;
    for (let i = 0; i < 26; i++) {
      const h2 = (0.25 + Math.abs(Math.sin(local * 6 + i * 0.5)) * 0.75) * zh * 0.11 * step(0, 1.0);
      g.fillStyle = i % 3 === 0 ? B : A; g.globalAlpha = 0.9;
      const bx = zx + zw * 0.1 + i * (zw * 0.8 / 26);
      g.fillRect(bx, wy - h2 / 2, zw * 0.012, h2);
    }
    g.globalAlpha = 1;
  }

  else if (kind === 'memory') {
    // glowing core
    const cx = zx + zw / 2, cy = zy + zh * 0.5;
    const pulse = 1 + Math.sin(local * 3) * 0.05;
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, zh * 0.26 * pulse);
    rg.addColorStop(0, A + 'ee'); rg.addColorStop(0.5, A + '55'); rg.addColorStop(1, A + '00');
    g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, zh * 0.26 * pulse, 0, 7); g.fill();
    g.strokeStyle = A; g.globalAlpha = 0.8; g.lineWidth = W * 0.006;
    g.beginPath(); g.arc(cx, cy, zh * 0.16, local * 1.4, local * 1.4 + 4.3); g.stroke();
    g.strokeStyle = B; g.lineWidth = W * 0.004;
    g.beginPath(); g.arc(cx, cy, zh * 0.21, -local * 1.1 + 1, -local * 1.1 + 4.9); g.stroke();
    g.globalAlpha = 1;
    // facts docking in
    const facts = ['name: Ethan', 'exam on Friday', 'hates mornings', 'gym at 5pm'];
    facts.forEach((f, i) => {
      const a = step(0, 0.25 + i * 0.32, 0.6);
      if (a <= 0) return;
      const ang = -0.9 + i * 0.62;
      const dist = zh * 0.34 * (1 - a) + zh * 0.30 * a;
      const fx = cx + Math.cos(ang) * dist * 1.5, fy = cy + Math.sin(ang) * dist;
      g.save(); g.globalAlpha = a;
      const fw = zw * 0.42, fh = zh * 0.1;
      roundRect(g, fx - fw / 2, fy - fh / 2, fw, fh, fh * 0.35);
      g.fillStyle = 'rgba(10,18,40,0.95)'; g.fill();
      g.strokeStyle = B; g.globalAlpha = a * 0.6; g.lineWidth = 1.5; g.stroke();
      g.globalAlpha = a;
      label(g, f, fx, fy + fh * 0.16, W * 0.026, '#dfe8ff', 'center', '600');
      g.restore();
    });
  }

  else if (kind === 'vision') {
    panel(g, zx, zy, zw, zh, W * 0.045, A, 'rgba(6,12,28,0.95)');
    // fake page content
    g.save(); roundRect(g, zx, zy, zw, zh, W * 0.045); g.clip();
    for (let i = 0; i < 7; i++) {
      const a = step(0, 0.1 + i * 0.05);
      g.globalAlpha = a * 0.5;
      g.fillStyle = i === 2 ? B : '#7f9ad0';
      const lw = zw * (i === 0 ? 0.5 : 0.62 + (i % 3) * 0.1);
      g.fillRect(zx + zw * 0.08, zy + zh * (0.14 + i * 0.1), lw, zh * (i === 0 ? 0.055 : 0.032));
    }
    g.globalAlpha = 1;
    // scan sweep
    const sy = zy + ((local * 0.55) % 1) * zh;
    const sg = g.createLinearGradient(0, sy - zh * 0.09, 0, sy + zh * 0.09);
    sg.addColorStop(0, A + '00'); sg.addColorStop(0.5, A + '99'); sg.addColorStop(1, A + '00');
    g.fillStyle = sg; g.fillRect(zx, sy - zh * 0.09, zw, zh * 0.18);
    g.fillStyle = A; g.fillRect(zx, sy - 1.5, zw, 3);
    g.restore();
    // corner brackets
    const b = zw * 0.07;
    g.strokeStyle = A; g.lineWidth = W * 0.008; g.globalAlpha = 0.95;
    [[zx, zy, 1, 1], [zx + zw, zy, -1, 1], [zx, zy + zh, 1, -1], [zx + zw, zy + zh, -1, -1]].forEach(([x, y, sx, sy2]) => {
      g.beginPath(); g.moveTo(x as number, (y as number) + (sy2 as number) * b);
      g.lineTo(x as number, y as number); g.lineTo((x as number) + (sx as number) * b, y as number); g.stroke();
    });
    g.globalAlpha = 1;
    // "understood it" chip
    const a = step(0, 1.15, 0.5);
    if (a > 0) {
      g.save(); g.globalAlpha = a;
      const cw = zw * 0.66, ch = zh * 0.13;
      roundRect(g, zx + (zw - cw) / 2, zy + zh - ch * 1.5, cw, ch, ch * 0.34);
      const pg = g.createLinearGradient(zx, 0, zx + cw, 0); pg.addColorStop(0, A); pg.addColorStop(1, B);
      g.fillStyle = pg; g.fill();
      label(g, '✓  Got it — here’s the answer', zx + zw / 2, zy + zh - ch * 0.72, W * 0.028, '#04121f', 'center', '800');
      g.restore();
    }
  }

  else if (kind === 'tasks') {
    panel(g, zx, zy, zw, zh, W * 0.045, A);
    label(g, 'TODAY', zx + zw * 0.07, zy + zh * 0.13, W * 0.026, B, 'left', '800');
    const items = ['Finish maths homework', 'Film the TikTok', 'Gym at 5pm', 'Call grandma'];
    items.forEach((it, i) => {
      const app = step(0, 0.12 + i * 0.2, 0.4);
      if (app <= 0) return;
      const y = zy + zh * (0.26 + i * 0.17);
      g.save(); g.globalAlpha = app;
      g.translate((1 - app) * W * 0.06, 0);
      const bx = zx + zw * 0.08, bs = zh * 0.075;
      const tick = clamp((local - (1.0 + i * 0.28)) / 0.32, 0, 1);
      roundRect(g, bx, y - bs * 0.7, bs, bs, bs * 0.28);
      g.fillStyle = tick > 0 ? B : 'transparent'; g.fill();
      g.strokeStyle = tick > 0 ? B : '#5f7bb0'; g.lineWidth = 2.4; g.stroke();
      if (tick > 0) {
        g.save(); g.strokeStyle = '#04121f'; g.lineWidth = bs * 0.16; g.lineCap = 'round';
        g.beginPath();
        g.moveTo(bx + bs * 0.24, y - bs * 0.22);
        g.lineTo(bx + bs * 0.44, y - bs * 0.02 * (1 / 1));
        g.lineTo(bx + bs * 0.78, y - bs * 0.46);
        g.setLineDash([bs * 1.4, bs * 1.4]); g.lineDashOffset = bs * 1.4 * (1 - tick);
        g.stroke(); g.restore();
      }
      g.globalAlpha = app * (tick > 0.6 ? 0.45 : 1);
      label(g, it, bx + bs * 1.5, y, W * 0.032, '#e6eeff');
      if (tick > 0.6) { g.strokeStyle = '#8fa8d8'; g.lineWidth = 1.6; g.beginPath(); const tw = g.measureText(it).width; g.moveTo(bx + bs * 1.5, y - W * 0.01); g.lineTo(bx + bs * 1.5 + tw * clamp((tick - 0.6) / 0.4, 0, 1), y - W * 0.01); g.stroke(); }
      g.restore();
    });
  }

  else if (kind === 'hands') {
    // floating panels
    const cards = [['⏱', '5:00'], ['✅', '3 left'], ['🌤', '19°']];
    cards.forEach((c, i) => {
      const a = step(0, 0.1 + i * 0.22, 0.5);
      if (a <= 0) return;
      const cw = zw * 0.27, ch = zh * 0.3;
      const cx2 = zx + zw * (0.09 + i * 0.32);
      const drift = Math.sin(local * 1.6 + i) * zh * 0.03;
      const cy2 = zy + zh * 0.1 + drift + (1 - a) * zh * 0.12;
      g.save(); g.globalAlpha = a;
      panel(g, cx2, cy2, cw, ch, W * 0.03, i === 1 ? B : A);
      label(g, c[0], cx2 + cw / 2, cy2 + ch * 0.45, W * 0.062, '#fff', 'center');
      label(g, c[1], cx2 + cw / 2, cy2 + ch * 0.76, W * 0.03, i === 1 ? B : A, 'center', '800');
      g.restore();
    });
    // hand + pinch
    const hx = zx + zw * (0.30 + Math.sin(local * 1.2) * 0.14), hy = zy + zh * 0.78;
    const pinch = (Math.sin(local * 2.4) + 1) / 2;
    g.save();
    g.strokeStyle = A; g.lineWidth = W * 0.011; g.lineCap = 'round'; g.globalAlpha = 0.95;
    // two fingers meeting
    const gap = zh * 0.10 * (1 - pinch * 0.82);
    g.beginPath(); g.moveTo(hx - zw * 0.10, hy + zh * 0.10); g.lineTo(hx - gap, hy); g.stroke();
    g.beginPath(); g.moveTo(hx + zw * 0.10, hy + zh * 0.10); g.lineTo(hx + gap, hy); g.stroke();
    g.beginPath(); g.arc(hx - gap, hy, W * 0.014, 0, 7); g.fillStyle = A; g.fill();
    g.beginPath(); g.arc(hx + gap, hy, W * 0.014, 0, 7); g.fillStyle = A; g.fill();
    if (pinch > 0.8) {
      g.strokeStyle = B; g.globalAlpha = (pinch - 0.8) * 5; g.lineWidth = W * 0.007;
      g.beginPath(); g.arc(hx, hy, W * 0.05 + (pinch - 0.8) * W * 0.2, 0, 7); g.stroke();
    }
    g.restore();
  }

  else if (kind === 'speed') {
    const cx = zx + zw / 2, cy = zy + zh * 0.52, R = zh * 0.3;
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = W * 0.026;
    g.beginPath(); g.arc(cx, cy, R, Math.PI * 0.78, Math.PI * 2.22); g.stroke();
    const fill = ease(clamp(local / 1.1, 0, 1));
    const pg = g.createLinearGradient(cx - R, 0, cx + R, 0); pg.addColorStop(0, A); pg.addColorStop(1, B);
    g.strokeStyle = pg; g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy, R, Math.PI * 0.78, Math.PI * 0.78 + fill * Math.PI * 1.44); g.stroke();
    const val = (0.31 * fill).toFixed(2);
    label(g, val + 's', cx, cy + R * 0.16, W * 0.115, '#fff', 'center', '900');
    label(g, 'TO ANSWER', cx, cy + R * 0.5, W * 0.026, B, 'center', '700');
    for (let i = 0; i < 12; i++) {
      const a = clamp((local * 2.2 - i * 0.12) % 2, 0, 1);
      g.globalAlpha = (1 - a) * 0.5;
      g.fillStyle = i % 2 ? B : A;
      g.fillRect(zx + zw * 0.05, zy + zh * 0.05 + i * (zh * 0.075), zw * 0.9 * a, 2.5);
    }
    g.globalAlpha = 1;
  }

  else {
    // generic app UI assembling itself
    panel(g, zx, zy, zw, zh, W * 0.045, A);
    const bar = step(0, 0.1);
    g.save(); g.globalAlpha = bar;
    roundRect(g, zx + zw * 0.06, zy + zh * 0.08, zw * 0.5 * bar, zh * 0.08, zh * 0.03);
    g.fillStyle = A + 'cc'; g.fill(); g.restore();
    const tiles = 4;
    for (let i = 0; i < tiles; i++) {
      const a = step(0, 0.3 + i * 0.18, 0.45);
      if (a <= 0) continue;
      const tw = zw * 0.4, th = zh * 0.24;
      const tx = zx + zw * 0.06 + (i % 2) * (tw + zw * 0.08);
      const ty = zy + zh * 0.26 + Math.floor(i / 2) * (th + zh * 0.08);
      g.save(); g.globalAlpha = a; g.translate(0, (1 - a) * zh * 0.05);
      panel(g, tx, ty, tw, th, W * 0.028, i % 2 ? B : A, 'rgba(255,255,255,0.05)');
      g.fillStyle = i % 2 ? B : A; g.globalAlpha = a * 0.85;
      g.beginPath(); g.arc(tx + tw * 0.2, ty + th * 0.36, th * 0.13, 0, 7); g.fill();
      g.fillStyle = '#c8d8f5';
      g.fillRect(tx + tw * 0.12, ty + th * 0.62, tw * 0.6, th * 0.07);
      g.fillRect(tx + tw * 0.12, ty + th * 0.76, tw * 0.4, th * 0.06);
      g.restore();
    }
  }
}

/* ── PRO POLISH ─────────────────────────────────────────────────────────────
   The details that separate a template from something a business would pay for.
   ─────────────────────────────────────────────────────────────────────────── */

/** Subtle light-leak sweep across the frame — very "shot on a real camera". */
export function lightLeak(g: CanvasRenderingContext2D, W: number, H: number, t: number, A: string) {
  const x = ((t * 0.11) % 1.4 - 0.2) * W;
  const lg = g.createLinearGradient(x - W * 0.3, 0, x + W * 0.3, H);
  lg.addColorStop(0, 'rgba(0,0,0,0)');
  lg.addColorStop(0.5, A + '14');
  lg.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.globalCompositeOperation = 'lighter';
  g.fillStyle = lg; g.fillRect(0, 0, W, H); g.restore();
}

/** Letterbox bars that ease in — instantly reads as "cinematic". */
export function letterbox(g: CanvasRenderingContext2D, W: number, H: number, amount: number) {
  if (amount <= 0) return;
  const h = H * 0.045 * amount;
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, h); g.fillRect(0, H - h, W, h);
}

/** A thin animated brand bar + product name locked to the top of every frame. */
export function brandBar(
  g: CanvasRenderingContext2D, W: number, H: number,
  product: string, t: number, total: number, A: string, B: string
) {
  const p = Math.min(1, t / Math.max(0.1, total));
  g.save();
  // top-left product name, small and confident
  g.font = `800 ${W * 0.032}px ui-sans-serif,system-ui,sans-serif`;
  g.textAlign = 'left'; g.globalAlpha = 0.9;
  g.fillStyle = '#fff';
  g.fillText(product.slice(0, 20), W * 0.055, H * 0.062);
  // accent dot that pulses with the beat of the ad
  const r = W * 0.009 * (1 + Math.sin(t * 6) * 0.18);
  g.beginPath(); g.fillStyle = A; g.arc(W * 0.055 - W * 0.022, H * 0.055, r, 0, 7); g.fill();
  // hairline progress across the very top
  g.globalAlpha = 0.25; g.fillStyle = '#fff'; g.fillRect(0, 0, W, 2);
  g.globalAlpha = 1;
  const pg = g.createLinearGradient(0, 0, W, 0); pg.addColorStop(0, A); pg.addColorStop(1, B);
  g.fillStyle = pg; g.fillRect(0, 0, W * p, 2);
  g.restore();
}

/** Lower-third chip — the little labelled tag pro ads use to name a feature. */
export function lowerThird(
  g: CanvasRenderingContext2D, W: number, H: number,
  label: string, local: number, A: string, B: string
) {
  if (!label) return;
  const a = Math.min(1, Math.max(0, (local - 0.15) / 0.4));
  if (a <= 0) return;
  const e = 1 - Math.pow(1 - a, 3);
  g.save();
  g.globalAlpha = e;
  g.font = `800 ${W * 0.026}px ui-sans-serif,system-ui,sans-serif`;
  const tw = g.measureText(label.toUpperCase()).width;
  const pad = W * 0.028, h = W * 0.062;
  const x = W * 0.055, y = H * 0.60 - h;
  g.translate((1 - e) * -W * 0.05, 0);
  // accent stripe + dark chip
  const pg = g.createLinearGradient(x, 0, x + tw + pad * 2, 0);
  pg.addColorStop(0, A); pg.addColorStop(1, B);
  g.fillStyle = pg; g.fillRect(x, y, W * 0.008, h);
  g.fillStyle = 'rgba(4,8,20,0.82)';
  g.fillRect(x + W * 0.008, y, tw + pad * 1.6, h);
  g.fillStyle = '#fff'; g.textAlign = 'left';
  g.fillText(label.toUpperCase(), x + W * 0.008 + pad * 0.8, y + h * 0.64);
  g.restore();
}

/** Counts a number up — great for stats like "0.3s" or "3× faster". */
export function countUp(
  g: CanvasRenderingContext2D, W: number, H: number,
  value: string, local: number, A: string
) {
  const m = value.match(/^([\d.]+)(.*)$/);
  if (!m) return;
  const target = parseFloat(m[1]); const suffix = m[2] || '';
  const p = Math.min(1, local / 0.9);
  const shown = (target * (1 - Math.pow(1 - p, 3))).toFixed(m[1].includes('.') ? 2 : 0);
  g.save();
  g.textAlign = 'center';
  g.font = `900 ${W * 0.16}px ui-sans-serif,system-ui,sans-serif`;
  g.shadowColor = A; g.shadowBlur = 34;
  g.fillStyle = '#fff';
  g.fillText(shown + suffix, W / 2, H * 0.40);
  g.restore();
}
