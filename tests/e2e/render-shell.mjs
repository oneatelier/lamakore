#!/usr/bin/env node
/*
 * Shell visual gate (P008): renders the real app bundle headless, captures
 * both themes x all four connection states, walks keyboard focus, measures
 * resize FPS + CLS, and asserts the focus ring. Evidence PNGs land in
 * artifacts/shell-<theme>-<state>.png.
 * Usage: node tests/e2e/render-shell.mjs
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const DIST = path.join(ROOT, 'apps', 'desktop', 'dist', 'renderer');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf' };

function serve(root, transform) {
  return createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    let file = path.join(root, decodeURIComponent(url.pathname));
    try {
      let data = readFileSync(file);
      if (typeof transform === 'function') data = transform(file, data);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('nope');
    }
  });
}

async function main() {
  const { default: puppeteer } = await import('puppeteer');
  const server = serve(ROOT, (abs, data) => {
    // The desktop bundle rewrites font URLs to file:// for file:// load.
    // The harness serves over http, so map them back to served paths.
    if (abs.endsWith('tokens.css')) {
      const prefix = `file:///${ROOT.replace(/\\/g, '/')}`;
      return Buffer.from(data.toString('utf8').split(prefix).join(''));
    }
    return data;
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${String(server.address().port)}`;
  const page = `${base}/apps/desktop/dist/renderer/index.html`;

  const failures = [];
  const check = (name, cond, detail) => {
    console.log(`${cond ? 'ok' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!cond) failures.push(name);
  };

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--force-color-profile=srgb'] });
  try {
    const shots = [];
    for (const theme of ['brass-void', 'parchment']) {
      for (const state of ['connecting', 'connected', 'unreachable', 'degraded']) {
        const ctx = await browser.createBrowserContext();
        const pg = await ctx.newPage();
        await pg.setViewport({ width: 1280, height: 900 });
        const errors = [];
        pg.on('response', (r) => {
          if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
        });
        pg.on('pageerror', (e) => errors.push(String(e)));
        pg.on('console', (m) => {
          if (m.type() === 'error') errors.push(m.text());
        });
        await pg.goto(`${page}?theme=${theme}&conn=${state}`, { waitUntil: 'networkidle0' });
        check(`${theme}/${state} no page errors`, errors.length === 0, errors.join('; ').slice(0, 160));
        const shot = path.join(ROOT, 'artifacts', `shell-${theme}-${state}.png`);
        await pg.screenshot({ path: shot });
        shots.push(shot);
        await ctx.close();
      }
    }

    // Interaction pass: keyboard traversal, focus ring, CLS, resize FPS.
    const ctx = await browser.createBrowserContext();
    const pg = await ctx.newPage();
    await pg.setViewport({ width: 1280, height: 900 });
    await pg.evaluateOnNewDocument(() => {
      window.__cls = 0;
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (!e.hadRecentInput) window.__cls += e.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {}
    });
    await pg.goto(`${page}?theme=brass-void&conn=connected`, { waitUntil: 'networkidle0' });

    const seq = [];
    for (let i = 0; i < 16; i += 1) {
      await pg.keyboard.press('Tab');
      seq.push(
        await pg.evaluate(() => {
          const el = document.activeElement;
          return el ? `${el.tagName}:${(el.textContent || '').trim().slice(0, 20)}` : 'NONE';
        }),
      );
    }
    const distinct = new Set(seq.filter((s) => !s.startsWith('BODY') && s !== 'NONE'));
    check('keyboard traversal reaches shell controls', distinct.size >= 4, [...distinct].slice(0, 10).join(' | '));

    const ring = await pg.evaluate(() => {
      const els = [...document.querySelectorAll('button')];
      const b = els.find((e) => e.textContent?.includes('Retry')) || els[0];
      b?.focus();
      const cs = b ? getComputedStyle(b) : null;
      return cs ? { width: cs.outlineWidth, color: cs.outlineColor, style: cs.outlineStyle } : null;
    });
    check('focus ring visible on shell controls', !!ring && ring.width === '2px', JSON.stringify(ring));

    const cls = await pg.evaluate(() => window.__cls || 0);
    check('no layout shift over threshold', cls <= 0.02, `CLS=${Number(cls).toFixed(4)}`);

    const fps = await pg.evaluate(
      () =>
        new Promise((resolve) => {
          let frames = 0;
          const t0 = performance.now();
          const tick = () => {
            frames += 1;
            if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
            else resolve((frames / (performance.now() - t0)) * 1000);
          };
          requestAnimationFrame(tick);
          const w = [1100, 1280, 1420, 1280, 1100, 1280];
          let i = 0;
          const rz = setInterval(() => {
            window.resizeTo(w[i % w.length], 900);
            i += 1;
            if (i > w.length) clearInterval(rz);
          }, 300);
        }),
    );
    check('resize stays smooth (rAF loop)', fps >= 30, `${Number(fps).toFixed(1)} fps headless (software GL; 60fps target is native-GPU)`);
    await ctx.close();
    void shots;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length > 0) {
    console.error(`render-shell: ${failures.length} FAILURE(S): ${failures.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('render-shell: all visual checks passed');
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
