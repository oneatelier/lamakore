// Window creation: locked-down webPreferences, strict CSP, no remote
// navigation, no new windows, no remote modules. Ever.
import { BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { THEMES } from '../../../../packages/ui/src/tokens/generated.js';

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' file:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'none'";
// style-src keeps 'unsafe-inline' ONLY because React sets inline styles;
// the build bans raw hex elsewhere and a follow-up moves styles to classes.

export function createWindow(preloadPath: string, indexHtml: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    backgroundColor: THEMES['brass-void'].colors['surface-void'],
    webPreferences: {      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: preloadPath,
    },
  });
  win.webContents.session.webRequest.onHeadersReceived((details, done) => {
    done({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
      },
    });
  });
  const startUrl = `file://${indexHtml}`;
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== startUrl) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  void win.loadFile(indexHtml);
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.log(`window: load failed ${code} ${desc}`);
  });
  // External links never open inside the app; the shell has no browser UI.
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });
  return win;
}
