// Main entry: single instance, daemon lifecycle, allowlisted IPC.
import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import cfg from '../../../../branding.config.json';
import { DaemonManager, type ConnState } from './daemon.js';
import { createWindow } from './window.js';

const BRIDGE: string = cfg.cliBinary;
const ALLOWED = new Set(['system.health', 'system.info']);
const t0 = Date.now();

let manager: DaemonManager | null = null;
let mainWindow: BrowserWindow | null = null;

function coredPath(): string {
  const candidates = [
    path.join(app.getAppPath(), '..', '..', 'target', 'x86_64-pc-windows-gnu', 'debug', 'cored.exe'),
    path.join(app.getAppPath(), '..', '..', 'target', 'debug', 'cored.exe'),
    path.join(process.resourcesPath, 'cored.exe'),
  ];
  for (const c of candidates) {
    try {
      fs.accessSync(c);
      return c;
    } catch {
      /* try next */
    }
  }
  return candidates[0];
}

function broadcastState(s: ConnState) {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(`${BRIDGE}:event:daemon.state`, s);
  }
}

async function boot() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    console.log('app: second instance refused');
    app.quit();
    return;
  }
  const here = __dirname;
  manager = new DaemonManager(coredPath(), app.getPath('temp'));
  manager.on('state', (s: ConnState) => broadcastState(s));
  mainWindow = createWindow(path.join(here, '..', 'preload', 'index.js'), path.join(here, '..', 'renderer', 'index.html'));

  ipcMain.handle(`${BRIDGE}:invoke`, async (_e, payload: unknown) => {
    const p = payload as { method?: unknown; params?: unknown };
    if (!p || typeof p.method !== 'string' || !ALLOWED.has(p.method) || !/^[a-z]+\.[a-z]+$/.test(p.method)) {
      throw new Error(`blocked method: ${String((p as { method?: unknown })?.method)}`);
    }
    if (!manager) throw new Error('daemon not started');
    return manager.invoke(p.method, p.params ?? {});
  });

  try {
    await manager.start();
    const health = (await manager.invoke('system.health', {})) as { ok?: boolean };
    if (!health || health.ok !== true) throw new Error('health not ok');
    console.log(`ready in ${Date.now() - t0}ms`);
    console.log('smoke: handshake ok');
    if (process.env['E2E_SMOKE'] === '1') {
      await manager.shutdown();
      app.quit();
    }
  } catch (e) {
    console.log(`boot: fatal (${(e as Error).message}); quitting`);
    try {
      await manager?.shutdown();
    } catch {
      /* already down */
    }
    app.exit(1);
  }
}

void app.whenReady().then(boot);

app.on('window-all-closed', () => {
  void manager?.shutdown().finally(() => app.quit());
});

app.on('before-quit', () => {
  void manager?.shutdown();
});

process.on('uncaughtException', (e) => {
  console.log(`app: uncaught (${e.message}); quitting`);
  void manager?.shutdown().finally(() => app.exit(1));
});
