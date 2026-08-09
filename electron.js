// AdForge desktop app — a thin native wrapper around the hosted studio.
// It loads the live site, so no API keys ever ship inside the download.
// Ads are built from an uploaded video or straight from the user's website,
// so there's no screen-capture plumbing to go wrong.
const { app, BrowserWindow } = require('electron');
const path = require('path');

const HOSTED_URL = 'https://makeadforge.vercel.app/studio';
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 900, minWidth: 900, minHeight: 700,
    backgroundColor: '#05060f',
    titleBarStyle: 'hiddenInset',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    show: false,
  });
  win.loadURL(HOSTED_URL);
  win.once('ready-to-show', () => { win.show(); win.focus(); });
  win.on('closed', () => { win = null; });

  const ses = win.webContents.session;
  // Allow mic (voice preview) without extra prompts.
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(true));
  try { ses.setPermissionCheckHandler(() => true); } catch {}
  // Downloads (the finished ad) land in the user's Downloads folder.
  ses.on('will-download', (e, item) => {
    item.setSavePath(path.join(app.getPath('downloads'), item.getFilename()));
  });

  // Keep external links in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('https://makeadforge.vercel.app')) {
      require('electron').shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!win) createWindow(); });
