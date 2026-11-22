import React from 'react';
import { getProductName } from '../../../../packages/branding/src/index.js';
import { ThemeProvider, useTheme } from '../../../../packages/ui/src/theme/ThemeProvider.js';
import type { ThemeName } from '../../../../packages/ui/src/theme/themes.js';
import { THEME_NAMES, themeLabel } from '../../../../packages/ui/src/theme/themes.js';
import { Shell } from './screens/Shell.js';
import type { ConnState } from '../main/daemon.js';

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

function Connected({ forcedConn }: { forcedConn?: ConnState | null }) {
  const { theme, setTheme } = useTheme();
  const [conn, setConn] = React.useState<ConnState>(forcedConn ?? 'connecting');
  const [info, setInfo] = React.useState<Record<string, unknown> | null>(null);

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
    sub = b.subscribe('daemon.state', (s) => {
      if (!cancelled && typeof s === 'string') {
        setConn(s as ConnState);
        if (s === 'connected') {
          b.invoke('system.info', {})
            .then((v) => {
              if (!cancelled) setInfo((v as Record<string, unknown>) ?? null);
            })
            .catch(() => {
              /* stays on brand fallback labels */
            });
        }
      }
    });
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
    return () => {
      cancelled = true;
      try {
        b.unsubscribe(sub);
      } catch {
        /* bridge gone */
      }
    };
  }, [forcedConn]);

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

  return React.createElement(Shell, {
    conn,
    product: typeof info?.['product'] === 'string' ? (info['product'] as string) : getProductName(),
    daemon: typeof info?.['daemon'] === 'string' ? (info['daemon'] as string) : '…',
    build: typeof info?.['build'] === 'string' ? (info['build'] as string) : '…',
    theme,
    themes: THEME_NAMES,
    themeLabel,
    setTheme,
    onRetry: retry,
  });
}

export function App({ forcedConn, initialTheme }: { forcedConn?: ConnState | null; initialTheme?: ThemeName }) {
  return React.createElement(ThemeProvider, { initial: initialTheme }, React.createElement(Connected, { forcedConn }));
}
