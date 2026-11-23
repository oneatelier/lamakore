#!/usr/bin/env node
/*
 * Ledger banner verification (audit.verify -> LEDGER_TAMPER):
 * renders the real Shell.tsx headless in both P007 themes with a healthy
 * and a tampered ledger, screenshots both, and asserts: zero page errors,
 * role=alert banner iff tampered (with the bad record number), Tab reaches
 * Re-check, Enter triggers a re-check, the 2px focus ring shows, and the
 * banner title/body meet WCAG AA against the card surface.
 * Usage: node tests/ui/ledger-verify.mjs
 * Screenshots land in artifacts/ledger-<ok|tampered>-<theme>.png.
 */
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SPEC_DIR, '..', '..');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.json': 'application/json' };

function luminance(rgb) {
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => {
    const c = Number(v) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

async function main() {
  const { default: puppeteer } = await import('puppeteer');
  const { buildSync: esbuild } = await import('esbuild');
  const tmp = mkdtempSync(path.join(tmpdir(), 'ledger-verify-'));

  const entryPath = path.join(tmp, 'entry.tsx');
  const htmlPath = path.join(tmp, 'index.html');
  const bundlePath = path.join(tmp, 'bundle.js');

  const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from ${JSON.stringify(path.join(ROOT, 'packages', 'ui', 'src', 'theme', 'ThemeProvider.tsx'))};
import { Shell } from ${JSON.stringify(path.join(ROOT, 'apps', 'desktop', 'src', 'renderer', 'screens', 'Shell.tsx'))};
import { THEME_NAMES, themeLabel } from ${JSON.stringify(path.join(ROOT, 'packages', 'ui', 'src', 'theme', 'themes.js'))};
const q = new URLSearchParams(location.search);
const theme = (q.get('theme') || 'brass-void');
const mode = (q.get('ledger') || 'ok');
const ledger = mode === 'tampered'
  ? { ok: false, events: 42, badSeq: 17, head: 'deadbeef' }
  : { ok: true, events: 42, badSeq: null, head: 'deadbeef' };
createRoot(document.getElementById('root')).render(
  React.createElement(ThemeProvider, { initial: theme },
    React.createElement(React.Fragment, null,
      React.createElement(Shell, {
        conn: 'connected', ledger, product: 'Test Product', daemon: 'cored-test', build: 'test',
        theme, themes: THEME_NAMES, themeLabel, setTheme: () => {}, onRetry: () => {},
        onRecheckLedger: () => { const el = document.getElementById('flow-out'); if (el) el.textContent = 'FLOW: recheck done'; },
      }),
      React.createElement('p', { id: 'flow-out', style: { position: 'fixed', bottom: 0, color: 'var(--text-secondary)' } }, 'FLOW: idle'),
    ))
);
`;
  writeFileSync(entryPath, entry);
  writeFileSync(
    htmlPath,
    '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/packages/ui/src/tokens/generated.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>',
  );
  esbuild({ entryPoints: [entryPath], bundle: true, outfile: bundlePath, format: 'iife', loader: { '.tsx': 'tsx' }, jsx: 'automatic', absWorkingDir: ROOT, nodePaths: [path.join(ROOT, 'node_modules')] });

  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    let file;
    if (url.pathname === '/bundle.js') file = bundlePath;
    else if (url.pathname === '/tests-verify-index.html' || url.pathname === '/') file = htmlPath;
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
      for (const mode of ['ok', 'tampered']) {
        const ctx = await browser.createBrowserContext();
        const page = await ctx.newPage();
        await page.setViewport({ width: 1280, height: 900 });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
        await page.goto(`${base}/tests-verify-index.html?theme=${theme}&ledger=${mode}`, { waitUntil: 'networkidle0' });
        check(`${theme}/${mode} no page errors`, errors.length === 0, errors.join('; ').slice(0, 200));
        const banner = await page.$('[data-testid="ledger-tamper-banner"]');
        check(`${theme}/${mode} banner iff tampered`, !!banner === (mode === 'tampered'), String(!!banner));
        if (mode === 'tampered') {
          const title = await page.$eval('[data-testid="ledger-tamper-title"]', (el) => el.textContent);
          check(`${theme}/${mode} names the break`, (title || '').includes('tampered'), title);
          const body = await page.$eval('[data-testid="ledger-tamper-banner"]', (el) => el.textContent);
          check(`${theme}/${mode} cites record + count`, (body || '').includes('record 17 of 42'), (body || '').slice(0, 90));
          const role = await page.$eval('[data-testid="ledger-tamper-banner"]', (el) => el.getAttribute('role'));
          check(`${theme}/${mode} role=alert`, role === 'alert', role);
        }
        const shot = path.join(ROOT, 'artifacts', `ledger-${mode}-${theme}.png`);
        await page.screenshot({ path: shot });
        console.log(`shot ${shot}`);
        await ctx.close();
      }
    }

    // Interaction: Tab reaches Re-check, Enter re-checks, ring shows, AA holds.
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${base}/tests-verify-index.html?theme=brass-void&ledger=tampered`, { waitUntil: 'networkidle0' });
    // Tab until Re-check has focus (banner sits above the deck card, so the
    // walk passes shell controls first), then Enter re-checks.
    let focusedRecheck = false;
    for (let i = 0; i < 60; i += 1) {
      await page.keyboard.press('Tab');
      focusedRecheck = await page.evaluate(
        () => document.activeElement?.getAttribute('data-testid') === 'ledger-recheck',
      );
      if (focusedRecheck) break;
    }
    check('keyboard Tab reaches Re-check', focusedRecheck, focusedRecheck ? 'focused' : 'never focused');
    await page.keyboard.press('Enter');
    const out = await page.$eval('#flow-out', (el) => el.textContent);
    check('keyboard Enter triggers re-check', (out || '').includes('recheck done'), out);
    const ring = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="ledger-recheck"]');
      b?.focus();
      const cs = b ? getComputedStyle(b) : null;
      return cs ? { width: cs.outlineWidth, color: cs.outlineColor } : null;
    });
    check('focus ring visible (2px)', !!ring && ring.width === '2px', JSON.stringify(ring));
    const contrast = await page.evaluate(() => {
      const title = document.querySelector('[data-testid="ledger-tamper-title"]');
      const body = document.querySelector('[data-testid="ledger-tamper-body"]');
      const banner = document.querySelector('[data-testid="ledger-tamper-banner"]');
      const btn = document.querySelector('[data-testid="ledger-recheck"]');
      if (!title || !body || !banner || !btn) return null;
      return {
        titleFg: getComputedStyle(title).color,
        bodyFg: getComputedStyle(body).color,
        bg: getComputedStyle(banner).backgroundColor,
        btnFg: getComputedStyle(btn).color,
        btnBg: getComputedStyle(btn).backgroundColor,
      };
    });
    if (contrast) {
      const titleR = ratio(luminance(contrast.titleFg), luminance(contrast.bg));
      const bodyR = ratio(luminance(contrast.bodyFg), luminance(contrast.bg));
      const btnR = ratio(luminance(contrast.btnFg), luminance(contrast.btnBg));
      check('banner title AA (>=4.5)', titleR >= 4.5, `${contrast.titleFg} on ${contrast.bg} = ${titleR.toFixed(2)}`);
      check('banner body AA (>=4.5)', bodyR >= 4.5, `${contrast.bodyFg} on ${contrast.bg} = ${bodyR.toFixed(2)}`);
      check('re-check button AA (>=4.5)', btnR >= 4.5, `${contrast.btnFg} on ${contrast.btnBg} = ${btnR.toFixed(2)}`);
    } else {
      check('contrast measurable', false, 'selectors missing');
    }
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length > 0) {
    console.error(`ledger-verify: ${failures.length} FAILURE(S): ${failures.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('ledger-verify: all banner checks passed');
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
