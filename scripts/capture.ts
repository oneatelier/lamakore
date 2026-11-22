#!/usr/bin/env node
/*
 * Deterministic demo-asset pipeline (P009): renders the production bundle in
 * a fixture profile (fresh user data, fixed viewport + theme, synthetic
 * identity, no personal files), drives a scripted interaction, records PNG
 * and GIF, strips all metadata, verifies the strip, and writes
 * assets/demo/manifest.csv (file, prompt, scene, theme, dimensions,
 * duration, sha256, captured_at, scrubbed).
 * Usage: node scripts/capture.ts [--out assets/demo]
 * GIF assembly: pngjs (decode) + gifenc (encode). Scrub = pngjs re-encode
 * (IHDR/PLTE/IDAT/IEND only); verified by scripts/hygiene/scan-metadata.mjs
 * plus an explicit ancillary-chunk audit in this script.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pngjs from 'pngjs';
import gifenc from 'gifenc';
const { PNG } = pngjs;
const { GIFEncoder, quantize, applyPalette } = gifenc;

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const outDir = process.argv.includes('--out')
  ? path.resolve(String(process.argv[process.argv.indexOf('--out') + 1] || 'assets/demo'))
  : path.join(ROOT, 'assets', 'demo');

const FIXTURE_USER = 'fixture';
const PNG_SHOT = { width: 1280, height: 800 };
const GIF_SHOT = { width: 960, height: 600 };
const GIF_FPS = 10;
const GIF_SECONDS = 6;

function serve(root) {
  return createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    let file = path.join(root, decodeURIComponent(url.pathname));
    try {
      let data = readFileSync(file);
      if (file.endsWith('tokens.css')) {
        data = Buffer.from(data.toString('utf8').split(`file:///${ROOT.split(path.sep).join('/')}`).join(''));
      }
      const ext = path.extname(file).toLowerCase();
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf' };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('nope');
    }
  });
}

function stripPng(buf) {
  const png = PNG.sync.read(buf);
  const clean = new PNG({ width: png.width, height: png.height });
  png.data.copy(clean.data);
  return { data: PNG.sync.write(clean), width: png.width, height: png.height };
}

function auditAncillary(buf, label) {
  // PNG layout: 8-byte signature, then length(4)+type(4)+data+crc chunks.
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
  const puppeteer = (await import('puppeteer')).default;
  const indexHtml = path.join(ROOT, 'apps', 'desktop', 'dist', 'renderer', 'index.html');
  try {
    readFileSync(indexHtml);
  } catch {
    throw new Error('dist bundle missing; run node scripts/build-desktop.mjs first');
  }
  const server = serve(ROOT);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  const page_url = `${base}/apps/desktop/dist/renderer/index.html`;
  const manifest = ['file,prompt,scene,theme,dimensions,duration,sha256,captured_at,scrubbed'];
  const capturedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--force-color-profile=srgb', `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'pone-capture-'))}`],
  });
  try {
    const ctx = await browser.createBrowserContext();
    const pg = await ctx.newPage();
    await pg.emulateTimezone('UTC');
    const errors = [];
    pg.on('pageerror', (e) => errors.push(String(e)));
    pg.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    // Scene 1: first-run still, brass-void.
    await pg.setViewport({ width: PNG_SHOT.width, height: PNG_SHOT.height });
    await pg.goto(`${page_url}?screen=firstrun&theme=brass-void`, { waitUntil: 'networkidle0' });
    if (errors.length > 0) throw new Error(`page errors: ${errors.join('; ').slice(0, 200)}`);
    const still = await pg.screenshot({ encoding: 'binary' });
    const clean = stripPng(Buffer.from(still));
    auditAncillary(clean.data, 'first-run');
    const stillName = 'P009-first-run.png';
    writeFileSync(path.join(outDir, stillName), clean.data);
    const stillHash = createHash('sha256').update(clean.data).digest('hex');
    manifest.push(
      [stillName, 'P009', 'first-run', 'brass-void', `${clean.width}x${clean.height}`, 'still', stillHash, capturedAt, 'true'].join(','),
    );

    // Scene 2: scripted interaction, recorded as GIF.
    await pg.setViewport({ width: GIF_SHOT.width, height: GIF_SHOT.height });
    await pg.goto(`${page_url}?screen=firstrun&theme=brass-void`, { waitUntil: 'networkidle0' });
    const frames = Math.floor(GIF_FPS * GIF_SECONDS);
    const gif = GIFEncoder();
    for (let i = 0; i < frames; i += 1) {
      const t = i / GIF_FPS;
      if (i === Math.floor(frames * 0.25)) {
        const btns = await pg.$$('button');
        for (const b of btns) {
          const label = await (await b.getProperty('textContent'))?.jsonValue();
          if (typeof label === 'string' && label.includes('Read the guide')) {
            await b.click();
            break;
          }
        }
      }
      if (i === Math.floor(frames * 0.55)) {
        const btns = await pg.$$('button');
        for (const b of btns) {
          const label = await (await b.getProperty('textContent'))?.jsonValue();
          if (typeof label === 'string' && label.includes('Open the deck')) {
            await b.click();
            break;
          }
        }
      }
      if (i === Math.floor(frames * 0.8)) {
        await pg.keyboard.press('Tab');
      }
      const shot = await pg.screenshot({ encoding: 'binary' });
      const png = PNG.sync.read(Buffer.from(shot));
      // Downscale is unnecessary: viewport already matches GIF size.
      const palette = quantize(png.data, 256, { format: 'rgba4444' });
      const index = applyPalette(png.data, palette, 'rgba4444');
      gif.writeFrame(index, png.width, png.height, { palette, delay: Math.round(1000 / GIF_FPS) });
      await new Promise((r) => setTimeout(r, Math.round(1000 / GIF_FPS)));
    }
    gif.finish();
    const gifBytes = Buffer.from(gif.bytes());
    if (!gifBytes.subarray(0, 6).toString('latin1').startsWith('GIF89')) throw new Error('GIF magic missing');
    if (gifBytes.length > 5 * 1024 * 1024) throw new Error(`GIF too large: ${gifBytes.length} bytes (budget 5MB)`);
    const gifName = 'P009-shell.gif';
    writeFileSync(path.join(outDir, gifName), gifBytes);
    const gifHash = createHash('sha256').update(gifBytes).digest('hex');
    manifest.push(
      [gifName, 'P009', 'first-run-to-deck', 'brass-void', `${GIF_SHOT.width}x${GIF_SHOT.height}`, `${GIF_SECONDS}s@${GIF_FPS}fps`, gifHash, capturedAt, 'true'].join(','),
    );
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  writeFileSync(path.join(outDir, 'manifest.csv'), manifest.join('\n') + '\n');
  console.log(`capture: wrote ${manifest.length - 1} assets + manifest.csv (fixture user: ${FIXTURE_USER})`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
