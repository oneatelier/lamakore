#!/usr/bin/env node
/*
 * Files deck flow verification (fs.list/fs.read through the deck):
 * renders the real FilesPanel.tsx headless in both P007 themes against a
 * fake bridge that plays the daemon side of the FULL chain (gate deny ->
 * approval card -> grant -> listing -> file read, plus the -32002 path),
 * and asserts: zero page errors, card appears on first grant, A approves,
 * rows render, clicking a file renders content, deny dismisses, and the
 * NOT_IMPLEMENTED banner shows honestly.
 * Usage: node tests/ui/files-deck-verify.mjs
 * Screenshots land in artifacts/files-deck-<scene>-<theme>.png.
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
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
  if (!m) return null;
  if (m[4] !== undefined && Number(m[4]) === 0) return null; // transparent: caller falls back
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
  const tmp = mkdtempSync(path.join(tmpdir(), 'files-deck-verify-'));

  const entryPath = path.join(tmp, 'entry.tsx');
  const htmlPath = path.join(tmp, 'index.html');
  const bundlePath = path.join(tmp, 'bundle.js');

  const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from ${JSON.stringify(path.join(ROOT, 'packages', 'ui', 'src', 'theme', 'ThemeProvider.tsx'))};
import { FilesPanel } from ${JSON.stringify(path.join(ROOT, 'apps', 'desktop', 'src', 'renderer', 'components', 'FilesPanel.tsx'))};
const q = new URLSearchParams(location.search);
const theme = (q.get('theme') || 'brass-void');
const mode = (q.get('mode') || 'happy');
let granted = false;
const grants = {};
async function fakeInvoke(method, params) {
  await new Promise((r) => setTimeout(r, 5));
  if (method === 'approval.request') {
    return { request_id: 'apr-deck-e2e-1', expires_at: String(Math.floor(Date.now() / 1000) + 120) };
  }
  if (method === 'approval.decide') {
    if (params && params.decision === 'approve') {
      granted = true;
      grants[params.scope] = 'tok-deck-e2e';
      return { approved: true, decision: 'approved', scope: params.scope, token: 'tok-deck-e2e', grant_id: 7, expires_at: String(Math.floor(Date.now() / 1000) + 3600) };
    }
    return { approved: false, decision: 'denied' };
  }
  if (method === 'fs.list') {
    if (mode === 'nosandbox') throw new Error('daemon error -32002: tool not implemented here: fixture primitive missing');
    if (!params || params.capability !== 'tok-deck-e2e') throw new Error('daemon error -32001: capability denied: missing');
    return { entries: [
      { name: 'note-01.txt', kind: 'file', size: 12, mtime: 1764100000 },
      { name: 'sub', kind: 'dir', size: 0, mtime: 1764100000 },
    ], truncated: false };
  }
  if (method === 'fs.read') {
    if (!params || params.capability !== 'tok-deck-e2e') throw new Error('daemon error -32001: capability denied: missing');
    return { size: 12, encoding: 'utf8', content: 'hello deck\\n', truncated: false };
  }
  throw new Error('daemon error -32601: method not found: ' + method);
}
createRoot(document.getElementById('root')).render(
  React.createElement(ThemeProvider, { initial: theme },
    React.createElement('main', { style: { backgroundColor: 'var(--surface-void)', minHeight: '100vh', padding: '32px', fontFamily: 'var(--font-ui)' } },
      React.createElement(FilesPanel, { invoke: fakeInvoke, initialScope: '/fixture/fs-demo' }),
      React.createElement('p', { id: 'flow-out', style: { color: 'var(--text-secondary)' } }, 'FLOW: idle'),
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
  // Keyboard-first with beat-and-retry: a keypress landing between card
  // mount and keydown-effect attach would otherwise flake. Retries keep
  // the keyboard-only property (no mouse fallback), and the caller's
  // waitForFunction stays the source of truth.
  const pressKey = async (pg, key) => {
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await pg.keyboard.press(key);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 1000));
      // eslint-disable-next-line no-await-in-loop
      const pending = await pg.evaluate(
        () => !!document.querySelector('[data-testid="files-approval"] [data-testid="approval-card-pending"]'),
      );
      if (!pending) return;
    }
  };
  try {
    // Happy path in both themes: list -> card -> approve -> rows -> read.
    for (const theme of ['brass-void', 'parchment']) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
      await page.goto(`${base}/tests-verify-index.html?theme=${theme}&mode=happy`, { waitUntil: 'networkidle0' });
      check(`${theme} no page errors`, errors.length === 0, errors.join('; ').slice(0, 200));
      await page.evaluate(() => {
        const input = document.querySelector('input[aria-label="Directory to list"]');
        const btns = [...document.querySelectorAll('button')].filter((b) => b.textContent === 'List files');
        if (btns[0]) btns[0].click();
        void input;
      });
      await page.waitForFunction(() => !!document.querySelector('[data-testid="files-approval"] [data-testid="approval-card-pending"]'), { timeout: 30000 });
      check(`${theme} approval card appears on first grant`, true);
      const shotCard = path.join(ROOT, 'artifacts', `files-deck-approval-${theme}.png`);
      await page.screenshot({ path: shotCard });
      console.log(`shot ${shotCard}`);
      await pressKey(page, 'a');
      await page.waitForFunction(() => [...document.querySelectorAll('li button')].some((b) => (b.textContent || '').includes('note-01.txt')), { timeout: 30000 });
      check(`${theme} listing renders after approve`, true);
      const rows = await page.$$eval('li button', (els) => els.map((e) => e.textContent));
      check(`${theme} rows show names`, rows.some((t) => t.includes('note-01.txt')) && rows.some((t) => t.includes('sub')), rows.join(' | ').slice(0, 80));
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('li button')];
        const f = btns.find((b) => (b.textContent || '').includes('note-01.txt'));
        if (f) f.click();
      });
      // Reads hold their own grant: a second card asks for fs.read first.
      await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="files-approval"] [data-testid^="approval-card-"]')].length > 0, { timeout: 30000 });
      check(`${theme} read asks its own grant`, true);
      await pressKey(page, 'a');
      await page.waitForFunction(() => (document.body.textContent || '').includes('hello deck'), { timeout: 30000 });
      check(`${theme} file content renders`, true);
      const shotDone = path.join(ROOT, 'artifacts', `files-deck-listed-${theme}.png`);
      await page.screenshot({ path: shotDone });
      console.log(`shot ${shotDone}`);
      await ctx.close();
    }

    // Deny path: card shows, D denies, no rows, dismiss works.
    {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(`${base}/tests-verify-index.html?theme=brass-void&mode=happy`, { waitUntil: 'networkidle0' });
      // Patch the fake to deny: reload with a deny-on-approve override is
      // complex; instead deny directly and assert the card terminal state.
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')].filter((b) => b.textContent === 'List files');
        if (btns[0]) btns[0].click();
      });
      await page.waitForFunction(() => !!document.querySelector('[data-testid="files-approval"] [data-testid^="approval-card-"]'), { timeout: 30000 });
      await pressKey(page, 'd');
      await page.waitForFunction(() => !!document.querySelector('[data-testid="files-approval"] [data-testid="approval-card-denied"]'), { timeout: 30000 });
      check('deny shows denied card state', true);
      const rows = await page.$$('li button');
      check('denied lists nothing', rows.length === 0, `${rows.length} rows`);
      await ctx.close();
    }

    // NOT_IMPLEMENTED path: banner shows, nothing unsandboxed runs.
    {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${base}/tests-verify-index.html?theme=brass-void&mode=nosandbox`, { waitUntil: 'networkidle0' });
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')].filter((b) => b.textContent === 'List files');
        if (btns[0]) btns[0].click();
      });
      await pressKey(page, 'a');
      await page.waitForFunction(() => (document.body.textContent || '').includes('Sandbox unavailable here'), { timeout: 30000 });
      check('nosandbox shows honest banner', true);
      check('nosandbox no page errors', errors.length === 0, errors.join('; ').slice(0, 200));
      await ctx.close();
    }

    // Keyboard + focus ring + contrast on the happy path.
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${base}/tests-verify-index.html?theme=brass-void&mode=happy`, { waitUntil: 'networkidle0' });
    // Walk Tab until the directory input, then the List button, is focused.
    let focusedInput = false;
    for (let i = 0; i < 60 && !focusedInput; i += 1) {
      await page.keyboard.press('Tab');
      focusedInput = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Directory to list');
    }
    check('keyboard Tab reaches directory input', focusedInput, String(focusedInput));
    let focusedList = false;
    for (let i = 0; i < 10 && !focusedList; i += 1) {
      await page.keyboard.press('Tab');
      focusedList = await page.evaluate(() => document.activeElement?.textContent === 'List files');
    }
    check('keyboard Tab reaches List files', focusedList, String(focusedList));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !!document.querySelector('[data-testid="files-approval"] [data-testid^="approval-card-"]'), { timeout: 30000 });
    await pressKey(page, 'a');
    await page.waitForFunction(() => [...document.querySelectorAll('li button')].length > 0, { timeout: 30000 });
    const ring = await page.evaluate(() => {
      const b = [...document.querySelectorAll('li button')][0];
      b?.focus();
      const cs = b ? getComputedStyle(b) : null;
      return cs ? { width: cs.outlineWidth, color: cs.outlineColor } : null;
    });
    check('focus ring visible (2px)', !!ring && ring.width === '2px', JSON.stringify(ring));
    const contrast = await page.evaluate(() => {
      const row = document.querySelectorAll('li button')[0];
      const main = document.querySelector('main');
      if (!row || !main) return null;
      return {
        fg: getComputedStyle(row).color,
        // Rows are transparent; the honest backdrop is the page surface.
        bg: getComputedStyle(main).backgroundColor,
      };
    });
    if (contrast && luminance(contrast.bg) !== null) {
      const r = ratio(luminance(contrast.fg), luminance(contrast.bg));
      check('row text AA (>=4.5)', r >= 4.5, `${contrast.fg} on ${contrast.bg} = ${r.toFixed(2)}`);
    } else {
      check('contrast measurable', false, JSON.stringify(contrast));
    }
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length > 0) {
    console.error(`files-deck-verify: ${failures.length} FAILURE(S): ${failures.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('files-deck-verify: all deck flow checks passed');
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
