// Approval contrast gate (WCAG 2.2 AA): every text/bg pair the ApprovalCard
// actually renders must pass. Ratios computed from generated tokens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES } from '../../packages/ui/src/tokens/generated.ts';

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

interface Pair { theme: keyof typeof THEMES; fg: string; bg: string; size: 'normal' | 'large' | 'nontext'; note: string; }

const PAIRS: Pair[] = [];
for (const theme of ['brass-void', 'parchment'] as const) {
  // Card bg is surface-raised; body + secondary + reason text sit on it.
  PAIRS.push({ theme, fg: 'text-primary', bg: 'surface-raised', size: 'normal', note: 'card title/body' });
  PAIRS.push({ theme, fg: 'text-secondary', bg: 'surface-raised', size: 'normal', note: 'reason/countdown' });
  PAIRS.push({ theme, fg: 'text-secondary', bg: 'surface-raised', size: 'normal', note: 'field labels' });
  // Both action buttons: text-primary on surface-overlay (identical treatment).
  PAIRS.push({ theme, fg: 'text-primary', bg: 'surface-overlay', size: 'normal', note: 'approve button label' });
  PAIRS.push({ theme, fg: 'text-primary', bg: 'surface-overlay', size: 'normal', note: 'deny button label (equal)' });
  PAIRS.push({ theme, fg: 'text-secondary', bg: 'surface-overlay', size: 'nontext', note: 'edit button border text' });
  // Progress fill is decorative (non-text) but must still be visible.
  PAIRS.push({ theme, fg: 'brass-primary', bg: 'surface-overlay', size: 'nontext', note: 'countdown bar' });
  // Status dots are non-text indicators.
  PAIRS.push({ theme, fg: 'signal-success', bg: 'surface-raised', size: 'nontext', note: 'approved dot' });
  PAIRS.push({ theme, fg: 'signal-danger', bg: 'surface-raised', size: 'nontext', note: 'denied dot' });
  PAIRS.push({ theme, fg: 'signal-warning', bg: 'surface-raised', size: 'nontext', note: 'expired dot' });
  PAIRS.push({ theme, fg: 'signal-info', bg: 'surface-raised', size: 'nontext', note: 'pending dot' });
  // Result line on card.
  PAIRS.push({ theme, fg: 'signal-danger', bg: 'surface-raised', size: 'normal', note: 'deny alert text' });
}

test('approval card pairs pass WCAG 2.2 AA', () => {
  const failures: string[] = [];
  for (const p of PAIRS) {
    const colors = THEMES[p.theme].colors as Record<string, string>;
    const r = ratio(colors[p.fg], colors[p.bg]);
    const min = p.size === 'normal' ? 4.5 : 3.0;
    const tag = `${p.theme} ${p.fg} on ${p.bg} (${p.note}) = ${r.toFixed(2)}:1, needs ${min}:1`;
    if (r < min) failures.push(tag);
    else console.log(`ok ${tag}`);
  }
  assert.deepEqual(failures, [], `approval contrast failures:\n${failures.join('\n')}`);
});
