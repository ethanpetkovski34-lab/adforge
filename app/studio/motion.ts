// AdForge motion layer.
//
// This is the difference between "a video with text on it" and something that
// looks like a motion designer built it in After Effects. Everything here is
// designed to be cheap: sprites and gradients are baked ONCE into offscreen
// canvases and stamped, because rebuilding gradients per frame at 1080x1920 is
// what eats the entire 33ms frame budget.

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const ease = (x: number) => 1 - Math.pow(1 - x, 3);
const easeIO = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const expo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
/** Out-back: overshoots past the target then settles. The single most
 *  recognisable "professional motion graphics" easing there is. */
const back = (x: number) => { const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

/** Stable pseudo-random from an integer — particles must sit still between
 *  frames, so Math.random() is useless here. */
const rnd = (i: number, s = 1) => {
  const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/* ── BEAT CLOCK ──────────────────────────────────────────────────────────────
   Real ads cut on a tempo. Every punch, shake and word landing in here snaps to
   the same grid, which is why edits feel deliberate instead of random.
   ─────────────────────────────────────────────────────────────────────────── */

export const BPM = 112;
export const BEAT = 60 / BPM;                       // 0.536s

/** 0 at the beat, rising to 1 just before the next one. */
export const beatPhase = (t: number) => { const b = t / BEAT; return b - Math.floor(b); };
/** Sharp decaying pop on every beat — use for pulses and breathing. */
export const beatPulse = (t: number, sharp = 5) => Math.pow(1 - beatPhase(t), sharp);
/** Snap a time to the nearest beat, so cuts land musically. */
export const snapBeat = (t: number) => Math.round(t / BEAT) * BEAT;

/* ── VIRTUAL CAMERA ──────────────────────────────────────────────────────────
   One shared camera over the whole ad: gentle handheld drift, a slow push on
   every shot, and a decaying impact shake on each cut. Nothing looks more
   amateur than a perfectly static frame.
   ─────────────────────────────────────────────────────────────────────────── */

export type Cam = { x: number; y: number; scale: number; rot: number };

export function camera(t: number, local: number, dur: number, intensity = 1): Cam {
  // handheld: two incommensurate sines so it never visibly loops
  const hx = Math.sin(t * 0.9) * 0.6 + Math.sin(t * 2.3 + 1.7) * 0.25;
  const hy = Math.cos(t * 0.75 + 0.4) * 0.6 + Math.sin(t * 1.9) * 0.2;
  // slow push across the shot + a beat breathe
  const push = 1 + 0.035 * easeIO(clamp(local / Math.max(0.3, dur), 0, 1)) + beatPulse(t, 7) * 0.006;
  // impact: hard hit on the cut, gone in ~0.25s
  const hit = Math.exp(-local * 15) * intensity;
  const sx = hit * (rnd(Math.floor(t * 60)) - 0.5) * 26;
  const sy = hit * (rnd(Math.floor(t * 60), 7) - 0.5) * 26;
  return {
    x: hx * 5 * intensity + sx,
    y: hy * 5 * intensity + sy,
    scale: push + hit * 0.03,
    rot: (hx * 0.0016 + hit * (rnd(Math.floor(t * 60), 3) - 0.5) * 0.012) * intensity,
  };
}

export function applyCam(g: CanvasRenderingContext2D, W: number, H: number, c: Cam) {
  g.translate(W / 2 + c.x, H / 2 + c.y);
  g.rotate(c.rot);
  g.scale(c.scale, c.scale);
  g.translate(-W / 2, -H / 2);
}

/* ── KINETIC TYPOGRAPHY ──────────────────────────────────────────────────────
   Words don't fade in. They're masked by their own line and slide up from
   behind it with an overshoot, one after another — and one hero word gets a
   solid colour block that wipes in behind it.
   ─────────────────────────────────────────────────────────────────────────── */

const FONT = 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif';

type Line = { words: string[]; xs: number[]; ws: number[]; width: number };
export type TypeBlock = { lines: Line[]; fs: number; lineH: number; hero: number };

/** Greedy wrap that shrinks the type until it fits in `maxLines`. */
export function layoutHeadline(
  g: CanvasRenderingContext2D, text: string, maxW: number, startFs: number, maxLines = 3
): TypeBlock {
  const raw = (text || '').split(/\s+/).filter(Boolean);
  let fs = startFs;
  let lines: Line[] = [];
  for (let attempt = 0; attempt < 22; attempt++) {
    g.font = `900 ${fs}px ${FONT}`;
    const space = g.measureText(' ').width;
    lines = [];
    let cur: string[] = [], curW = 0;
    for (const w of raw) {
      const ww = g.measureText(w).width;
      if (cur.length && curW + space + ww > maxW) {
        lines.push({ words: cur, xs: [], ws: [], width: curW });
        cur = [w]; curW = ww;
      } else { curW += (cur.length ? space : 0) + ww; cur.push(w); }
    }
    if (cur.length) lines.push({ words: cur, xs: [], ws: [], width: curW });
    if (lines.length <= maxLines && lines.every(l => l.width <= maxW)) break;
    fs *= 0.93;
    if (fs < startFs * 0.42) break;
  }

  // Greedy wrapping strands the last word on its own line, which looks like a
  // mistake rather than a decision. Pull one word down to balance it.
  g.font = `900 ${fs}px ${FONT}`;
  {
    const sp = g.measureText(' ').width;
    for (let pass = 0; pass < 2; pass++) {
      const last = lines[lines.length - 1], prev = lines[lines.length - 2];
      if (!prev || last.words.length !== 1 || prev.words.length < 3) break;
      const moved = prev.words[prev.words.length - 1];
      const mw = g.measureText(moved).width;
      if (last.width + sp + mw > maxW) break;
      prev.words.pop(); prev.width -= sp + mw;
      last.words.unshift(moved); last.width += sp + mw;
    }
  }

  // measure each word's x within its line (centred)
  const space = g.measureText(' ').width;
  for (const l of lines) {
    let x = -l.width / 2;
    for (const w of l.words) {
      const ww = g.measureText(w).width;
      l.xs.push(x); l.ws.push(ww);
      x += ww + space;
    }
  }
  // hero word: a number/price if there is one, otherwise the longest real word
  let hero = -1, bestLen = 3, n = 0;
  const flat: string[] = [];
  lines.forEach(l => l.words.forEach(w => flat.push(w)));
  flat.forEach((w, i) => { if (/[\d$%]/.test(w) && hero < 0) hero = i; });
  if (hero < 0) flat.forEach((w, i) => { const L = w.replace(/[^a-z]/gi, '').length; if (L > bestLen) { bestLen = L; hero = i; } });
  n = flat.length;
  if (n <= 2) hero = -1;   // don't highlight when there's barely any text

  return { lines, fs, lineH: fs * 1.14, hero };
}

/**
 * Draws a laid-out block with the masked slide-up reveal.
 * `bottom` is where the LAST baseline sits; the block grows upward from there.
 */
export function drawKinetic(
  g: CanvasRenderingContext2D, blk: TypeBlock, cx: number, bottom: number,
  local: number, A: string, B: string, stagger = 0.055, opts: { hero?: boolean; delay?: number } = {}
) {
  const { lines, fs, lineH } = blk;
  const d0 = opts.delay || 0;
  const useHero = opts.hero !== false;
  g.save();
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.font = `900 ${fs}px ${FONT}`;
  let wi = 0;
  lines.forEach((l, li) => {
    const base = bottom - (lines.length - 1 - li) * lineH;
    l.words.forEach((w, k) => {
      const delay = d0 + wi * stagger;
      const a = clamp((local - delay) / 0.46, 0, 1);
      const i = wi++;
      if (a <= 0) return;
      const x = cx + l.xs[k], ww = l.ws[k];
      const isHero = useHero && i === blk.hero;

      // colour block behind the hero word, wiping in from the left just before it
      if (isHero) {
        const ha = clamp((local - delay + 0.07) / 0.34, 0, 1);
        if (ha > 0) {
          const pad = fs * 0.14;
          g.save();
          const bw = (ww + pad * 2) * expo(ha);
          g.fillStyle = A;
          g.fillRect(x - pad, base - fs * 0.84, bw, fs * 1.06);
          g.restore();
        }
      }

      // the mask: the word slides out from behind its own line
      g.save();
      g.beginPath();
      g.rect(x - fs * 0.3, base - fs * 1.08, ww + fs * 0.6, fs * 1.32);
      g.clip();
      const e = back(a);
      g.translate(x, base + (1 - e) * fs * 0.98);
      g.globalAlpha = Math.min(1, a * 3);
      if (isHero) {
        g.fillStyle = '#05070f';
        g.fillText(w, 0, 0);
      } else {
        // cheap glow: offset low-alpha copies (shadowBlur is 10x the cost)
        g.globalAlpha = Math.min(1, a * 3) * 0.18;
        g.fillStyle = A;
        const o = fs * 0.035;
        g.fillText(w, -o, 0); g.fillText(w, o, 0); g.fillText(w, 0, -o); g.fillText(w, 0, o);
        g.globalAlpha = Math.min(1, a * 3);
        g.fillStyle = '#fff';
        g.fillText(w, 0, 0);
      }
      g.restore();
    });
  });
  g.restore();
}

/** Small uppercase kicker, revealed by a horizontal wipe. */
export function drawKicker(
  g: CanvasRenderingContext2D, text: string, cx: number, y: number, size: number,
  local: number, col: string, delay = 0.3
) {
  if (!text) return;
  const a = clamp((local - delay) / 0.5, 0, 1);
  if (a <= 0) return;
  g.save();
  g.font = `700 ${size}px ${FONT}`;
  try { (g as any).letterSpacing = `${size * 0.14}px`; } catch {}
  g.textAlign = 'center';
  const t = text.toUpperCase();
  const w = g.measureText(t).width;
  g.beginPath();
  g.rect(cx - w / 2 - size, y - size * 1.4, (w + size * 2) * expo(a), size * 2.2);
  g.clip();
  g.globalAlpha = Math.min(1, a * 2);
  g.fillStyle = col;
  g.fillText(t, cx, y);
  g.restore();
  try { (g as any).letterSpacing = '0px'; } catch {}
}

/** An accent rule that draws itself out, with a travelling bright head. */
export function drawRule(
  g: CanvasRenderingContext2D, cx: number, y: number, maxW: number, thick: number,
  local: number, A: string, B: string, delay = 0
) {
  const a = clamp((local - delay) / 0.7, 0, 1);
  if (a <= 0) return;
  const w = maxW * expo(a);
  const grd = g.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
  grd.addColorStop(0, A); grd.addColorStop(1, B);
  g.save();
  g.fillStyle = grd;
  g.fillRect(cx - w / 2, y, w, thick);
  if (a < 1) { g.globalAlpha = 1 - a; g.fillStyle = '#fff'; g.fillRect(cx + w / 2 - thick * 2, y, thick * 3, thick); }
  g.restore();
}

/* ── PARTICLES ───────────────────────────────────────────────────────────────
   Baked once into a 64px sprite, then stamped. 40 stamps of a small sprite is
   nothing; 40 radial gradients per frame would be ~14ms.
   ─────────────────────────────────────────────────────────────────────────── */

const _spr: Record<string, HTMLCanvasElement> = {};
function dotSprite(col: string) {
  if (_spr[col]) return _spr[col];
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const rg = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, col); rg.addColorStop(0.35, col + '80'); rg.addColorStop(1, col + '00');
  x.fillStyle = rg; x.fillRect(0, 0, 64, 64);
  _spr[col] = c; return c;
}

const PN = 40;
export function particles(g: CanvasRenderingContext2D, W: number, H: number, t: number, A: string, B: string, strength = 1) {
  if (strength <= 0.01) return;
  const sa = dotSprite(A), sb = dotSprite(B);
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < PN; i++) {
    const z = 0.25 + rnd(i, 2) * 0.75;                       // depth
    const sp = 0.02 + z * 0.05;
    const x = (rnd(i) + Math.sin(t * 0.5 * z + i) * 0.03) * W;
    const y = (((rnd(i, 5) + t * sp) % 1.15) - 0.08) * H;
    const s = (0.006 + z * 0.026) * W;
    g.globalAlpha = (0.10 + z * 0.30) * strength * (0.7 + beatPulse(t, 9) * 0.3);
    g.drawImage(i % 3 === 0 ? sb : sa, x - s / 2, y - s / 2, s, s);
  }
  g.restore();
}

