#!/usr/bin/env node
/*
 * Demo GIF #2: read-only filesystem tool through the FULL chain in the
 * real app — real Electron, real daemon over its own named pipe/Unix
 * socket, real Tier-1 sandbox. Scripted interaction recorded at 960x600,
 * 6 s @ 10 fps: deck with prefilled scope -> List -> approval card ->
 * approve (A) -> listing renders -> open file -> content renders.
 * Every frame is pngjs re-encoded (IHDR/PLTE/IDAT/IEND only); the GIF
 * carries no metadata model. Fixture content is synthetic dir/file names
 * only, under a synthetic root (D:\fsdemo on Windows so no user profile
 * path ever appears on screen; os.tmpdir() elsewhere), and the manifest
 * row is APPENDED to assets/demo/manifest.csv with scrubbed:true.
 * Usage: node scripts/capture-fs.mjs [--out assets/demo]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import pngjs from 'pngjs';
import gifenc from 'gifenc';

const { PNG } = pngjs;
const { GIFEncoder, quantize, applyPalette } = gifenc;

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const outDir = process.argv.includes('--out')
  ? path.resolve(process.argv[process.argv.indexOf('--out') + 1])
  : path.join(ROOT, 'assets', 'demo');

const IS_WIN = process.platform === 'win32';
const GIF_SHOT = { width: 960, height: 600 };
const GIF_FPS = 10;
const GIF_SECONDS = 6;

function fixtureRoot() {
  if (!IS_WIN) return mkdtempSync(path.join(tmpdir(), 'fs-demo-'));
  for (const base of ['D:\\fsdemo']) {
    try {
      mkdirSync(base, { recursive: true });
      const probe = path.join(base, '.w');
      writeFileSync(probe, 'x');
      rmSync(probe);
      return mkdtempSync(path.join(base, 'fs-demo-'));
    } catch {
      /* try next */
    }
  }
  throw new Error('no synthetic fixture root writable (need D:\\fsdemo); refusing to show a user profile path on screen');
}

function electronBinary() {
  const pkg = require.resolve('electron/package.json');
  const dir = path.dirname(pkg);
  const bin = path.join(dir, 'dist', IS_WIN ? 'electron.exe' : 'electron');
  if (!existsSync(bin)) throw new Error(`electron binary missing: ${bin}`);
  return bin;
}

function newestSourceMtime() {
  // Cheap freshness probe: newest mtime under crates/ vs the staged binary.
  let newest = 0;
  const stack = [path.join(ROOT, 'crates')];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'target') stack.push(p);
      } else if (/\.(rs|toml)$/.test(e.name)) {
        try {
          const t = statSync(p).mtimeMs;
          if (t > newest) newest = t;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return newest;
}

function ensureDaemonBinary() {
  // The app resolves cored from the repo target dir. Always build (fast
  // when fresh), then stage the binary where the app looks. Existence-only
  // checks have shipped stale daemons before; compare mtimes instead.
  const exe = IS_WIN ? 'cored.exe' : 'cored';
  const dest = path.join(ROOT, 'target', IS_WIN ? 'x86_64-pc-windows-gnu' : '', 'debug', exe);
  let destMtime = 0;
  try {
    destMtime = statSync(dest).mtimeMs;
  } catch {
    /* missing */
  }
  if (destMtime < newestSourceMtime()) {
    if (IS_WIN) {
      const binDir = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'project-one', 'bin');
      execFileSync('cargo', ['build', '--target', 'x86_64-pc-windows-gnu', '-p', 'cored'], {
        cwd: ROOT,
        env: {
          ...process.env,
          RUSTUP_TOOLCHAIN: '1.100.0-x86_64-pc-windows-gnu',
          CC_x86_64_pc_windows_gnu: path.join(binDir, 'ccwrap.exe'),
          AR_x86_64_pc_windows_gnu: `${path.join(binDir, 'zig.exe')} ar`,
          CARGO_TARGET_DIR: 'D:\\t',
          CARGO_PROFILE_DEV_CODEGEN_UNITS: '1',
        },
        stdio: 'pipe',
        timeout: 600000,
      });
      const built = path.join('D:', 't', 'x86_64-pc-windows-gnu', 'debug', exe);
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(built));
      console.log(`capture-fs: built + staged daemon ${built} -> ${dest}`);
      return dest;
    }
    execFileSync('cargo', ['build', '-p', 'cored'], { cwd: ROOT, stdio: 'pipe', timeout: 600000 });
  } else {
    console.log('capture-fs: daemon binary is newer than sources; reusing');
  }
  return dest;
}

