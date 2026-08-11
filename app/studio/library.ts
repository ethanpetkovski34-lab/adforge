// Saved ads live in IndexedDB — localStorage tops out around 5MB and a single
// ad is several megabytes of video, so it's the only sensible place for them.

export type SavedAd = {
  id: string;
  product: string;
  headline: string;
  created: number;      // epoch ms
  duration: number;     // seconds
  size: number;         // bytes
  thumb: string;        // small jpeg data-url for the grid
  blob: Blob;           // the actual video
  mime?: string;        // what it was recorded as — decides the file extension
};

/** mp4 opens everywhere and uploads to TikTok/Reels/Shorts; webm does neither,
 *  so the extension has to follow what was actually recorded. */
export const extFor = (mime?: string) =>
  (mime || '').includes('mp4') ? 'mp4' : 'webm';

export function fileName(product: string, mime?: string) {
  const stem = (product || 'ad').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ad';
  return `${stem}-adforge.${extFor(mime)}`;
}

const DB = 'adforge';
const STORE = 'ads';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('created', 'created');
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise<T>((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => res(req.result as T);
    req.onerror = () => rej(req.error);
    t.oncomplete = () => db.close();
  });
}

export async function saveAd(ad: SavedAd): Promise<void> {
  try { await tx('readwrite', s => s.put(ad)); } catch {}
}

/** Newest first. Never throws — a broken library shouldn't break the studio. */
export async function listAds(): Promise<SavedAd[]> {
  try {
    const all = await tx<SavedAd[]>('readonly', s => s.getAll());
    return (all || []).sort((a, b) => b.created - a.created);
  } catch { return []; }
}

export async function deleteAd(id: string): Promise<void> {
  try { await tx('readwrite', s => s.delete(id)); } catch {}
}

export async function clearAds(): Promise<void> {
  try { await tx('readwrite', s => s.clear()); } catch {}
}

/** Grab a still from the canvas to use as the library thumbnail. */
export function makeThumb(canvas: HTMLCanvasElement, w = 180): string {
  try {
    const h = Math.round((canvas.height / canvas.width) * w);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(canvas, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.6);
  } catch { return ''; }
}

export const prettySize = (b: number) =>
  b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';

export const prettyDate = (t: number) => {
  const d = new Date(t), now = Date.now();
  const mins = Math.round((now - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  if (mins < 1440) return Math.round(mins / 60) + 'h ago';
  if (mins < 10080) return Math.round(mins / 1440) + 'd ago';
  return d.toLocaleDateString();
};
