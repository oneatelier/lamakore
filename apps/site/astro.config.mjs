import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Brass & Void tokens are read here (config file path is stable) and
// injected as a compile-time string: prerender chunks run from dist/,
// so no source-relative fs read can survive bundling. Single source of
// truth stays packages/ui; the site inlines it into <head> (also good
// for first paint: no render-blocking stylesheet round-trip).
const siteDir = path.dirname(fileURLToPath(import.meta.url));
const tokensCss = readFileSync(
  path.join(siteDir, '../../packages/ui/src/tokens/generated.css'),
  'utf8',
);

// Static-only product site for Cloudflare Pages (direct upload of dist/).
// No SSR, no server islands: every route prerenders to HTML.
export default defineConfig({
  output: 'static',
  compressHTML: true,
  build: {
    assets: '_astro',
    sourcemap: false,
  },
  vite: {
    define: {
      __SITE_TOKENS__: JSON.stringify(tokensCss),
    },
    build: {
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 2500,
    },
  },
});
