#!/usr/bin/env node
/*
 * Desktop build (P008): esbuild bundles for main (node/cjs), preload (cjs),
 * and renderer (iife). Writes dist/ plus a generated index.html; dist/ stays
 * gitignored. Font URLs are rewritten to file:// repo assets for file:// load.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const app = path.join(root, 'apps', 'desktop');
const dist = path.join(app, 'dist');

mkdirSync(path.join(dist, 'main'), { recursive: true });
mkdirSync(path.join(dist, 'preload'), { recursive: true });
mkdirSync(path.join(dist, 'renderer'), { recursive: true });

await build({
  entryPoints: [path.join(app, 'src', 'main', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(dist, 'main', 'index.js'),
  external: ['electron'],
  logLevel: 'info',
});
await build({
  entryPoints: [path.join(app, 'src', 'preload', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(dist, 'preload', 'index.js'),
  external: ['electron'],
  logLevel: 'info',
});
await build({
  entryPoints: [path.join(app, 'src', 'renderer', 'index.tsx')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  outfile: path.join(dist, 'renderer', 'bundle.js'),
  loader: { '.tsx': 'tsx' },
  jsx: 'automatic',
  logLevel: 'info',
});

// Renderer HTML: generated (not committed) so the CSP and asset paths stay
// in one place. Fonts resolve to repo assets via file:// for file:// load.
const css = readFileSync(path.join(root, 'packages', 'ui', 'src', 'tokens', 'generated.css'), 'utf8');
const fontsUrl = pathToFileURL(path.join(root, 'assets', 'fonts')).href;
const cssForFile = css.replaceAll('/assets/fonts/', `${fontsUrl}/`);
writeFileSync(path.join(dist, 'renderer', 'tokens.css'), cssForFile);
writeFileSync(
  path.join(dist, 'renderer', 'index.html'),
  '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; font-src \'self\' file:; connect-src \'self\'; object-src \'none\'; base-uri \'self\'; frame-src \'none\'"><link rel="stylesheet" href="./tokens.css"></head><body><div id="root"></div><script src="./bundle.js"></script></body></html>',
);
console.log('desktop build complete:', dist);