/* ── GRADE ───────────────────────────────────────────────────────────────────
   Bloom + duotone + vignette. This trio is 90% of why a frame reads as
   "professionally coloured" rather than "canvas output".
   ─────────────────────────────────────────────────────────────────────────── */

let _bl: HTMLCanvasElement | null = null;
/** Glow: shrink the frame, crush the darks so only highlights survive, then
 *  add it back big and soft. A real bloom for about 1ms. */
export function bloom(g: CanvasRenderingContext2D, cv: HTMLCanvasElement, W: number, H: number, amount = 0.3) {
  if (amount <= 0.01) return;
  const bw = Math.max(24, Math.round(W / 9)), bh = Math.max(24, Math.round(H / 9));
  if (!_bl || _bl.width !== bw || _bl.height !== bh) {
    _bl = document.createElement('canvas'); _bl.width = bw; _bl.height = bh;
  }
  const bx = _bl.getContext('2d')!;
  bx.globalCompositeOperation = 'source-over';
  bx.clearRect(0, 0, bw, bh);
  try { bx.drawImage(cv, 0, 0, bw, bh); } catch { return; }
  bx.globalCompositeOperation = 'multiply';
  bx.drawImage(_bl, 0, 0);            // square the luminance = only highlights glow
  bx.globalCompositeOperation = 'source-over';
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = amount;
  g.drawImage(_bl, 0, 0, W, H);
  g.restore();
}

