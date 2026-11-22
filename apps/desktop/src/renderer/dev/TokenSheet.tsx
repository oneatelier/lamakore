// TokenSheet: internal page rendering every design token with live labels.
// First visible artifact of the project. No raw colors anywhere — every
// swatch reads CSS custom properties generated from design-tokens.json.
import React from 'react';
import { getProductName } from '../../../../../packages/branding/src/index.js';
import {
  DURATIONS,
  EASINGS,
  ELEVATION,
  RADII,
  SETTLE_MAX_MS,
  SPACING,
  SPRINGS,
  THEMES,
  TYPE_SCALE,
  type ThemeName,
} from '../../../../../packages/ui/src/tokens/generated.js';
import { THEME_NAMES, themeLabel } from '../../../../../packages/ui/src/theme/themes.js';
import { useTheme } from '../../../../../packages/ui/src/theme/ThemeProvider.js';

function Swatch({ label, cssVar, sub }: { label: string; cssVar: string; sub: string }): React.JSX.Element {
  return React.createElement(
    'div',
    { style: { display: 'flex', gap: 'var(--space-s3)', alignItems: 'center' } },
    React.createElement('div', {
      'aria-label': label,
      style: {
        width: '56px',
        height: '40px',
        borderRadius: 'var(--radius-r8)',
        backgroundColor: `var(${cssVar})`,
        boxShadow: 'var(--elevation-e1-shadow), var(--elevation-e1-inner)',
      },
    }),
    React.createElement(
      'div',
      null,
      React.createElement('div', { style: { color: 'var(--text-primary)', fontSize: 'var(--text-t14)' } }, label),
      React.createElement('div', { style: { color: 'var(--text-secondary)', fontSize: 'var(--text-t12)', fontFamily: 'var(--font-mono)' } }, sub),
    ),
  );
}

function Section({ title, children }: { title: string; children?: React.ReactNode }): React.JSX.Element {
  return React.createElement(
    'section',
    { style: { marginTop: 'var(--space-s8)' } },
    React.createElement(
      'h2',
      { style: { color: 'var(--text-primary)', fontSize: 'var(--text-t20)', fontFamily: 'var(--font-display)' } },
      title,
    ),
    children,
  );
}

const COLOR_GROUPS: Array<{ title: string; vars: string[] }> = [
  { title: 'Surfaces', vars: ['--surface-void', '--surface-base', '--surface-raised', '--surface-overlay'] },
  { title: 'Text', vars: ['--text-primary', '--text-secondary', '--text-disabled'] },
  { title: 'Brass', vars: ['--brass-primary', '--brass-hover', '--brass-pressed'] },
  { title: 'Signal', vars: ['--signal-success', '--signal-warning', '--signal-danger', '--signal-info'] },
  { title: 'Focus', vars: ['--focus-ring'] },
];

function varName(v: string): string {
  return v.slice(2);
}

