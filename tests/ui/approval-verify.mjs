#!/usr/bin/env node
/*
 * Approval deck verification (wire/1 approval.request):
 * renders the real ApprovalCard.tsx headless, screenshots all 5 states in
 * both P007 themes, walks keyboard (A/D/E + Enter/Escape), asserts the
 * 2px focus ring, equal approve/deny prominence, and runs the flow:
 * approve -> tool proceeds; deny -> CAPABILITY_DENIED; timeout -> deny.
 * Usage: node tests/ui/approval-verify.mjs
 * Screenshots land in artifacts/approval-<state>-<theme>.png.
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
  const tmp = mkdtempSync(path.join(tmpdir(), 'approval-verify-'));

  const entryPath = path.join(tmp, 'entry.tsx');
  const htmlPath = path.join(tmp, 'index.html');
  const bundlePath = path.join(tmp, 'bundle.js');

  // Demo entry: renders one card per status, driven by ?state=&theme=.
  // Countdown uses a far-future ttl except for `expired` which is pre-expired.
  const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from ${JSON.stringify(path.join(ROOT, 'packages', 'ui', 'src', 'theme', 'ThemeProvider.tsx'))};
import { ApprovalCard } from ${JSON.stringify(path.join(ROOT, 'packages', 'ui', 'src', 'approvals', 'ApprovalCard.tsx'))};
const q = new URLSearchParams(location.search);
const theme = (q.get('theme') || 'brass-void');
const st = (q.get('state') || 'pending');
const nowSec = Date.now() / 1000;
const base = { id: 'apr-demo-1', tool: 'tool.exec', scope: '/proj', reason: 'Read logs to diagnose the failure.', ttlSecs: 60, requestedAt: nowSec, expiresAt: nowSec + 60 };
function stateFor(s) {
  if (s === 'pending') return { request: base, status: 'pending', effectiveScope: '/proj', wasEdited: false };
  if (s === 'edited') return { request: base, status: 'edited', effectiveScope: '/proj/sub', wasEdited: true };
  if (s === 'approved') return { request: base, status: 'approved', effectiveScope: '/proj', wasEdited: false, decidedAt: nowSec, decidedBy: 'deck' };
  if (s === 'denied') return { request: base, status: 'denied', effectiveScope: '/proj', wasEdited: false, decidedAt: nowSec, decidedBy: 'deck' };
  return { request: { ...base, requestedAt: nowSec - 120, expiresAt: nowSec - 60 }, status: 'expired', effectiveScope: '/proj', wasEdited: false, decidedAt: nowSec, decidedBy: 'countdown' };
}
const st8 = stateFor(st);
let decided = null;
createRoot(document.getElementById('root')).render(
  React.createElement(ThemeProvider, { initial: theme },
    React.createElement('main', { style: { backgroundColor: 'var(--surface-void)', minHeight: '100vh', padding: '32px', fontFamily: 'var(--font-ui)' } },
      React.createElement(ApprovalCard, {
        state: st8, now: nowSec, sig: st === 'approved' ? 'sig-demo-0123456789abcdef' : undefined,
        onApprove: () => { decided = 'approved'; const el = document.getElementById('flow-out'); if (el) el.textContent = 'FLOW: approved -> tool proceeds (token mock-ok)'; },
        onDeny: () => { decided = 'denied'; const el = document.getElementById('flow-out'); if (el) el.textContent = 'FLOW: denied -> CAPABILITY_DENIED (-32001)'; },
        onEdit: (s) => { const el = document.getElementById('flow-out'); if (el) el.textContent = 'FLOW: edited scope=' + s; },
        onDismiss: () => { const el = document.getElementById('flow-out'); if (el) el.textContent = 'FLOW: dismissed via keyboard'; },
      }),
      React.createElement('p', { id: 'flow-out', style: { color: 'var(--text-secondary)' } }, 'FLOW: idle'),
      React.createElement('p', { id: 'expiry-note', style: { color: 'var(--text-secondary)' } }, st === 'expired' ? 'FLOW: timeout -> deny (DEFAULT DENY)' : 'FLOW: countdown live'),
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
    // 1) Screenshots of all 5 states x 2 themes.
    for (const theme of ['brass-void', 'parchment']) {
      for (const state of ['pending', 'approved', 'denied', 'expired', 'edited']) {
        const ctx = await browser.createBrowserContext();
        const page = await ctx.newPage();
        await page.setViewport({ width: 900, height: 760 });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
        await page.goto(`${base}/tests-verify-index.html?theme=${theme}&state=${state}`, { waitUntil: 'networkidle0' });
        check(`${theme}/${state} no page errors`, errors.length === 0, errors.join('; ').slice(0, 200));
        const card = await page.$('[data-testid^="approval-card"]');
        check(`${theme}/${state} card renders`, !!card, state);
        const status = await page.evaluate(() => document.querySelector('[data-status]')?.getAttribute('data-status') ?? 'none');
        check(`${theme}/${state} status attr`, status === state, status);
        const shot = path.join(ROOT, 'artifacts', `approval-${state}-${theme}.png`);
        await page.screenshot({ path: shot });
        console.log(`shot ${shot}`);
        await ctx.close();
      }
    }

    // 2) Flow: approve -> tool proceeds; deny -> CAPABILITY_DENIED; timeout -> deny.
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 900, height: 760 });
    await page.goto(`${base}/tests-verify-index.html?theme=brass-void&state=pending`, { waitUntil: 'networkidle0' });
    // Keyboard A approves.
    await page.keyboard.press('a');
    let out = await page.$eval('#flow-out', (el) => el.textContent);
    check('flow approve -> tool proceeds', (out || '').includes('tool proceeds'), out);
    // Reload, D denies.
    await page.goto(`${base}/tests-verify-index.html?theme=brass-void&state=pending`, { waitUntil: 'networkidle0' });
    await page.keyboard.press('d');
    out = await page.$eval('#flow-out', (el) => el.textContent);
    check('flow deny -> CAPABILITY_DENIED', (out || '').includes('CAPABILITY_DENIED'), out);
    // Timeout state asserts default deny copy.
    await page.goto(`${base}/tests-verify-index.html?theme=brass-void&state=expired`, { waitUntil: 'networkidle0' });
    out = await page.$eval('#expiry-note', (el) => el.textContent);
    check('flow timeout -> deny', (out || '').includes('DEFAULT DENY'), out);
    const result = await page.$eval('[data-testid="approval-result"]', (el) => el.textContent);
    check('expired copy names default deny', (result || '').toLowerCase().includes('default deny'), (result || '').slice(0, 80));

    // 3) Keyboard paths: E focuses edit, Enter/Esc dismiss on terminal.
    await page.goto(`${base}/tests-verify-index.html?theme=brass-void&state=pending`, { waitUntil: 'networkidle0' });
    await page.keyboard.press('e');
    const editFocused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'approval-scope-input');
    check('keyboard E focuses scope edit', editFocused, String(editFocused));
    await page.keyboard.press('Escape');
    await page.goto(`${base}/tests-verify-index.html?theme=brass-void&state=approved`, { waitUntil: 'networkidle0' });
    await page.keyboard.press('Enter');
    out = await page.$eval('#flow-out', (el) => el.textContent);
    check('keyboard Enter dismisses terminal', (out || '').includes('dismissed'), out);

    // 4) Tab order + focus ring + equal prominence.
    await page.goto(`${base}/tests-verify-index.html?theme=brass-void&state=pending`, { waitUntil: 'networkidle0' });
    const seq = [];
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      seq.push(await page.evaluate(() => {
        const el = document.activeElement;
        return el ? `${el.tagName}:${(el.getAttribute('data-action') || el.textContent || '').trim().slice(0, 16)}` : 'NONE';
      }));
    }
    const reached = seq.filter((s) => s.includes('approve') || s.includes('deny') || s.includes('edit'));
    check('keyboard Tab reaches approve/deny/edit', reached.length >= 3, seq.join(' | '));
    const ring = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="approval-approve"]');
      b?.focus();
      const cs = b ? getComputedStyle(b) : null;
      return cs ? { width: cs.outlineWidth, color: cs.outlineColor } : null;
    });
    check('focus ring visible (2px)', !!ring && ring.width === '2px', JSON.stringify(ring));
    const sizes = await page.evaluate(() => {
      const a = document.querySelector('[data-testid="approval-approve"]');
      const d = document.querySelector('[data-testid="approval-deny"]');
      if (!a || !d) return null;
      const ra = a.getBoundingClientRect();
      const rd = d.getBoundingClientRect();
      const ca = getComputedStyle(a);
      const cd = getComputedStyle(d);
      return { aw: ra.width, dw: rd.width, ah: ra.height, dh: rd.height, af: ca.fontWeight, df: cd.fontWeight };
    });
    const equal = !!sizes && Math.abs(sizes.aw - sizes.dw) < 1 && Math.abs(sizes.ah - sizes.dh) < 1 && sizes.af === sizes.df;
    check('deny exactly as prominent as approve', equal, JSON.stringify(sizes));
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length > 0) {
    console.error(`approval-verify: ${failures.length} FAILURE(S): ${failures.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('approval-verify: all deck checks passed');
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
