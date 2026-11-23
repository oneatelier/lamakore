// Shell: the designed application shell — title bar, left rail, main canvas,
// status strip with the daemon connection state. All four states are built
// from the shared state components; every state is fully designed.
// The connected canvas hosts the wire/1 approval.request deck card.
import React from 'react';
import type { ThemeName } from '../../../../../packages/ui/src/theme/themes.js';
import type { ConnState, LedgerStatus } from '../../main/daemon.js';
import {
  approve as approveApproval,
  createApproval,
  deny as denyApproval,
  editScope as editApprovalScope,
  tick as tickApproval,
  type ApprovalCardState,
} from '../../../../../packages/ui/src/approvals/approval.js';
import { ApprovalCard } from '../../../../../packages/ui/src/approvals/ApprovalCard.js';
import { DegradedState, EmptyState, ErrorState, LedgerTamperBanner, LoadingState } from '../components/states.js';
import { FilesPanel, type FilesInvoke } from '../components/FilesPanel.js';

function useDemoApproval(): { state: ApprovalCardState; now: number; onApprove: () => void; onDeny: () => void; onEdit: (scope: string) => void } {
  const [state, setState] = React.useState<ApprovalCardState>(() =>
    createApproval({ tool: 'tool.exec', scope: '/proj', reason: 'Read logs to diagnose the failure.', ttlSecs: 120 }, Date.now() / 1000, 'apr-deck-demo'),
  );
  const [now, setNow] = React.useState<number>(() => Date.now() / 1000);
  React.useEffect(() => {
    const t = setInterval(() => {
      const tnow = Date.now() / 1000;
      setNow(tnow);
      setState((s) => tickApproval(s, tnow));
    }, 500);
    return () => clearInterval(t);
  }, []);
  return {
    state,
    now,
    onApprove: () => setState((s) => approveApproval(s, Date.now() / 1000, 'deck')),
    onDeny: () => setState((s) => denyApproval(s, Date.now() / 1000, 'deck')),
    onEdit: (scope: string) =>
      setState((s) => {
        try {
          return editApprovalScope(s, scope, Date.now() / 1000);
        } catch {
          return s;
        }
      }),
  };
}

export interface ShellProps {
  conn: ConnState;
  ledger: LedgerStatus | null;
  product: string;
  daemon: string;
  build: string;
  theme: ThemeName;
  themes: readonly ThemeName[];
  themeLabel: (t: ThemeName) => string;
  setTheme: (t: ThemeName) => void;
  onRetry: () => void;
  onRecheckLedger: () => void;
  invoke: FilesInvoke;
}

const DOT: Record<ConnState, string> = {
  connecting: 'var(--signal-warning)',
  connected: 'var(--signal-success)',
  unreachable: 'var(--signal-danger)',
  degraded: 'var(--signal-warning)',
};

const STATUS: Record<ConnState, string> = {
  connecting: 'Connecting to daemon…',
  connected: 'Daemon connected',
  unreachable: 'Daemon unreachable',
  degraded: 'Daemon degraded',
};

function Bar({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-s3)',
        padding: 'var(--space-s2) var(--space-s4)',
        backgroundColor: 'var(--surface-raised)',
      },
    },
    children,
  );
}

function ConnectedCanvas(props: { daemon: string; build: string; invoke: FilesInvoke }): React.JSX.Element {
  const demo = useDemoApproval();
  return React.createElement(
    'div',
    null,
    React.createElement(
      'h1',
      { style: { fontFamily: 'var(--font-display)', fontSize: 'var(--text-t34)', margin: '0 0 var(--space-s2)' } },
      'Ready to work',
    ),
    React.createElement(
      'p',
      { style: { color: 'var(--text-secondary)', fontSize: 'var(--text-t14)' } },
      `Daemon ${props.daemon} · build ${props.build} · wire/1 handshake verified.`,
    ),
    React.createElement(EmptyState, {
      title: 'The canvas starts empty.',
      body: 'Ask anything. Tools run sandboxed; every mutation asks first.',
    }),
    React.createElement(FilesPanel, { invoke: props.invoke, initialScope: '' }),
    React.createElement(
      'div',
      { style: { marginTop: 'var(--space-s6)' } },
      React.createElement(ApprovalCard, {
        state: demo.state,
        now: demo.now,
        onApprove: demo.onApprove,
        onDeny: demo.onDeny,
        onEdit: demo.onEdit,
      }),
    ),
  );
}

