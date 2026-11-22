// FirstRun: the welcome screen. Honest software states plainly what it is
// and what it is not. No metrics, no testimonials, no roadmaps.
// Two actions only: open the deck, or read the guide.
import React from 'react';
import { getProductName } from '../../../../../packages/branding/src/index.js';
import type { ThemeName } from '../../../../../packages/ui/src/theme/themes.js';
import type { ConnState } from '../../main/daemon.js';
import { HOST_PROFILE } from '../hostProfile.js';

const CONN_LABEL: Record<ConnState, string> = {
  connecting: 'Daemon: connecting…',
  connected: 'Daemon: connected and verified',
  unreachable: 'Daemon: unreachable — the deck still opens; tools will retry',
  degraded: 'Daemon: degraded — answers may lag',
};

export function FirstRun(props: {
  conn: ConnState;
  theme: ThemeName;
  themes: readonly ThemeName[];
  themeLabel: (t: ThemeName) => string;
  setTheme: (t: ThemeName) => void;
  onOpenDeck: () => void;
}): React.JSX.Element {
  const [guideOpen, setGuideOpen] = React.useState(false);
  return React.createElement(
    'main',
    {
      style: {
        backgroundColor: 'var(--surface-void)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-ui)',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-s8)',
      },
    },
    React.createElement(
      'div',
      { style: { maxWidth: '640px', width: '100%' } },
      React.createElement(
        'p',
        { style: { color: 'var(--text-secondary)', fontSize: 'var(--text-t13)', margin: '0 0 var(--space-s2)' } },
        'Early, honest software — pre-alpha, provisional name.',
      ),
      React.createElement(
        'h1',
        { style: { fontFamily: 'var(--font-display)', fontSize: 'var(--text-t46)', margin: '0 0 var(--space-s2)' } },
        getProductName(),
      ),
      React.createElement(
        'p',
        { style: { color: 'var(--text-secondary)', fontSize: 'var(--text-t16)', margin: '0 0 var(--space-s6)' } },
        'A unified agent desktop: a real window, a trusted local core, and tools that run sandboxed. What it is not: a finished product, a cloud service, or anything that phones home — there is no account, no telemetry, and no network listener.',
      ),
      React.createElement(
        'section',
        {
          'aria-label': 'Reference host profile',
          style: {
            backgroundColor: 'var(--surface-raised)',
            borderRadius: 'var(--radius-r12)',
            padding: 'var(--space-s4)',
            marginBottom: 'var(--space-s4)',
          },
        },
        React.createElement(
          'h2',
          { style: { fontSize: 'var(--text-t14)', color: 'var(--text-secondary)', margin: '0 0 var(--space-s2)', fontWeight: 600 } },
          'Reference host (P000 inventory)',
        ),
        React.createElement(
          'dl',
          { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--space-s1) var(--space-s4)', margin: 0, fontSize: 'var(--text-t13)' } },
          React.createElement('dt', { style: { color: 'var(--text-disabled)' } }, 'OS'),
          React.createElement('dd', { style: { margin: 0 } }, HOST_PROFILE.os),
          React.createElement('dt', { style: { color: 'var(--text-disabled)' } }, 'CPU'),
          React.createElement('dd', { style: { margin: 0 } }, HOST_PROFILE.cpu),
          React.createElement('dt', { style: { color: 'var(--text-disabled)' } }, 'Memory'),
          React.createElement('dd', { style: { margin: 0 } }, HOST_PROFILE.memory),
          React.createElement('dt', { style: { color: 'var(--text-disabled)' } }, 'GPU'),
          React.createElement('dd', { style: { margin: 0 } }, `${HOST_PROFILE.gpu} — tier ${HOST_PROFILE.gpuTier}`),
          React.createElement('dt', { style: { color: 'var(--text-disabled)' } }, 'Local model'),
          React.createElement('dd', { style: { margin: 0 } }, `quantized 7B class (${HOST_PROFILE.modelClass})`),
        ),
      ),
      React.createElement(
        'p',
        { role: 'status', style: { color: 'var(--text-secondary)', fontSize: 'var(--text-t14)', margin: '0 0 var(--space-s6)' } },
        CONN_LABEL[props.conn],
      ),
      React.createElement(
        'div',
        { style: { display: 'flex', gap: 'var(--space-s3)', flexWrap: 'wrap' } },
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: props.onOpenDeck,
            style: {
              backgroundColor: 'var(--brass-primary)',
              color: 'var(--surface-void)',
              border: 'none',
              borderRadius: 'var(--radius-r8)',
              padding: 'var(--space-s3) var(--space-s5)',
              cursor: 'pointer',
              fontSize: 'var(--text-t16)',
            },
          },
          'Open the deck',
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => setGuideOpen((v) => !v),
            'aria-expanded': guideOpen,
            style: {
              backgroundColor: 'transparent',
              color: 'var(--text-primary)',
              border: '1px solid var(--text-secondary)',
              borderRadius: 'var(--radius-r8)',
              padding: 'var(--space-s3) var(--space-s5)',
              cursor: 'pointer',
              fontSize: 'var(--text-t16)',
            },
          },
          'Read the guide',
        ),
      ),
      guideOpen &&
        React.createElement(
          'section',
          {
            'aria-label': 'Getting started guide',
            style: {
              marginTop: 'var(--space-s4)',
              backgroundColor: 'var(--surface-base)',
              borderRadius: 'var(--radius-r12)',
              padding: 'var(--space-s4)',
              fontSize: 'var(--text-t14)',
              color: 'var(--text-secondary)',
            },
          },
          React.createElement('p', { style: { marginTop: 0 } }, '1. Open the deck. The canvas starts empty until you ask something.'),
          React.createElement('p', null, '2. Every file change shows a diff first. Nothing applies silently.'),
          React.createElement('p', null, '3. Tools run sandboxed; the daemon asks before anything sensitive.'),
          React.createElement('p', { style: { marginBottom: 0 } }, '4. This build is local-only: no accounts, no telemetry, no open ports.'),
        ),
      React.createElement(
        'div',
        { style: { marginTop: 'var(--space-s6)', display: 'flex', gap: 'var(--space-s2)', flexWrap: 'wrap' } },
        props.themes.map((t) =>
          React.createElement(
            'button',
            {
              key: t,
              type: 'button',
              onClick: () => props.setTheme(t),
              'aria-pressed': t === props.theme,
              style: {
                backgroundColor: t === props.theme ? 'var(--brass-primary)' : 'transparent',
                color: t === props.theme ? 'var(--surface-void)' : 'var(--text-secondary)',
                border: '1px solid var(--text-secondary)',
                borderRadius: 'var(--radius-full)',
                padding: 'var(--space-s1) var(--space-s3)',
                cursor: 'pointer',
                fontSize: 'var(--text-t13)',
              },
            },
            props.themeLabel(t),
          ),
        ),
      ),
    ),
  );
}
