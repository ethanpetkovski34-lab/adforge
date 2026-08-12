// Backgrounds.
//
// Every ad used to open on the same dark blue wash, which is the single biggest
// reason they all looked like the same template. These are eight genuinely
// different worlds — including a light one, because "premium" is often white,
// not black.
//
// Performance rule throughout: bake anything static into an offscreen canvas
// once and stamp it. Per-frame gradients at 1080x1920 are what make renders
// stutter.

export type BackdropKind =
  | 'aurora' | 'space' | 'mesh' | 'grid'
  | 'spotlight' | 'waves' | 'paper' | 'noir';

export const BACKDROPS: { id: BackdropKind; name: string; blurb: string }[] = [
  { id: 'aurora',    name: 'Aurora',        blurb: 'Soft drifting colour ribbons' },
  { id: 'space',     name: 'Deep space',    blurb: 'Stars and slow nebula glow' },
  { id: 'mesh',      name: 'Colour mesh',   blurb: 'Big blurred blobs, modern SaaS' },
  { id: 'grid',      name: 'Tech grid',     blurb: 'Perspective grid racing to a horizon' },
  { id: 'spotlight', name: 'Studio',        blurb: 'One clean spotlight, product-shot feel' },
  { id: 'waves',     name: 'Waves',         blurb: 'Smooth flowing lines, calm' },
  { id: 'paper',     name: 'Paper (light)', blurb: 'Bright and minimal — dark text' },
  { id: 'noir',      name: 'Noir',          blurb: 'Black with hard shafts of light' },
];

/** Light backgrounds need dark type. */
export const isLightBackdrop = (k: BackdropKind) => k === 'paper';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rnd = (i: number, s = 1) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };

/* ── cached pieces ───────────────────────────────────────────────────────── */

const blobs: Record<string, HTMLCanvasElement> = {};
/** Big soft colour ball. One drawImage instead of a per-frame radial gradient. */
function blob(col: string, soft = 0.42) {
  const key = col + soft;
  if (blobs[key]) return blobs[key];
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, col);
  g.addColorStop(soft, col + '66');
  g.addColorStop(1, col + '00');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  blobs[key] = c; return c;
}

const layers: Record<string, HTMLCanvasElement> = {};
function layer(key: string, W: number, H: number, paint: (x: CanvasRenderingContext2D) => void) {
  const k = `${key}|${W}x${H}`;
  if (layers[k]) return layers[k];
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  paint(c.getContext('2d')!);
  layers[k] = c; return c;
}

function starfield(W: number, H: number) {
  return layer('stars', W, H, x => {
    x.fillStyle = '#fff';
    for (let i = 0; i < 260; i++) {
      const r = rnd(i) * W, s = rnd(i, 2) * H;
      const size = 0.6 + rnd(i, 3) * 2.0;
      x.globalAlpha = 0.18 + rnd(i, 4) * 0.7;
      x.beginPath(); x.arc(r, s, size, 0, 7); x.fill();
    }
    x.globalAlpha = 1;
  });
}

function grainTile() {
  return layer('grain', 128, 128, x => {
    const img = x.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (Math.random() - 0.5) * 90;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.random() < 0.5 ? 26 : 0;
    }
    x.putImageData(img, 0, 0);
  });
}

/* ── the backdrops ───────────────────────────────────────────────────────── */

/** These are built from big soft additive fills, where cost is purely pixels
 *  touched. Rendering at half size and scaling up is visually identical and
 *  roughly four times cheaper. Line-based ones stay full-res to keep edges crisp. */
const SOFT: Record<BackdropKind, boolean> = {
  aurora: true, space: true, mesh: true, spotlight: true, noir: true, paper: true,
  grid: false, waves: false,
};

let _sc: HTMLCanvasElement | null = null;
function scratch(w: number, h: number) {
  if (!_sc || _sc.width !== w || _sc.height !== h) {
    _sc = document.createElement('canvas'); _sc.width = w; _sc.height = h;
  }
  return _sc;
}

/**
 * Paints the full-frame background for one moment of the ad.
 * `t` is seconds since the ad started.
 */
export function drawBackdrop(
  kind: BackdropKind, g: CanvasRenderingContext2D,
  W: number, H: number, t: number, A: string, B: string
) {
  if (!SOFT[kind]) { paintBackdrop(kind, g, W, H, t, A, B); return; }
  const w = Math.max(2, Math.round(W / 2)), h = Math.max(2, Math.round(H / 2));
  const c = scratch(w, h);
  const cx = c.getContext('2d', { alpha: false })!;
  paintBackdrop(kind, cx, w, h, t, A, B);
  g.drawImage(c, 0, 0, W, H);
}