function stripPng(buf) {
  const png = PNG.sync.read(buf);
  const clean = new PNG({ width: png.width, height: png.height });
  png.data.copy(clean.data);
  return { data: PNG.sync.write(clean), width: png.width, height: png.height };
}

function auditAncillary(buf, label) {
  if (buf[0] !== 137 || buf.toString('latin1', 1, 4) !== 'PNG') throw new Error(`${label}: not a PNG`);
  let pos = 8;
  const found = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (type !== 'IHDR' && type !== 'PLTE' && type !== 'IDAT' && type !== 'IEND') found.push(type);
    if (type === 'IEND') break;
    pos += 12 + len;
    if (found.length > 0) break;
  }
  if (found.length > 0) throw new Error(`${label}: ancillary chunks present: ${found.join(',')}`);
}

async function main() {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-desktop.mjs')], { cwd: ROOT, stdio: 'inherit' });
  ensureDaemonBinary();

  const root = fixtureRoot();
  const scope = path.join(root, 'fs-demo-scope');
  mkdirSync(scope, { recursive: true });
  mkdirSync(path.join(scope, 'sub'), { recursive: true });
  writeFileSync(path.join(scope, 'note-01.txt'), 'hello from the fixture\n');
  writeFileSync(path.join(scope, 'sub', 'guide.txt'), 'nested file, sandboxed read\n');
  writeFileSync(path.join(scope, 'notes.bin'), Buffer.from([0, 1, 2, 250, 251]));
  console.log(`capture-fs: fixture scope ${scope}`);

  const userData = mkdtempSync(path.join(tmpdir(), 'fs-capture-profile-'));
  const electron = electronBinary();
  const debugPort = 19321;
  const proc = spawn(electron, [path.join(ROOT, 'apps', 'desktop'), `--user-data-dir=${userData}`, `--remote-debugging-port=${debugPort}`], {
    cwd: path.join(ROOT, 'apps', 'desktop'),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  proc.stderr.on('data', (d) => {
    stderr += d.toString('utf8');
  });
  proc.on('error', (e) => {
    throw e;
  });

  const { default: puppeteer } = await import('puppeteer');
  let browser = null;
  for (let i = 0; i < 100 && !browser; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}`, protocolTimeout: 120000 });
    } catch {
      if (proc.exitCode !== null) throw new Error(`electron exited early (code ${proc.exitCode}); stderr:\n${stderr.slice(-2000)}`);
    }
  }
  if (!browser) throw new Error('could not connect to electron over CDP');
  try {
    const pages = await browser.pages();
    const pg = pages.find((p) => p.url().startsWith('file:')) ?? pages[0];
    await pg.setViewport({ width: GIF_SHOT.width, height: GIF_SHOT.height });
    await pg.emulateTimezone('UTC');
    const errors = [];
    pg.on('pageerror', (e) => errors.push(String(e)));
    pg.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    // Wait for the deck canvas (FirstRun -> open the deck).
    await pg.waitForFunction(() => (document.body.textContent || '').includes('Open the deck'), { timeout: 60000 });
    await pg.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Open the deck'));
      if (btn) btn.click();
    });
    // Wait for first paint of the deck before scripting.
    await pg.waitForFunction(() => (document.body.textContent || '').includes('Files (read-only)'), { timeout: 60000 });
    // Prefill the scope (no typing of paths on screen), then record.
    // NOTE: pass the raw path, not a JSON-quoted one — quotes would make
    // the scope invalid and the error state has no approval card.
    await pg.evaluate((s) => {
      const input = document.querySelector('input[aria-label="Directory to list"]');
      if (!input) throw new Error('scope input missing');
      input.focus();
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, s);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, scope).catch(async () => {
      // Fallback for React-controlled inputs: set the native value.
      await pg.evaluate((s) => {
        const input = document.querySelector('input[aria-label="Directory to list"]');
        const proto = input instanceof HTMLInputElement ? Object.getPrototypeOf(input) : null;
        const desc = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
        if (input && desc && desc.set) {
          desc.set.call(input, s);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, scope);
    });
    // Keyboard shortcuts (A/D/E) are ignored while an input has focus —
    // by design, so typing never approves anything. Blur out of the
    // prefilled input so the scripted keys reach the card.
    await pg.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await new Promise((r) => setTimeout(r, 500));
    const prefilled = await pg.evaluate(() => {
      const input = document.querySelector('input[aria-label="Directory to list"]');
      return input ? input.value : null;
    });
    if (prefilled !== scope) throw new Error(`prefill failed: got ${JSON.stringify(prefilled)}`);

    // Record 6 s @ 10 fps while driving the chain. Blocking waits keep the
    // action ORDER deterministic; the frame COUNT stays exactly 60 (6 s).
    const frames = Math.floor(GIF_FPS * GIF_SECONDS);
    const gif = GIFEncoder();
    const clickList = async () => {
      await pg.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'List files');
        if (!btn) throw new Error('List button missing');
        btn.click();
      });
    };
    const clickFirstFile = async () => {
      await pg.waitForFunction(() => [...document.querySelectorAll('li button')].some((b) => !(b.textContent || '').trim().startsWith('dir ')), { timeout: 15000 });
      await pg.evaluate(() => {
        const btns = [...document.querySelectorAll('li button')];
        const f = btns.find((b) => !(b.textContent || '').trim().startsWith('dir '));
        if (!f) throw new Error('no file row yet');
        f.click();
      });
    };
    for (let i = 0; i < frames; i += 1) {
      if (i % 10 === 0) console.log(`capture: frame ${i}/${frames}`);
      if (i === 2) await clickList();
      if (i === 3) {
        // Fail fast with an actionable message instead of timing out below:
        // a stale single-tool grant from an earlier run blocks new scopes.
        const err = await pg.evaluate(() => {
          const el = [...document.querySelectorAll('[role="alert"]')].find((e) => (e.textContent || '').includes('File tool failed'));
          return el ? el.textContent.slice(0, 200) : null;
        });
        if (err) throw new Error(`deck reports a tool error (revoke stale fs grants and retry): ${err}`);
      }
      if (i === 14) {
        console.log('capture: waiting for approval card');
        await pg.waitForFunction(() => [...document.querySelectorAll('[data-testid="files-approval"] [data-testid="approval-card-pending"]')].length > 0, { timeout: 15000 });
        await new Promise((r) => setTimeout(r, 800));
        console.log('capture: card visible');
        const cardShot = await pg.screenshot({ encoding: 'binary' });
        const cardClean = stripPng(Buffer.from(cardShot));
        auditAncillary(cardClean.data, 'fs-deck-approval');
        writeFileSync(path.join(outDir, 'fs-deck-approval-brass-void.png'), cardClean.data);
        console.log('capture: approval still saved');
      }
      if (i === 24) {
        console.log('capture: approving');
        await pg.keyboard.press('a');
      }
      if (i === 36) {
        const outcome = await pg.waitForFunction(
          () => {
            if ([...document.querySelectorAll('li button')].length > 0) return 'rows';
            const err = [...document.querySelectorAll('[role="alert"]')].find((e) => /File tool failed/i.test(e.textContent || ''));
            if (err) return `error: ${(err.textContent || '').slice(0, 200)}`;
            return false;
          },
          { timeout: 30000 },
        );
        if (typeof outcome === 'string' && outcome.startsWith('error')) {
          throw new Error(`deck reported a tool error (a stale fs grant blocks new scopes: revoke and re-run): ${outcome}`);
        }
        console.log('capture: rows visible, opening first file');
        await clickFirstFile();
      }
      if (i === 42) {
        await pg.waitForFunction(() => [...document.querySelectorAll('[data-testid="files-approval"] [data-testid="approval-card-pending"]')].length > 0, { timeout: 15000 });
        await new Promise((r) => setTimeout(r, 800));
        console.log('capture: approving read');
        await pg.keyboard.press('a').catch(() => undefined);
      }
      if (i === 52) {
        console.log('capture: waiting for file content');
        let seen;
        try {
          const handle = await pg.waitForFunction(
            () => {
              if ((document.body.textContent || '').includes('hello from the fixture')) return 'content';
              const err = [...document.querySelectorAll('[role="alert"]')].find((e) => /File tool failed/i.test(e.textContent || ''));
              if (err) return `error: ${(err.textContent || '').slice(0, 200)}`;
              return false;
            },
            { timeout: 30000 },
          );
          seen = await handle.jsonValue().catch(() => 'unreadable');
        } catch (e) {
          throw new Error(`file content never rendered: ${String(e).split('\n')[0]}`);
        }
        if (seen !== 'content') throw new Error(`file content never rendered (${String(seen).slice(0, 200)})`);
        console.log('capture: content rendered');
      }
      const shot = await pg.screenshot({ encoding: 'binary' });
      const png = PNG.sync.read(Buffer.from(shot));
      const palette = quantize(png.data, 256, { format: 'rgba4444' });
      const index = applyPalette(png.data, palette, 'rgba4444');
      gif.writeFrame(index, png.width, png.height, { palette, delay: Math.round(1000 / GIF_FPS) });
      await new Promise((r) => setTimeout(r, 5));
    }
    if (errors.length > 0) throw new Error(`page errors during capture: ${errors.join('; ').slice(0, 500)}`);
    gif.finish();
    const gifBytes = Buffer.from(gif.bytes());
    if (!gifBytes.subarray(0, 6).toString('latin1').startsWith('GIF89')) throw new Error('GIF magic missing');
    if (gifBytes.length > 5 * 1024 * 1024) throw new Error(`GIF too large: ${gifBytes.length} bytes (budget 5 MB)`);

    // Still PNG: listing rendered (separate clean frame, scrubbed).
    await pg.waitForFunction(() => [...document.querySelectorAll('li button')].length > 0, { timeout: 15000 });
    const still = await pg.screenshot({ encoding: 'binary' });
    const clean = stripPng(Buffer.from(still));
    auditAncillary(clean.data, 'fs-deck');

    const capturedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const gifName = 'fs-deck-demo.gif';
    writeFileSync(path.join(outDir, gifName), gifBytes);
    const gifHash = createHash('sha256').update(gifBytes).digest('hex');
    const stillName = 'fs-deck-listed-brass-void.png';
    writeFileSync(path.join(outDir, stillName), clean.data);
    const stillHash = createHash('sha256').update(clean.data).digest('hex');
    const cardStillPath = path.join(outDir, 'fs-deck-approval-brass-void.png');
    const cardBytes = readFileSync(cardStillPath);
    const cardPng = PNG.sync.read(cardBytes);
    const cardHash = createHash('sha256').update(cardBytes).digest('hex');
    const manifestPath = path.join(outDir, 'manifest.csv');
    const existing = readFileSync(manifestPath, 'utf8').trimEnd() + '\n';
    const rows = [
      [gifName, 'FS-DECK', 'fs-list-approve-read', 'brass-void', `${GIF_SHOT.width}x${GIF_SHOT.height}`, `${GIF_SECONDS}s@${GIF_FPS}fps`, gifHash, capturedAt, 'true'].join(','),
      ['fs-deck-approval-brass-void.png', 'FS-DECK', 'fs-approval-card', 'brass-void', `${cardPng.width}x${cardPng.height}`, 'still', cardHash, capturedAt, 'true'].join(','),
      [stillName, 'FS-DECK', 'fs-listed', 'brass-void', `${clean.width}x${clean.height}`, 'still', stillHash, capturedAt, 'true'].join(','),
    ];
    writeFileSync(manifestPath, existing + rows.join('\n') + '\n');
    console.log(`capture-fs: wrote ${gifName} (${gifBytes.length} bytes) + ${stillName} + manifest rows (fixture root synthetic)`);
    await browser.close();
  } finally {
    try {
      await browser?.close();
    } catch {
      /* already gone */
    }
    proc.kill();
    await new Promise((r) => {
      const t = setTimeout(r, 10000);
      proc.on('exit', () => {
        clearTimeout(t);
        r(null);
      });
    });
    rmSync(root, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
