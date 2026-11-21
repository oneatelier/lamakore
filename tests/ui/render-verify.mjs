#!/usr/bin/env node
/*
 * Visual verification harness (P007): bundles the real TokenSheet.tsx with
 * esbuild, serves the repo over local HTTP, and drives headless Chrome via
 * puppeteer — screenshots in brass-void + parchment, keyboard traversal,
 * focus-ring computed styles, and reduced-motion behavior.
 * Usage: node tests/ui/render-verify.mjs [--shot-only]
 * Screenshots land in artifacts/token-sheet-<theme>.png (committed evidence).
 */
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SPEC_DIR, '..', '..');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.json': 'application/json' };

async function main() {
  const { default: puppeteer } = await import('puppeteer');
  const { buildSync: esbuild } = await import('esbuild');
  const tmp = mkdtempSync(path.join(tmpdir(), 'token-sheet-'));

  const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from ${JSON.stringify(path.join(ROOT, 'packages', 'ui', 'src', 'theme', 'ThemeProvider.tsx'))};
import { TokenSheet } from ${JSON.stringify(path.join(ROOT, 'apps', 'desktop', 'src', 'renderer', 'dev', 'TokenSheet.tsx'))};
const theme = new URLSearchParams(location.search).get('theme') || 'brass-void';
createRoot(document.getElementById('root')).render(React.createElement(ThemeProvider, { initial: theme }, React.createElement(TokenSheet, { theme })));
`;
  const entryPath = path.join(tmp, 'entry.tsx');
  writeFileSync(entryPath, entry);
  writeFileSync(
    path.join(tmp, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/packages/ui/src/tokens/generated.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>',
  );
  const bundlePath = path.join(tmp, 'bundle.js');
  esbuild({ entryPoints: [entryPath], bundle: true, outfile: bundlePath, format: 'iife', loader: { '.tsx': 'tsx' }, jsx: 'automatic', absWorkingDir: ROOT, nodePaths: [path.join(ROOT, 'node_modules')] });

  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    let file;
    if (url.pathname === '/bundle.js') file = bundlePath;
    else if (url.pathname === '/tests-verify-index.html' || url.pathname === '/') file = path.join(tmp, 'index.html');
    else file = path.join(ROOT, decodeURIComponent(url.pathname));
    try {
      const data = readFileSync(file);
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('nope');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const failures = [];
  const check = (name, cond, detail) => {
    console.log(`${cond ? 'ok' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!cond) failures.push(name);
  };

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--force-color-profile=srgb'] });
  try {
    for (const theme of ['brass-void', 'parchment']) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width: 1280, height: 1000 });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('response', (r) => {
        if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
      });
      await page.goto(`${base}/tests-verify-index.html?theme=${theme}`, { waitUntil: 'networkidle0' });
      check(`${theme} no page errors`, errors.length === 0, errors.join('; ').slice(0, 200));
      const h1 = await page.$eval('h1', (el) => el.textContent);
      check(`${theme} title reads live branding`, /Token Sheet/.test(h1 || ''), h1?.slice(0, 60));
      await page.screenshot({ path: path.join(ROOT, 'artifacts', `token-sheet-${theme}.png`), fullPage: true });
      await ctx.close();
    }

    // Interaction pass on brass-void.
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${base}/tests-verify-index.html?theme=brass-void`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.querySelector('main')?.scrollIntoView());
    const seq = [];
    for (let i = 0; i < 14; i += 1) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => {
        const el = document.activeElement;
        return el ? `${el.tagName}:${(el.textContent || el.getAttribute?.('aria-label') || '').trim().slice(0, 24)}` : 'NONE';
      });
      seq.push(id);
    }
    const distinct = new Set(seq.filter((s) => !s.startsWith('BODY') && s !== 'NONE'));
    check('keyboard traversal reaches interactive elements', distinct.size >= 4, [...distinct].slice(0, 8).join(' | '));

    const ring = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { outline: cs.outline, width: cs.outlineWidth, color: cs.outlineColor, tag: el.tagName };
    });
    check('focus ring visible (2px custom outline)', !!ring && ring.width === '2px' && ring.color !== 'rgb(0, 0, 0)', JSON.stringify(ring));

    const mouseOutline = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')][1];
      btn.focus({ preventScroll: true });
      const cs = getComputedStyle(document.activeElement);
      return cs.outlineStyle;
    });
    void mouseOutline;

    // Reduced motion: emulate, reload, assert cross-fade-only behavior.
    const ctx2 = await browser.createBrowserContext();
    const rm = await ctx2.newPage();
    await rm.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await rm.goto(`${base}/tests-verify-index.html?theme=brass-void`, { waitUntil: 'networkidle0' });
    const reduced = await rm.evaluate(() => {
      const hasClass = document.documentElement.classList.contains('reduced-motion');
      const btn = document.querySelector('button');
      const cs = btn ? getComputedStyle(btn) : null;
      const anims = document.getAnimations().map((a) => a.constructor.name);
      return { hasClass, transitionProperty: cs?.transitionProperty, transitionDuration: cs?.transitionDuration, animations: anims };
    });
    check('reduced-motion class applied', reduced.hasClass === true, JSON.stringify(reduced));
    check(
      'reduced-motion swaps transforms for fast cross-fades',
      reduced.transitionProperty === 'opacity' && parseFloat(reduced.transitionDuration || '0') <= 0.12,
      `${reduced.transitionProperty} / ${reduced.transitionDuration}`,
    );
    check('no running transform animations under reduced motion', (reduced.animations || []).length === 0, (reduced.animations || []).join(','));
    await ctx2.close();
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length > 0) {
    console.error(`render-verify: ${failures.length} FAILURE(S): ${failures.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('render-verify: all visual checks passed');
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