export function TokenSheet({ theme }: { theme: ThemeName }) {
  const { setTheme } = useTheme();
  const tokens = THEMES[theme];
  const colorEntries = Object.entries(tokens.colors) as Array<[string, string]>;
  const hexOf = (key: string): string => colorEntries.find(([k]) => k === key)?.[1] ?? '';
  return React.createElement(
    'main',
    {
      style: {
        backgroundColor: 'var(--surface-void)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-ui)',
        minHeight: '100vh',
        padding: 'var(--space-s8)',
      },
    },
    React.createElement(
      'h1',
      { style: { fontFamily: 'var(--font-display)', fontSize: 'var(--text-t46)', margin: 0 } },
      `${getProductName()} — Token Sheet`,
    ),
    React.createElement(
      'p',
      { style: { color: 'var(--text-secondary)', fontSize: 'var(--text-t14)' } },
      `Theme ${themeLabel(theme)} · Brass & Void · every value below is live from design-tokens.json`,
    ),
    React.createElement(
      'nav',
      { 'aria-label': 'Theme switcher', style: { display: 'flex', gap: 'var(--space-s2)', flexWrap: 'wrap' } },
      THEME_NAMES.map((name) =>
        React.createElement(
          'button',
          {
            key: name,
            type: 'button',
            onClick: () => setTheme(name),
            'aria-pressed': name === theme,
            style: {
              backgroundColor: name === theme ? 'var(--brass-primary)' : 'var(--surface-raised)',
              color: name === theme ? 'var(--surface-void)' : 'var(--text-primary)',
              borderRadius: 'var(--radius-r8)',
              border: 'none',
              padding: 'var(--space-s2) var(--space-s4)',
              fontSize: 'var(--text-t14)',
              cursor: 'pointer',
            },
          },
          themeLabel(name),
        ),
      ),
    ),
    COLOR_GROUPS.map((group) =>
      React.createElement(
        Section,
        { key: group.title, title: group.title },
        React.createElement(
          'div',
          { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--space-s4)' } },
          group.vars.map((v) => React.createElement(Swatch, { key: v, label: varName(v), cssVar: v, sub: hexOf(varName(v)) })),
        ),
      ),
    ),
    React.createElement(
      Section,
      { title: 'Type' },
      Object.entries(TYPE_SCALE).map(([step, px]) =>
        React.createElement(
          'p',
          { key: step, style: { fontSize: `${px}px`, margin: 'var(--space-s2) 0', color: 'var(--text-primary)' } },
          `${step} · ${px}px · The quick brown fox`,
        ),
      ),
    ),
    React.createElement(
      Section,
      { title: 'Radius' },
      React.createElement(
        'div',
        { style: { display: 'flex', gap: 'var(--space-s4)' } },
        Object.entries(RADII).map(([name, px]) =>
          React.createElement('div', {
            key: name,
            title: `${name} ${px}`,
            style: {
              width: '64px',
              height: '64px',
              backgroundColor: 'var(--brass-primary)',
              borderRadius: px === 999 ? '999px' : `${px}px`,
            },
          }),
        ),
      ),
    ),
    React.createElement(
      Section,
      { title: 'Elevation' },
      React.createElement(
        'div',
        { style: { display: 'flex', gap: 'var(--space-s4)' } },
        Object.entries(ELEVATION).map(([name, e]) =>
          React.createElement('div', {
            key: name,
            title: name,
            style: {
              width: '96px',
              height: '64px',
              backgroundColor: 'var(--surface-raised)',
              borderRadius: 'var(--radius-r12)',
              boxShadow: [e.shadow, e.inner].filter((s) => s !== 'none').join(', '),
            },
          }),
        ),
      ),
    ),
    React.createElement(
      Section,
      { title: 'Motion' },
      Object.entries(DURATIONS).map(([name, ms]) =>
        React.createElement(
          'div',
          { key: name, style: { display: 'flex', gap: 'var(--space-s3)', alignItems: 'center', marginBottom: 'var(--space-s2)' } },
          React.createElement('span', { style: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-t13)', width: '120px' } }, `${name} · ${ms}ms`),
          React.createElement('span', {
            style: {
              display: 'inline-block',
              height: '8px',
              width: `${Math.max(8, (ms as number) / 2)}px`,
              backgroundColor: 'var(--brass-primary)',
              borderRadius: 'var(--radius-full)',
            },
          }),
        ),
      ),
      Object.entries(EASINGS).map(([name, curve]) =>
        React.createElement(
          'p',
          { key: name, style: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-t13)', color: 'var(--text-secondary)' } },
          `${name} ${curve}${name === 'settle' ? ` (only ≤${SETTLE_MAX_MS}ms)` : ''}`,
        ),
      ),
      React.createElement(
        'p',
        { style: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-t13)', color: 'var(--text-secondary)' } },
        `springs ${Object.entries(SPRINGS).map(([n, s]) => `${n}{${(s as { stiffness: number }).stiffness},${(s as { damping: number }).damping}}`).join(' ')}`,
      ),
    ),
    React.createElement(
      Section,
      { title: 'Focus demo — tab through this' },
      React.createElement(
        'div',
        { style: { display: 'flex', gap: 'var(--space-s3)', alignItems: 'center', flexWrap: 'wrap' } },
        React.createElement(
          'button',
          {
            type: 'button',
            style: {
              backgroundColor: 'var(--brass-primary)',
              color: 'var(--surface-void)',
              border: 'none',
              borderRadius: 'var(--radius-r8)',
              padding: 'var(--space-s2) var(--space-s4)',
              cursor: 'pointer',
            },
          },
          'Primary action',
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            style: {
              backgroundColor: 'transparent',
              color: 'var(--text-primary)',
              borderRadius: 'var(--radius-r8)',
              padding: 'var(--space-s2) var(--space-s4)',
              cursor: 'pointer',
              border: '1px solid var(--text-secondary)',
            },
          },
          'Secondary action',
        ),
        React.createElement('a', { href: '#focus-demo', style: { color: 'var(--brass-primary)' } }, 'Example link'),
        React.createElement('input', {
          type: 'text',
          defaultValue: 'Example input',
          'aria-label': 'Example input',
          style: {
            backgroundColor: 'var(--surface-raised)',
            color: 'var(--text-primary)',
            borderRadius: 'var(--radius-r8)',
            border: '1px solid var(--text-secondary)',
            padding: 'var(--space-s2)',
          },
        }),
      ),
    ),
    React.createElement(
      'footer',
      { style: { marginTop: 'var(--space-s12)', color: 'var(--text-disabled)', fontSize: 'var(--text-t12)' } },
      `spacing 4-based 0–${SPACING.s12} · type ${Object.values(TYPE_SCALE).join('/')} · reduced-motion swaps transforms for cross-fades`,
    ),
  );
}