function paintBackdrop(
  kind: BackdropKind, g: CanvasRenderingContext2D,
  W: number, H: number, t: number, A: string, B: string
) {
  const D = Math.max(W, H);

  switch (kind) {
    case 'space': {
      g.fillStyle = '#02030a'; g.fillRect(0, 0, W, H);
      g.save();
      // slow parallax drift so it never feels like a still image
      g.globalAlpha = 0.8;
      g.drawImage(starfield(W, H), 0, -((t * 6) % H));
      g.drawImage(starfield(W, H), 0, -((t * 6) % H) + H);
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.5;
      const n1 = D * 1.5;
      g.drawImage(blob(A), W * 0.25 - n1 / 2 + Math.sin(t * 0.13) * W * 0.08, H * 0.3 - n1 / 2, n1, n1);
      g.globalAlpha = 0.36;
      g.drawImage(blob(B), W * 0.8 - n1 / 2, H * 0.72 - n1 / 2 + Math.cos(t * 0.11) * H * 0.05, n1, n1);
      g.restore();
      break;
    }

    case 'mesh': {
      g.fillStyle = '#070a18'; g.fillRect(0, 0, W, H);
      g.save();
      g.globalCompositeOperation = 'lighter';
      const S = D * 1.15;
      const pts: [number, number, string, number][] = [
        [0.22 + Math.sin(t * 0.21) * 0.10, 0.26 + Math.cos(t * 0.17) * 0.08, A, 0.55],
        [0.80 + Math.cos(t * 0.19) * 0.09, 0.34 + Math.sin(t * 0.23) * 0.07, B, 0.5],
        [0.34 + Math.sin(t * 0.15 + 2) * 0.11, 0.78 + Math.cos(t * 0.2) * 0.06, B, 0.42],
        [0.74 + Math.cos(t * 0.24 + 1) * 0.08, 0.82 + Math.sin(t * 0.16) * 0.07, A, 0.4],
      ];
      for (const [px, py, col, al] of pts) {
        g.globalAlpha = al;
        g.drawImage(blob(col, 0.3), px * W - S / 2, py * H - S / 2, S, S);
      }
      g.restore();
      break;
    }

    case 'grid': {
      g.fillStyle = '#04060f'; g.fillRect(0, 0, W, H);
      const hz = H * 0.46;                       // horizon
      g.drawImage(layer('grid-glow' + A, W, H, x => {
        const hg = x.createLinearGradient(0, hz - H * 0.16, 0, hz + H * 0.06);
        hg.addColorStop(0, A + '00'); hg.addColorStop(1, A + '55');
        x.fillStyle = hg; x.fillRect(0, hz - H * 0.16, W, H * 0.22);
      }), 0, 0);
      g.save();
      g.strokeStyle = A; g.globalAlpha = 0.5; g.lineWidth = Math.max(1, W * 0.0022);
      // verticals converging on a vanishing point
      for (let i = -8; i <= 8; i++) {
        g.beginPath(); g.moveTo(W / 2 + i * W * 0.22, H);
        g.lineTo(W / 2 + i * W * 0.012, hz); g.stroke();
      }
      // horizontals scrolling toward the viewer
      for (let i = 0; i < 14; i++) {
        const k = ((i / 14) + (t * 0.16)) % 1;
        const y = hz + Math.pow(k, 2.4) * (H - hz);
        g.globalAlpha = 0.5 * (1 - k) + 0.06;
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      }
      g.restore();
      break;
    }

    case 'spotlight': {
      const bg = layer('spot-bg', W, H, x => {
        const lg = x.createLinearGradient(0, 0, 0, H);
        lg.addColorStop(0, '#1a1d26'); lg.addColorStop(0.55, '#0d0f16'); lg.addColorStop(1, '#05060a');
        x.fillStyle = lg; x.fillRect(0, 0, W, H);
      });
      g.drawImage(bg, 0, 0);
      g.save();
      g.globalCompositeOperation = 'lighter';
      // one soft pool of light that breathes
      const s = D * (1.0 + Math.sin(t * 0.5) * 0.03);
      g.globalAlpha = 0.30;
      g.drawImage(blob('#ffffff', 0.22), W / 2 - s / 2, H * 0.34 - s / 2, s, s);
      g.globalAlpha = 0.20;
      g.drawImage(blob(A, 0.28), W / 2 - s / 2, H * 0.34 - s / 2, s * 0.8, s * 0.8);
      g.restore();
      break;
    }

    case 'waves': {
      g.fillStyle = '#050813'; g.fillRect(0, 0, W, H);
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.lineWidth = Math.max(1.5, W * 0.004);
      for (let i = 0; i < 9; i++) {
        const p = i / 9;
        g.strokeStyle = i % 2 ? B : A;
        g.globalAlpha = 0.10 + (1 - p) * 0.20;
        g.beginPath();
        const baseY = H * (0.18 + p * 0.72);
        const amp = H * 0.045 * (0.5 + p);
        for (let x = 0; x <= W; x += W / 24) {
          const y = baseY + Math.sin(x / W * 5 + t * (0.8 + p * 0.5) + i) * amp;
          x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
        }
        g.stroke();
      }
      g.restore();
      break;
    }

    case 'paper': {
      // Grain is baked ONCE into the cached plate. Tiling it live was ~135
      // drawImage calls a frame and made this the most expensive backdrop by 3x.
      const bg = layer('paper-bg', W, H, x => {
        const lg = x.createLinearGradient(0, 0, W, H);
        lg.addColorStop(0, '#fdfcf9'); lg.addColorStop(0.55, '#f4f1ea'); lg.addColorStop(1, '#e9e5dc');
        x.fillStyle = lg; x.fillRect(0, 0, W, H);
        x.globalAlpha = 0.5;
        const gt = grainTile();
        for (let y = 0; y < H; y += 128) for (let xx = 0; xx < W; xx += 128) x.drawImage(gt, xx, y);
        x.globalAlpha = 1;
      });
      g.drawImage(bg, 0, 0);
      g.save();
      // a couple of very soft brand-tinted washes so it isn't dead flat
      g.globalAlpha = 0.16;
      const s = D * 1.1;
      g.drawImage(blob(A, 0.3), W * 0.15 - s / 2 + Math.sin(t * 0.16) * W * 0.04, H * 0.2 - s / 2, s, s);
      g.globalAlpha = 0.12;
      g.drawImage(blob(B, 0.3), W * 0.9 - s / 2, H * 0.85 - s / 2 + Math.cos(t * 0.14) * H * 0.03, s, s);
      g.restore();
      break;
    }

    case 'noir': {
      // The shafts are baked into one wide tile and scrolled. Building four
      // gradients a frame cost more than the pixels did, and no amount of
      // resolution reduction helps with that.
      const tile = layer('noir-shafts' + A, W * 2, H, x => {
        for (let i = 0; i < 8; i++) {
          const off = (i / 8) * W * 2;
          const wdt = W * 0.16;
          const lg = x.createLinearGradient(off, 0, off + wdt, H);
          lg.addColorStop(0, 'rgba(255,255,255,0)');
          lg.addColorStop(0.5, i % 2 ? A + '30' : 'rgba(255,255,255,0.10)');
          lg.addColorStop(1, 'rgba(255,255,255,0)');
          x.fillStyle = lg;
          x.beginPath();
          x.moveTo(off, 0); x.lineTo(off + wdt, 0);
          x.lineTo(off + wdt - W * 0.4, H); x.lineTo(off - W * 0.4, H);
          x.closePath(); x.fill();
        }
      });
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      g.save();
      g.globalCompositeOperation = 'lighter';
      const sx = -((t * 14) % W);
      g.drawImage(tile, sx, 0);
      g.restore();
      break;
    }

    case 'aurora':
    default: {
      g.fillStyle = '#04060f'; g.fillRect(0, 0, W, H);
      g.save();
      g.globalCompositeOperation = 'lighter';
      const S = D * 1.3;
      for (let i = 0; i < 3; i++) {
        const ph = t * (0.13 + i * 0.045) + i * 2.1;
        g.globalAlpha = 0.34 - i * 0.06;
        g.drawImage(
          blob(i === 1 ? B : A, 0.34),
          (0.5 + Math.sin(ph) * 0.32) * W - S / 2,
          (0.32 + i * 0.22 + Math.cos(ph * 0.8) * 0.10) * H - S / 2,
          S, S * 0.62,
        );
      }
      g.restore();
      break;
    }
  }
}

/** Some backdrops want the footage/UI card to sit on a darker plate to stay legible. */
export function needsPlate(kind: BackdropKind) {
  return kind === 'paper';
}

export const backdropInk = (kind: BackdropKind) =>
  isLightBackdrop(kind)
    ? { ink: '#0b0f1c', dim: '#5a6376', plate: 'rgba(255,255,255,0.72)' }
    : { ink: '#ffffff', dim: '#b9cbee', plate: 'rgba(8,12,28,0.55)' };
