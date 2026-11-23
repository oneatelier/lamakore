import React from 'react';
import { getProductName } from '../../../../packages/branding/src/index.js';
import { ThemeProvider, useTheme } from '../../../../packages/ui/src/theme/ThemeProvider.js';
import type { ThemeName } from '../../../../packages/ui/src/theme/themes.js';
import { THEME_NAMES, themeLabel } from '../../../../packages/ui/src/theme/themes.js';
import { FirstRun } from './screens/FirstRun.js';
import { Shell } from './screens/Shell.js';
import type { ConnState, LedgerStatus } from '../main/daemon.js';

declare global {
  interface Window {
    [key: string]: unknown;
  }
}

interface Bridge {
  invoke: (method: string, params?: unknown) => Promise<unknown>;
  subscribe: (topic: string, cb: (data: unknown) => void) => number;
  unsubscribe: (id: number) => void;
}

function bridge(): Bridge | null {
  const g = window as unknown as Record<string, unknown>;
  for (const v of Object.values(g)) {
    if (v !== null && typeof v === 'object' && 'invoke' in (v as object) && 'subscribe' in (v as object)) {
      return v as Bridge;
    }
  }
  return null;
}

const SEEN_KEY = 'ui.seenDeck';

function Connected({ forcedConn, forcedScreen }: { forcedConn?: ConnState | null; forcedScreen?: string | null }) {
  const { theme, setTheme } = useTheme();
  const [conn, setConn] = React.useState<ConnState>(forcedConn ?? 'connecting');
  const [info, setInfo] = React.useState<Record<string, unknown> | null>(null);
  const [ledger, setLedger] = React.useState<LedgerStatus | null>(null);
  const [screen, setScreen] = React.useState<'first-run' | 'deck'>(() => {
    if (forcedScreen === 'firstrun') return 'first-run';
    if (forcedScreen === 'deck') return 'deck';
    try {
      return window.localStorage.getItem(SEEN_KEY) ? 'deck' : 'first-run';
    } catch {
      return 'first-run';
    }
  });

  const openDeck = React.useCallback(() => {
    try {
      window.localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* private mode: the deck still opens for this session */
    }
    setScreen('deck');
  }, []);

  React.useEffect(() => {
    if (forcedConn) {
      setConn(forcedConn);
      if (forcedConn === 'connected') {
        setInfo({ product: getProductName(), daemon: 'dev-preview', protocol: 'wire/1', build: 'dev' });
      }
      return;
    }
    const b = bridge();
    if (!b) {
      setConn('unreachable');
      return;
    }
    let sub = -1;
    let cancelled = false;
    const refreshInfo = () => {
      b.invoke('system.info', {})
        .then((v) => {
          if (!cancelled) {
            setInfo((v as Record<string, unknown>) ?? null);
            setConn((c) => (c === 'connecting' ? 'connected' : c));
          }
        })
        .catch(() => {
          if (!cancelled) setConn((c) => (c === 'connecting' ? 'unreachable' : c));
        });
    };
    const refreshLedger = () => {
      b.invoke('audit.verify', {})
        .then((v) => {
          if (cancelled) return;
          const o = (v as Record<string, unknown>) ?? {};
          setLedger({
            ok: o['ok'] === true,
            events: typeof o['events'] === 'number' ? (o['events'] as number) : 0,
            badSeq: typeof o['bad_seq'] === 'number' ? (o['bad_seq'] as number) : null,
            head: typeof o['head'] === 'string' ? (o['head'] as string) : null,
          });
        })
        .catch(() => {
          /* ledger unknown: no banner rather than a wrong banner */
        });
    };
    sub = b.subscribe('daemon.state', (s) => {
      if (typeof s !== 'string') return;
      if (cancelled) return;
      setConn(s as ConnState);
      if (s === 'connected') {
        refreshInfo();
        refreshLedger();
      }
    });
    refreshInfo();
    refreshLedger();
    return () => {
      cancelled = true;
      try {
        b.unsubscribe(sub);
      } catch {
        /* bridge gone */
      }
    };
  }, [forcedConn]);

  const invoke = React.useCallback((method: string, params?: unknown) => {
    const b = bridge();
    if (!b) return Promise.reject(new Error('no bridge: not running inside the desktop shell'));
    return b.invoke(method, params ?? {});
  }, []);

  const retry = React.useCallback(() => {
    setConn('connecting');
    const b = bridge();
    if (!b) {
      setConn('unreachable');
      return;
    }
    b.invoke('system.health', {})
      .then(() => b.invoke('system.info', {}))
      .then((v) => {
        setInfo((v as Record<string, unknown>) ?? null);
        setConn('connected');
      })
      .catch(() => setConn('unreachable'));
  }, []);

  const recheckLedger = React.useCallback(() => {
    const b = bridge();
    if (!b) return;
    b.invoke('audit.verify', {})
      .then((v) => {
        const o = (v as Record<string, unknown>) ?? {};
        setLedger({
          ok: o['ok'] === true,
          events: typeof o['events'] === 'number' ? (o['events'] as number) : 0,
          badSeq: typeof o['bad_seq'] === 'number' ? (o['bad_seq'] as number) : null,
          head: typeof o['head'] === 'string' ? (o['head'] as string) : null,
        });
      })
      .catch(() => {
        /* keep the last known ledger state */
      });
  }, []);

  if (screen === 'first-run' && !forcedConn) {
    return React.createElement(FirstRun, {
      conn,
      theme,
      themes: THEME_NAMES,
      themeLabel,
      setTheme,
      onOpenDeck: openDeck,
    });
  }
  return React.createElement(Shell, {
    conn,
    ledger,
    product: typeof info?.['product'] === 'string' ? (info['product'] as string) : getProductName(),
    daemon: typeof info?.['daemon'] === 'string' ? (info['daemon'] as string) : '…',
    build: typeof info?.['build'] === 'string' ? (info['build'] as string) : '…',
    theme,
    themes: THEME_NAMES,
    themeLabel,
    setTheme,
    onRetry: retry,
    onRecheckLedger: recheckLedger,
    invoke,
  });
}

export function App({ forcedConn, initialTheme, forcedScreen }: { forcedConn?: ConnState | null; initialTheme?: ThemeName; forcedScreen?: string | null }) {
  return React.createElement(ThemeProvider, { initial: initialTheme }, React.createElement(Connected, { forcedConn, forcedScreen }));
}
