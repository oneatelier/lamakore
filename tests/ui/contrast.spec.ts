// Contrast gate (WCAG 2.2): every text/background pair the TokenSheet
// actually renders must pass AA. Ratios are computed from the generated
// tokens at runtime — no hardcoded numbers. Disabled-only swatches are
// informational: WCAG 1.4.3 exempts inactive controls, and the sheet never
// sets running text in the disabled color.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES } from '../../packages/ui/src/tokens/generated.ts';

type ThemeName = keyof typeof THEMES;

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

interface Pair {
  theme: ThemeName;
  fg: string;
  bg: string;
  size: 'normal' | 'large' | 'nontext';
  note: string;
}

const SURFACES = ['surface-void', 'surface-base', 'surface-raised', 'surface-overlay'] as const;
const PAIRS: Pair[] = [];
for (const theme of ['brass-void', 'parchment'] as ThemeName[]) {
  for (const bg of SURFACES) {
    PAIRS.push({ theme, fg: 'text-primary', bg, size: 'normal', note: 'body text' });
    PAIRS.push({ theme, fg: 'text-secondary', bg, size: 'normal', note: 'secondary text' });
  }
  PAIRS.push({ theme, fg: 'brass-primary', bg: 'surface-void', size: 'normal', note: 'brass link text' });
  PAIRS.push({ theme, fg: 'brass-primary', bg: 'surface-base', size: 'normal', note: 'brass link text on card' });
  PAIRS.push({ theme, fg: 'surface-void', bg: 'brass-primary', size: 'normal', note: 'primary button label' });
  for (const sig of ['signal-success', 'signal-warning', 'signal-danger', 'signal-info'] as const) {
    PAIRS.push({ theme, fg: sig, bg: 'surface-void', size: 'normal', note: 'signal text' });
    PAIRS.push({ theme, fg: sig, bg: 'surface-base', size: 'normal', note: 'signal text on card' });
  }
  for (const bg of ['surface-void', 'surface-base', 'surface-overlay'] as const) {
    PAIRS.push({ theme, fg: 'focus-ring', bg, size: 'nontext', note: 'focus indicator' });
  }
  PAIRS.push({ theme, fg: 'text-primary', bg: 'surface-void', size: 'large', note: 'display heading' });
}

test('every sheet text/background pair passes WCAG 2.2 AA', () => {
  const failures: string[] = [];
  for (const p of PAIRS) {
    const colors = THEMES[p.theme].colors as Record<string, string>;
    const r = ratio(colors[p.fg], colors[p.bg]);
    const min = p.size === 'normal' ? 4.5 : 3.0;
    const tag = `${p.theme} ${p.fg} on ${p.bg} (${p.note}) = ${r.toFixed(2)}:1, needs ${min}:1`;
    if (r < min) failures.push(tag);
    else console.log(`ok ${tag}`);
  }
  assert.deepEqual(failures, [], `contrast failures (fix the token, never the bar):\n${failures.join('\n')}`);
});

test('disabled swatches stay above the documented floor', () => {
  for (const theme of ['brass-void', 'parchment'] as ThemeName[]) {
    const colors = THEMES[theme].colors as Record<string, string>;
    const r = ratio(colors['text-disabled'], colors['surface-void']);
    console.log(`info ${theme} disabled on void = ${r.toFixed(2)}:1 (WCAG exempts inactive controls; floor is 2.0)`);
    assert.ok(r >= 2.0, `${theme} disabled contrast ${r.toFixed(2)} below floor`);
  }
});
