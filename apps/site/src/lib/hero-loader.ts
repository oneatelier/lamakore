// Hero lazy-loader: decides poster vs 3D, then loads the Three.js chunk
// only when the hero scrolls into view. Tier C (poster) when: reduced
// motion is preferred, data-saver is on, or WebGL2 is unavailable.
// Tiers A/B (WebGPU/WebGL2) are chosen inside hero.ts; the final tier
// lands on documentElement.dataset.heroTier for the budget probe.
const POSTER = '/poster.svg';

function tierC(reason: string): void {
  const wrap = document.getElementById('hero-wrap');
  document.documentElement.dataset.heroTier = 'c';
  window.__heroTier = 'c';
  window.__heroNote = reason;
  // The static poster ships in the HTML, so tier C needs no work —
  // unless the markup ever loses it, in which case restore it here.
  if (wrap && !wrap.querySelector('img.hero-poster')) {
    const img = document.createElement('img');
    img.className = 'hero-poster';
    img.src = POSTER;
    img.alt = 'Guardian mark';
    img.width = 640;
    img.height = 360;
    img.decoding = 'async';
    wrap.replaceChildren(img);
  }
}

function detectTier(): 'go' | { c: string } {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return { c: 'reduced-motion' };
  }
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
  if (nav.connection && nav.connection.saveData === true) return { c: 'save-data' };
  try {
    const probe = document.createElement('canvas');
    if (probe.getContext('webgl2') === null) return { c: 'no-webgl2' };
  } catch {
    return { c: 'no-webgl2' };
  }
  return 'go';
}

function boot(): void {
  const wrap = document.getElementById('hero-wrap');
  if (!wrap) return;
  const decision = detectTier();
  if (decision !== 'go') {
    tierC(decision.c);
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.disconnect();
        void import('./hero.js').then((mod) => mod.start(wrap));
      }
    },
    { rootMargin: '200px' },
  );
  io.observe(wrap);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

declare global {
  interface Window {
    __heroTier?: string;
    __heroFps?: number;
    __heroNote?: string;
  }
}
