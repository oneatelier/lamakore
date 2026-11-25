#!/usr/bin/env node
/*
 * Site budget gate (P028): blocks the Cloudflare Pages deploy when any
 * budget is red. Sizes are measured on real build output (Brotli bytes
 * for over-the-wire budgets, raw bytes for the 25MiB CFree hard cap).
 * Browser budgets (axe AA, LCP, hero FPS) run headless via puppeteer:
 * FPS is SKIPPED with a recorded reason on SwiftShader (no real GPU in
 * CI) and asserted only where a GPU exists — never faked green.
 * Fails closed: any red budget exits non-zero. Two fix-forwards max per
 * the P028 STOP rule, then the deploy stays blocked and a human looks.
 * Usage: node scripts/site-budgets.mjs [--root DIR] (root defaults to repo root)
 */
import { createBrotliCompress, createGzip } from 'node:zlib';
import { createReadStream, createWriteStream, existsSync, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const LIMITS = {
  initialRouteBr: 2 * 1024 * 1024,
  lazyChunkBr: Math.floor(2.5 * 1024 * 1024),
  fileRaw: 25 * 1024 * 1024,
  lcpMs: 2500,
  fpsMedian: 55,
};

const TEXT_EXTS = new Set(['.html', '.css', '.js', '.svg', '.json', '.txt']);
const BINARY_ALLOW = new Set(['.woff2']);

function fail(label, detail) {
  console.log(`[RED] ${label}: ${detail}`);
  return false;
}
function pass(label, detail) {
  console.log(`[GREEN] ${label}: ${detail}`);
  return true;
}

async function precompress(dist) {
  const files = [];
  async function walk(dir) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else if (TEXT_EXTS.has(path.extname(e.name).toLowerCase())) files.push(abs);
    }
  }
  await walk(dist);
  for (const f of files) {
    for (const [ext, comp] of [['.br', () => createBrotliCompress()], ['.gz', () => createGzip()]]) {
      await new Promise((resolve, reject) => {
        const inp = createReadStream(f);
        const out = createWriteStream(f + ext);
        inp.on('error', reject);
        out.on('error', reject);
        out.on('finish', resolve);
        inp.pipe(comp()).pipe(out);
      });
    }
  }
  return files;
}

function brSize(f) {
  return require('node:fs').statSync(f + '.br').size;
}

async function fontGate(sitePublic) {
  let ok = true;
  const fontsDir = path.join(sitePublic, 'fonts');
  const manifest = JSON.parse(await fs.readFile(path.join(fontsDir, 'fonts.json'), 'utf8'));
  for (const [rel, meta] of Object.entries(manifest.files)) {
    const abs = path.join(fontsDir, rel);
    if (!existsSync(abs)) ok = fail('fonts', `missing ${rel}`) && false;
    const sha = createHash('sha256').update(await fs.readFile(abs)).digest('hex');
    if (sha !== meta.sha256) ok = fail('fonts', `sha mismatch ${rel}`) && false;
    if (path.extname(rel).toLowerCase() !== '.woff2') ok = fail('fonts', `non-woff2 ${rel}`) && false;
  }
  for (const fam of ['fraunces', 'inter']) {
    const ofl = path.join(fontsDir, fam, 'OFL.txt');
    let txt = '';
    try {
      txt = await fs.readFile(ofl, 'utf8');
    } catch {
      ok = fail('fonts', `missing OFL.txt for ${fam}`) && false;
    }
    if (txt && !/SIL OPEN FONT LICENSE/i.test(txt)) ok = fail('fonts', `OFL.txt invalid for ${fam}`) && false;
  }
  // No binaries outside the font allowlist anywhere under public/.
  async function walk(dir) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs);
        continue;
      }
      const ext = path.extname(e.name).toLowerCase();
      if (TEXT_EXTS.has(ext) || BINARY_ALLOW.has(ext)) continue;
      if (e.name === '_headers' || e.name === '.nojekyll') continue;
      ok = fail('fonts', `unexpected binary ${path.relative(sitePublic, abs)}`) && false;
    }
  }
  await walk(sitePublic);
  if (ok) pass('fonts', `${Object.keys(manifest.files).length} woff2, sha-verified, OFL on file, no stray binaries`);
  return ok;
}