let _gKey = ''; let _gCv: HTMLCanvasElement | null = null;
/** Duotone wash + vignette, baked into one canvas and stamped soft-light. */
function gradeCv(W: number, H: number, A: string, B: string) {
  const key = `${W}x${H}|${A}|${B}`;
  if (_gCv && _gKey === key) return _gCv;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  const lg = x.createLinearGradient(0, 0, W, H);
  lg.addColorStop(0, A); lg.addColorStop(0.5, '#808080'); lg.addColorStop(1, B);
  x.fillStyle = lg; x.fillRect(0, 0, W, H);
  _gCv = c; _gKey = key; return c;
}

let _vKey = ''; let _vCv: HTMLCanvasElement | null = null;
function vignetteCv(W: number, H: number) {
  const key = `${W}x${H}`;
  if (_vCv && _vKey === key) return _vCv;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  const rg = x.createRadialGradient(W / 2, H * 0.46, H * 0.22, W / 2, H * 0.5, H * 0.76);
  rg.addColorStop(0, 'rgba(0,0,0,0)');
  rg.addColorStop(0.65, 'rgba(0,0,0,0.28)');
  rg.addColorStop(1, 'rgba(0,0,0,0.78)');
  x.fillStyle = rg; x.fillRect(0, 0, W, H);
  _vCv = c; _vKey = key; return c;
}