export function Shell(props: ShellProps): React.JSX.Element {
  const { conn } = props;
  return React.createElement(
    'main',
    {
      style: {
        backgroundColor: 'var(--surface-void)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-ui)',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
      },
    },
    React.createElement(
      'header',
      { style: { WebkitAppRegion: 'drag' } as React.CSSProperties },
      React.createElement(
        Bar,
        null,
        React.createElement(
          'span',
          { style: { fontFamily: 'var(--font-display)', fontSize: 'var(--text-t16)' } },
          props.product,
        ),
        React.createElement('span', { style: { flex: 1 } }),
        props.themes.map((t) =>
          React.createElement(
            'button',
            {
              key: t,
              type: 'button',
              onClick: () => props.setTheme(t),
              'aria-pressed': t === props.theme,
              style: {
                WebkitAppRegion: 'no-drag',
                backgroundColor: t === props.theme ? 'var(--brass-primary)' : 'transparent',
                color: t === props.theme ? 'var(--surface-void)' : 'var(--text-secondary)',
                border: '1px solid var(--text-secondary)',
                borderRadius: 'var(--radius-r8)',
                padding: 'var(--space-s1) var(--space-s3)',
                cursor: 'pointer',
                fontSize: 'var(--text-t13)',
              } as React.CSSProperties,
            },
            props.themeLabel(t),
          ),
        ),
      ),
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', flex: 1, minHeight: 0 } },
      React.createElement(
        'nav',
        {
          'aria-label': 'Primary',
          style: {
            width: '200px',
            backgroundColor: 'var(--surface-base)',
            padding: 'var(--space-s4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-s2)',
          },
        },
        ['Agent', 'Tools', 'Memory', 'Settings'].map((item, i) =>
          React.createElement(
            'button',
            {
              key: item,
              type: 'button',
              'aria-current': i === 0 ? 'page' : undefined,
              style: {
                textAlign: 'left',
                backgroundColor: i === 0 ? 'var(--surface-raised)' : 'transparent',
                color: 'var(--text-primary)',
                border: 'none',
                borderRadius: 'var(--radius-r8)',
                padding: 'var(--space-s2) var(--space-s3)',
                cursor: 'pointer',
                fontSize: 'var(--text-t14)',
              },
            },
            item,
          ),
        ),
      ),
      React.createElement(
        'section',
        { style: { flex: 1, padding: 'var(--space-s6)', overflow: 'auto' } },
        props.ledger !== null &&
          !props.ledger.ok &&
          React.createElement(LedgerTamperBanner, {
            events: props.ledger.events,
            badSeq: props.ledger.badSeq,
            onRecheck: props.onRecheckLedger,
          }),
        conn === 'connecting' &&
          React.createElement(LoadingState, { label: 'Connecting to the daemon — hang tight.' }),
        conn === 'connected' &&
          React.createElement(ConnectedCanvas, { daemon: props.daemon, build: props.build, invoke: props.invoke }),
        conn === 'unreachable' &&
          React.createElement(ErrorState, {
            title: 'Daemon unreachable',
            cause: 'The trusted core stopped answering.',
            fix: 'Your work is safe — reconnect to resume.',
            actionLabel: 'Retry connection',
            onAction: props.onRetry,
          }),
        conn === 'degraded' &&
          React.createElement(
            'div',
            null,
            React.createElement(DegradedState, {
              body: 'Daemon is slow or spilling events — answers may lag.',
              actionLabel: 'Retry now',
              onAction: props.onRetry,
            }),
            React.createElement(
              'p',
              { style: { color: 'var(--text-secondary)', fontSize: 'var(--text-t14)' } },
              'Working degraded — new tasks are queued behind health recovery.',
            ),
          ),
      ),
    ),
    React.createElement(
      'footer',
      null,
      React.createElement(
        Bar,
        null,
        React.createElement('span', {
          'aria-label': `daemon: ${conn}`,
          title: `daemon: ${conn}`,
          style: {
            width: '10px',
            height: '10px',
            borderRadius: '999px',
            backgroundColor: DOT[conn],
            display: 'inline-block',
          },
        }),
        React.createElement(
          'span',
          { role: 'status', style: { color: 'var(--text-secondary)', fontSize: 'var(--text-t13)' } },
          STATUS[conn],
        ),
        React.createElement('span', { style: { flex: 1 } }),
        (conn === 'unreachable' || conn === 'degraded') &&
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: props.onRetry,
              style: {
                background: 'none',
                border: 'none',
                color: 'var(--brass-primary)',
                cursor: 'pointer',
                fontSize: 'var(--text-t13)',
                textDecoration: 'underline',
              },
            },
            'Retry',
          ),
        React.createElement(
          'span',
          { style: { color: 'var(--text-disabled)', fontSize: 'var(--text-t12)', fontFamily: 'var(--font-mono)' } },
          'wire/1 · sandboxed',
        ),
      ),
    ),
  );
}