function serve(dist) {
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(dist, p);
    require('node:fs').readFile(f, (e, d) => {
      if (e) {
        res.writeHead(404);
        res.end('nf');
        return;
      }
      res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' });
      res.end(d);
    });
  });
  return server;
}

async function browserBudgets(dist) {
  const puppeteer = require('puppeteer');
  const axeSource = require('axe-core').source;
  const server = serve(dist);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  // --disable-dev-shm-usage: CI runners have a tiny /dev/shm; without
  // this flag headless Chrome stalls page loads there (navigation
  // timeouts) while local runs look fine. Not a measurement cheat:
  // rendering, throttling, and assertions are unchanged.
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let ok = true;
  try {
    // axe AA on all three routes (desktop viewport, fonts settled).
    for (const route of ['/', '/security/', '/quickstart/']) {
      const page = await browser.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(base + route, { waitUntil: 'networkidle0', timeout: 90000 });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(axeSource);
      const res = await page.evaluate(() => axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }));
      await page.close();
      if (errs.length > 0) ok = fail('axe', `${route} pageerrors: ${errs[0].slice(0, 120)}`) && false;
      else if (res.violations.length > 0) {
        ok = fail('axe', `${route} ${res.violations.length} violation(s): ${res.violations.map((v) => v.id).join(',')}`) && false;
      } else pass('axe', `${route} zero wcag2a/wcag2aa violations`);
    }

    // LCP throttled mid-tier on / (poster path: headless defaults to
    // reduced-motion, which is exactly the tier-C first paint).
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
      const cdp = await page.createCDPSession();
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.emulateNetworkConditions(puppeteer.PredefinedNetworkConditions['Fast 3G']);
      await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });
      const lcp = await page.evaluate(
        () =>
          new Promise((resolve) => {
            let v = 0;
            const po = new PerformanceObserver((list) => {
              for (const e of list.getEntries()) v = e.startTime;
            });
            po.observe({ type: 'largest-contentful-paint', buffered: true });
            setTimeout(() => {
              po.disconnect();
              resolve(Math.round(v));
            }, 9000);
          }),
      );
      await page.close();
      if (lcp <= 0) ok = fail('lcp', 'no LCP entry observed') && false;
      else if (lcp > LIMITS.lcpMs) ok = fail('lcp', `${lcp}ms > ${LIMITS.lcpMs}ms (Fast 3G + 4x CPU, Moto-G4 viewport)`) && false;
      else pass('lcp', `${lcp}ms <= ${LIMITS.lcpMs}ms (Fast 3G + 4x CPU, poster path)`);
    }

    // Hero 3D: force motion, wait for tier a/b, read FPS median.
    {
      const page = await browser.newPage();
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(base + '/', { waitUntil: 'networkidle0', timeout: 90000 });
      try {
        await page.waitForFunction(() => ['a', 'b'].includes(document.documentElement.dataset.heroTier || ''), { timeout: 20000 });
        // FPS median is published after 120 frames; wait for the sample
        // (up to 60s on software GL) before reading it.
        await page.waitForFunction(() => window.__heroFps != null, { timeout: 60000 });
      } catch {
        ok = fail('hero', `3D never started or no FPS sample (tier=${await page.evaluate(() => document.documentElement.dataset.heroTier || 'unset')})`) && false;
      }
      const info = await page.evaluate(() => ({
        tier: document.documentElement.dataset.heroTier || 'unset',
        fps: window.__heroFps ?? null,
        note: window.__heroNote ?? null,
        renderer: (() => {
          try {
            const gl = document.createElement('canvas').getContext('webgl2');
            const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
            return dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown';
          } catch {
            return 'none';
          }
        })(),
      }));
      await page.close();
      if (errs.length > 0) ok = fail('hero', `pageerrors: ${errs[0].slice(0, 160)}`) && false;
      else if (/swiftshader/i.test(info.renderer)) {
        console.log(`[SKIP] fps: SwiftShader renderer (${info.renderer.slice(0, 60)}) — no real GPU; scene runs, tier=${info.tier}, NOT asserted`);
      } else if (info.fps === null) ok = fail('hero', 'no FPS sample after 120 frames') && false;
      else if (info.fps < LIMITS.fpsMedian) ok = fail('hero', `median ${info.fps}fps < ${LIMITS.fpsMedian}fps (tier ${info.tier})`) && false;
      else pass('hero', `tier ${info.tier}, median ${info.fps}fps >= ${LIMITS.fpsMedian}fps`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  return ok;
}

async function main() {
  const args = process.argv.slice(2);
  const get = (f) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : null;
  };
  const root = get('--root') ? path.resolve(get('--root')) : process.cwd();
  const dist = path.join(root, 'apps', 'site', 'dist');
  const sitePublic = path.join(root, 'apps', 'site', 'public');
  if (!existsSync(path.join(dist, 'index.html'))) {
    console.error('budgets: dist/index.html missing — run the site build first');
    process.exitCode = 1;
    return;
  }
  let ok = true;

  const files = await precompress(dist);
  console.log(`precompress: ${files.length} text assets → .br + .gz`);

  // Every file under the 25MiB Pages cap (raw bytes).
  {
    let worst = { f: '', n: 0 };
    async function walk(dir) {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) await walk(abs);
        else {
          const n = (await fs.stat(abs)).size;
          if (n > worst.n) worst = { f: path.relative(dist, abs), n };
        }
      }
    }
    await walk(dist);
    if (worst.n >= LIMITS.fileRaw) ok = fail('file-cap', `${worst.f} ${worst.n}b >= 25MiB`) && false;
    else pass('file-cap', `largest ${worst.f} ${(worst.n / 1024).toFixed(1)}KiB < 25MiB`);
  }

  // Initial route: index.html + its CSS + loader chunk (Brotli bytes).
  {
    const html = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
    const assets = new Set();
    for (const m of html.matchAll(/(?:src|href)="(\/_astro\/[^"]+)"/g)) assets.add(m[1].slice(1));
    // The loader chunk is the only script on the critical path (hero is lazy).
    let total = brSize(path.join(dist, 'index.html'));
    for (const a of assets) {
      if (/hero\.|webgpu/i.test(a)) continue;
      total += brSize(path.join(dist, a));
    }
    if (total > LIMITS.initialRouteBr) ok = fail('initial-route', `${total}b br > 2MiB`) && false;
    else pass('initial-route', `${(total / 1024).toFixed(1)}KiB br <= 2MiB (html+css+loader)`);
  }

  // Lazy 3D chunk(s): every hero/webgpu chunk (Brotli bytes).
  {
    const astroDir = path.join(dist, '_astro');
    const names = await fs.readdir(astroDir);
    let total = 0;
    const hits = [];
    for (const n of names) {
      if (!/\.js$/.test(n)) continue;
      const src = await fs.readFile(path.join(astroDir, n), 'utf8');
      if (/WebGPURenderer|IcosahedronGeometry|hero-loader|heroTier/.test(src)) {
        total += brSize(path.join(astroDir, n));
        hits.push(n);
      }
    }
    if (hits.length === 0) ok = fail('lazy-chunk', 'no hero chunk found') && false;
    else if (total > LIMITS.lazyChunkBr) ok = fail('lazy-chunk', `${hits.join(',')} ${total}b br > 2.5MiB`) && false;
    else pass('lazy-chunk', `${hits.join(' + ')} ${(total / 1024).toFixed(1)}KiB br <= 2.5MiB`);
  }

  if (!(await fontGate(sitePublic))) ok = false;
  if (!(await browserBudgets(dist))) ok = false;

  if (!ok) {
    console.error('budgets: RED — deploy blocked');
    process.exitCode = 1;
  } else {
    console.log('budgets: GREEN — all budgets within limits');
  }
}

main().catch((e) => {
  console.error(`budgets: FATAL ${String((e && e.message) || e).slice(0, 200)}`);
  process.exitCode = 1;
});