export function grade(g: CanvasRenderingContext2D, W: number, H: number, A: string, B: string, tone = 0.34) {
  g.save();
  g.globalCompositeOperation = 'soft-light';
  g.globalAlpha = tone;
  g.drawImage(gradeCv(W, H, A, B), 0, 0);
  g.restore();
  g.drawImage(vignetteCv(W, H), 0, 0);
}

/** RGB-ish split on impacts only. Costs nothing when amt is 0. */
export function chroma(g: CanvasRenderingContext2D, cv: HTMLCanvasElement, W: number, H: number, amt: number) {
  if (amt <= 0.02) return;
  const d = amt * W * 0.014;
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.28 * amt;
  try { g.drawImage(cv, -d, 0); g.drawImage(cv, d, 0); } catch {}
  g.restore();
}

/* ── SURFACES ────────────────────────────────────────────────────────────── */

export function roundPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** Specular sweep across a surface — the "expensive product shot" tell. */
export function sheen(
  g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
  phase: number, alpha = 0.4
) {
  const p = phase % 1;
  if (p < 0) return;
  const bw = w * 0.42;
  const bx = x - bw + (w + bw * 2) * p;
  g.save();
  roundPath(g, x, y, w, h, r); g.clip();
  const lg = g.createLinearGradient(bx, y, bx + bw, y + h);
  lg.addColorStop(0, 'rgba(255,255,255,0)');
  lg.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
  lg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = lg;
  g.fillRect(bx, y, bw, h);
  g.restore();
}

/* ── HUD / SHAPE LAYERS ──────────────────────────────────────────────────────
   Quiet geometric furniture. Individually invisible; together they're what
   makes a frame look art-directed instead of generated.
   ─────────────────────────────────────────────────────────────────────────── */

export function hud(
  g: CanvasRenderingContext2D, W: number, H: number, t: number,
  A: string, B: string, idx: number, total: number
) {
  g.save();
  const b = 0.55 + beatPulse(t, 8) * 0.45;

  // corner brackets, breathing on the beat
  const s = W * 0.048, m = W * 0.05, top = H * 0.088, bot = H * 0.90;
  g.strokeStyle = A; g.lineWidth = Math.max(1.5, W * 0.0035); g.globalAlpha = 0.30 * b;
  const corner = (x: number, y: number, dx: number, dy: number) => {
    g.beginPath(); g.moveTo(x, y + dy * s); g.lineTo(x, y); g.lineTo(x + dx * s, y); g.stroke();
  };
  corner(m, top, 1, 1); corner(W - m, top, -1, 1);
  corner(m, bot, 1, -1); corner(W - m, bot, -1, -1);

  // scrolling tick rail down the right edge
  g.globalAlpha = 0.18; g.fillStyle = B;
  for (let i = 0; i < 16; i++) {
    const y = ((i / 16 + t * 0.04) % 1) * (bot - top) + top;
    const long = i % 4 === 0;
    g.fillRect(W - m - (long ? W * 0.028 : W * 0.014), y, long ? W * 0.028 : W * 0.014, Math.max(1.2, W * 0.0025));
  }

  // scene counter, bottom left
  g.globalAlpha = 0.34;
  g.font = `700 ${W * 0.022}px ${FONT}`;
  g.textAlign = 'left'; g.fillStyle = '#cfe0ff';
  try { (g as any).letterSpacing = `${W * 0.006}px`; } catch {}
  g.fillText(`${String(idx + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, m, bot + H * 0.032);
  try { (g as any).letterSpacing = '0px'; } catch {}

  // dashed ring, slowly turning, top right
  g.globalAlpha = 0.22; g.strokeStyle = B; g.lineWidth = Math.max(1.2, W * 0.003);
  g.setLineDash([W * 0.012, W * 0.016]);
  g.beginPath(); g.arc(W - m - W * 0.055, top + W * 0.055, W * 0.036, t * 0.6, t * 0.6 + 6.28); g.stroke();
  g.setLineDash([]);
  g.restore();
}

/** Radiating burst — fires once, on impact. */
export function burst(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, a: number, A: string, B: string) {
  if (a <= 0 || a >= 1) return;
  const e = ease(a), fade = 1 - a;
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * 6.283 + 0.2;
    const r0 = R * (0.35 + e * 0.75), r1 = r0 + R * 0.16 * fade;
    g.strokeStyle = i % 2 ? A : B;
    g.globalAlpha = fade * 0.75;
    g.lineWidth = R * 0.016 * fade;
    g.beginPath();
    g.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
    g.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
    g.stroke();
  }
  g.restore();
}

/* ── TRANSITIONS ─────────────────────────────────────────────────────────────
   k runs 1 → 0 across the first ~0.28s of a shot.
   ─────────────────────────────────────────────────────────────────────────── */

export type Trans = 'cut' | 'whip' | 'flash' | 'glitch' | 'slide' | 'wipe' | 'bars' | 'smear';

export function transition(
  g: CanvasRenderingContext2D, cv: HTMLCanvasElement, W: number, H: number,
  kind: Trans, k: number, A: string, B: string
) {
  if (k <= 0 || kind === 'cut') return;
  switch (kind) {
    case 'flash':
      g.fillStyle = `rgba(255,255,255,${k * 0.55})`; g.fillRect(0, 0, W, H);
      break;

    case 'whip': {
      // directional motion blur: a few offset ghosts of the frame itself
      g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = k * 0.3;
      for (let i = 1; i <= 3; i++) { try { g.drawImage(cv, -k * i * W * 0.07, 0); } catch {} }
      g.restore();
      break;
    }

    case 'smear': {
      // vertical version — reads as a fast camera whip up
      g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = k * 0.26;
      for (let i = 1; i <= 3; i++) { try { g.drawImage(cv, 0, k * i * H * 0.05); } catch {} }
      g.restore();
      break;
    }

    case 'glitch': {
      g.save(); g.globalCompositeOperation = 'screen'; g.globalAlpha = k * 0.5;
      try { g.drawImage(cv, -k * 16, 0); g.drawImage(cv, k * 16, 0); } catch {}
      g.restore();
      for (let i = 0; i < 5; i++) {
        const sy = rnd(i + Math.floor(k * 90)) * H, sh = 6 + rnd(i, 4) * 26;
        try { g.drawImage(cv, 0, sy, W, sh, (rnd(i, 9) - 0.5) * k * 80, sy, W, sh); } catch {}
      }
      break;
    }

    case 'slide':
      g.save(); g.globalAlpha = k * 0.95; g.fillStyle = A;
      g.fillRect(0, 0, W * easeIO(k), H); g.restore();
      break;

    case 'wipe': {
      // angled hard wipe with a bright leading edge — very editorial
      const p = 1 - k, x = (-0.3 + p * 1.6) * W;
      g.save();
      g.beginPath();
      g.moveTo(x, 0); g.lineTo(x + W * 0.3, 0); g.lineTo(x - W * 0.05, H); g.lineTo(x - W * 0.35, H);
      g.closePath();
      g.fillStyle = B; g.globalAlpha = 0.9; g.fill();
      g.globalAlpha = 1; g.strokeStyle = '#fff'; g.lineWidth = Math.max(2, W * 0.004); g.stroke();
      g.restore();
      break;
    }

    case 'bars': {
      // vertical blinds falling away
      const n = 6;
      g.save(); g.fillStyle = '#05070f';
      for (let i = 0; i < n; i++) {
        const kk = clamp(k * 1.5 - (i % 2) * 0.25, 0, 1);
        const bh = H * easeIO(kk);
        g.fillRect((i / n) * W, i % 2 ? H - bh : 0, W / n + 1, bh);
      }
      g.globalAlpha = 0.5; g.fillStyle = A;
      for (let i = 0; i <= n; i++) g.fillRect((i / n) * W - 1, 0, 2, H * k);
      g.restore();
      break;
    }
  }
}

/* ── END CARD ────────────────────────────────────────────────────────────── */

let _rayCv: HTMLCanvasElement | null = null; let _rayKey = '';
function rays(A: string) {
  if (_rayCv && _rayKey === A) return _rayCv;
  const S = 512;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d')!;
  x.translate(S / 2, S / 2);
  for (let i = 0; i < 14; i++) {
    x.rotate((Math.PI * 2) / 14);
    const lg = x.createLinearGradient(0, 0, 0, -S / 2);
    lg.addColorStop(0, A + '00'); lg.addColorStop(0.45, A + '2e'); lg.addColorStop(1, A + '00');
    x.fillStyle = lg;
    x.beginPath(); x.moveTo(0, 0);
    x.lineTo(-S * 0.055, -S / 2); x.lineTo(S * 0.055, -S / 2);
    x.closePath(); x.fill();
  }
  _rayCv = c; _rayKey = A; return c;
}

let _glowCv: HTMLCanvasElement | null = null; let _glowKey = '';
function centreGlow(W: number, H: number, A: string) {
  const key = `${W}x${H}|${A}`;
  if (_glowCv && _glowKey === key) return _glowCv;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  const rg = x.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, H * 0.55);
  rg.addColorStop(0, A + '4d'); rg.addColorStop(0.45, A + '1a'); rg.addColorStop(1, A + '00');
  x.fillStyle = rg; x.fillRect(0, 0, W, H);
  _glowCv = c; _glowKey = key; return c;
}

/**
 * The pay-off frame. Logo lock-up reveals word by word, a rule draws under it,
 * then the CTA pill lands with a sheen sweep running across it.
 */
export function drawEndCardPro(
  g: CanvasRenderingContext2D, W: number, H: number,
  product: string, cta: string, endline: string, domain: string,
  p: number, A: string, B: string, t: number
) {
  const local = p * 2.6;   // seconds into the end card

  g.fillStyle = '#04060f'; g.fillRect(0, 0, W, H);
  g.drawImage(centreGlow(W, H, A), 0, 0);

  // slow turning light rays behind everything
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.55;
  g.translate(W / 2, H * 0.42);
  g.rotate(t * 0.06);
  const R = Math.max(W, H) * 1.5;
  g.drawImage(rays(A), -R / 2, -R / 2, R, R);
  g.restore();

  particles(g, W, H, t, A, B, 0.9);

  // product name — same kinetic reveal as the headlines, so it feels of a piece
  const blk = layoutHeadline(g, product || 'Your product', W * 0.84, W * 0.135, 2);
  drawKinetic(g, blk, W / 2, H * 0.44, local, A, B, 0.07, { hero: false });
  burst(g, W / 2, H * 0.40, W * 0.42, clamp((local - 0.22) / 0.75, 0, 1), A, B);

  drawRule(g, W / 2, H * 0.44 + blk.fs * 0.42, W * 0.3, Math.max(3, W * 0.006), local, A, B, 0.34);

  if (endline) {
    drawKicker(g, endline, W / 2, H * 0.44 + blk.fs * 0.42 + W * 0.075, W * 0.03, local, '#b9cbee', 0.46);
  }

  // CTA pill
  const ca = clamp((local - 0.62) / 0.5, 0, 1);
  if (ca > 0) {
    const e = back(ca);
    const cw = W * 0.62, ch = W * 0.135;
    const cx = W / 2 - cw / 2, cy = H * 0.615;
    g.save();
    g.translate(W / 2, cy + ch / 2);
    g.scale(0.86 + e * 0.14, 0.86 + e * 0.14);
    g.translate(-W / 2, -(cy + ch / 2));
    g.globalAlpha = Math.min(1, ca * 2);
    // soft cast shadow
    g.fillStyle = 'rgba(0,0,0,0.45)';
    roundPath(g, cx, cy + ch * 0.1, cw, ch, ch / 2); g.fill();
    const pg = g.createLinearGradient(cx, cy, cx + cw, cy + ch);
    pg.addColorStop(0, A); pg.addColorStop(1, B);
    g.fillStyle = pg;
    roundPath(g, cx, cy, cw, ch, ch / 2); g.fill();
    // the sweep
    if (ca >= 1) sheen(g, cx, cy, cw, ch, ch / 2, (local - 1.12) * 0.8, 0.45);
    g.fillStyle = '#04101f';
    g.textAlign = 'center';
    let fs = W * 0.046;
    g.font = `800 ${fs}px ${FONT}`;
    while (g.measureText(cta).width > cw * 0.82 && fs > W * 0.026) { fs -= W * 0.002; g.font = `800 ${fs}px ${FONT}`; }
    g.fillText(cta, W / 2, cy + ch * 0.63);
    g.restore();
  }

  // domain, quietly, under the button
  if (domain) {
    const da = clamp((local - 1.0) / 0.5, 0, 1);
    g.save();
    g.globalAlpha = da * 0.72;
    g.textAlign = 'center';
    g.font = `600 ${W * 0.03}px ${FONT}`;
    try { (g as any).letterSpacing = `${W * 0.005}px`; } catch {}
    g.fillStyle = '#9fb6df';
    g.fillText(domain, W / 2, H * 0.615 + W * 0.135 + W * 0.075);
    try { (g as any).letterSpacing = '0px'; } catch {}
    g.restore();
  }
}
