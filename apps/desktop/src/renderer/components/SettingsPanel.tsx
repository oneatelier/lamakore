// SettingsPanel: provider API keys in the deck — the ONLY secret surface.
//
// Privacy contract (see crates/vault, crates/cored/src/secret_tool.rs):
// - Plaintext NEVER crosses the wire to the deck. The deck sends plaintext
//   once (secret.set, explicit save); every daemon response carries
//   metadata or an opaque handle (vault:v1:<provider>) only.
// - Masked input (type=password, no autocomplete, no value logging).
// - Provider select over the fixed allowlist (no free-form keychain slots).
// - Explicit "test connection" button: ONE user-initiated secret.test
//   request (local keychain read + length sanity, zero network calls).
//   ZERO background calls: this panel issues no wire request on mount,
//   on provider change, or on keystroke — only on explicit button clicks.
import React from 'react';
import {
  SECRET_DELETE_METHOD,
  SECRET_LIST_METHOD,
  SECRET_REF_METHOD,
  SECRET_SET_METHOD,
  SECRET_TEST_METHOD,
  SUPPORTED_PROVIDERS,
  isSupportedProvider,
} from '../../../../../packages/protocol/src/secrets.js';

export interface SettingsInvoke {
  (method: string, params?: unknown): Promise<unknown>;
}

interface Row {
  provider: string;
  has_key: boolean;
  ref: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

function errText(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) {
    const m = e.message.match(/daemon error (-?\d+): (.+)/);
    if (m) return m[2];
    return e.message;
  }
  return 'unknown error';
}

export function SettingsPanel(props: { invoke: SettingsInvoke }): React.JSX.Element {
  const [provider, setProvider] = React.useState<string>(SUPPORTED_PROVIDERS[0]);
  // The key lives in this input only; it is never rendered, never logged,
  // and cleared from state immediately after a successful save.
  const [secret, setSecret] = React.useState('');
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [status, setStatus] = React.useState<string>('Keys stay in the OS keychain — never in the app database.');
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setBusy(true);
    try {
      const v = (await props.invoke(SECRET_LIST_METHOD, {})) as { providers?: Row[] };
      if (Array.isArray(v?.providers)) {
        setRows(v.providers as Row[]);
        setStatus('Refreshed from the vault (handles only — no key bytes).');
      } else {
        setStatus('Refresh failed: unexpected response.');
      }
    } catch (e) {
      setStatus(`Refresh failed: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }, [props.invoke]);

  const save = React.useCallback(async () => {
    if (!isSupportedProvider(provider)) {
      setStatus('Select a supported provider.');
      return;
    }
    if (secret.length === 0) {
      setStatus('Paste a key first — nothing was sent.');
      return;
    }
    setBusy(true);
    try {
      // ONE user-initiated request carrying plaintext deck → daemon.
      // The daemon stores it in the OS keychain and returns a handle only.
      await props.invoke(SECRET_SET_METHOD, { provider, secret });
      // Drop the plaintext from renderer memory immediately after save.
      setSecret('');
      setStatus(`Saved ${provider} to the OS keychain (handle only returned).`);
      await refresh();
    } catch (e) {
      setStatus(`Save failed: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }, [props.invoke, provider, secret, refresh]);

  const testConnection = React.useCallback(async () => {
    if (!isSupportedProvider(provider)) {
      setStatus('Select a supported provider.');
      return;
    }
    setBusy(true);
    try {
      // ONE user-initiated request: local keychain read + length sanity,
      // zero network calls, zero background polling. Never returns bytes.
      const v = (await props.invoke(SECRET_TEST_METHOD, { provider })) as {
        ok?: boolean;
        reason?: string;
      };
      if (isRecord(v) && v['ok'] === true) {
        setStatus(`Test passed for ${provider} (local keychain read, no network).`);
      } else if (isRecord(v) && typeof v['reason'] === 'string') {
        setStatus(`Test: ${provider} — ${String(v['reason'])} (no key bytes returned).`);
      } else {
        setStatus(`Test: ${provider} — unexpected response.`);
      }
    } catch (e) {
      setStatus(`Test failed: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }, [props.invoke, provider]);

  const showRef = React.useCallback(async () => {
    if (!isSupportedProvider(provider)) return;
    setBusy(true);
    try {
      const v = (await props.invoke(SECRET_REF_METHOD, { provider })) as { ref?: string };
      if (isRecord(v) && typeof v['ref'] === 'string') {
        setStatus(`Handle for ${provider}: ${String(v['ref'])} (opaque — not the key).`);
      } else {
        setStatus(`No handle for ${provider}.`);
      }
    } catch (e) {
      setStatus(`No key stored for ${provider} (${errText(e)}).`);
    } finally {
      setBusy(false);
    }
  }, [props.invoke, provider]);

  const remove = React.useCallback(async () => {
    if (!isSupportedProvider(provider)) return;
    setBusy(true);
    try {
      const v = (await props.invoke(SECRET_DELETE_METHOD, { provider })) as { deleted?: boolean };
      setStatus(
        isRecord(v) && v['deleted'] === true
          ? `Deleted ${provider} from the OS keychain.`
          : `No key stored for ${provider}.`,
      );
      await refresh();
    } catch (e) {
      setStatus(`Delete failed: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }, [props.invoke, provider, refresh]);

  return React.createElement(
    'div',
    null,
    React.createElement(
      'h1',
      { style: { fontFamily: 'var(--font-display)', fontSize: 'var(--text-t34)', margin: '0 0 var(--space-s2)' } },
      'Settings',
    ),
    React.createElement(
      'p',
      { style: { color: 'var(--text-secondary)', fontSize: 'var(--text-t14)' } },
      'Provider keys live in the OS keychain (Credential Manager / Keychain / Secret Service) — never in the app database, never returned to this screen.',
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', gap: 'var(--space-s3)', alignItems: 'end', flexWrap: 'wrap', marginTop: 'var(--space-s4)' } },
      React.createElement(
        'label',
        { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-s1)', fontSize: 'var(--text-t13)' } },
        'Provider',
        React.createElement(
          'select',
          {
            value: provider,
            disabled: busy,
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setProvider(e.target.value),
            'aria-label': 'Provider',
          },
          SUPPORTED_PROVIDERS.map((p) =>
            React.createElement('option', { key: p, value: p }, p),
          ),
        ),
      ),
      React.createElement(
        'label',
        { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-s1)', fontSize: 'var(--text-t13)' } },
        'API key (masked, never displayed)',
        React.createElement('input', {
          type: 'password',
          value: secret,
          disabled: busy,
          autoComplete: 'off',
          spellCheck: false,
          placeholder: 'paste key — sent once on Save',
          'aria-label': 'API key',
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSecret(e.target.value),
          style: { minWidth: '280px' },
        }),
      ),
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', gap: 'var(--space-s2)', marginTop: 'var(--space-s3)', flexWrap: 'wrap' } },
      React.createElement(
        'button',
        { type: 'button', disabled: busy, onClick: save },
        'Save key',
      ),
      React.createElement(
        'button',
        { type: 'button', disabled: busy, onClick: testConnection },
        'Test connection',
      ),
      React.createElement(
        'button',
        { type: 'button', disabled: busy, onClick: showRef },
        'Show handle',
      ),
      React.createElement(
        'button',
        { type: 'button', disabled: busy, onClick: remove },
        'Delete key',
      ),
      React.createElement(
        'button',
        { type: 'button', disabled: busy, onClick: refresh },
        'Refresh list',
      ),
    ),
    React.createElement(
      'p',
      { role: 'status', style: { color: 'var(--text-secondary)', fontSize: 'var(--text-t13)', marginTop: 'var(--space-s3)' } },
      status,
    ),
    rows !== null &&
      React.createElement(
        'ul',
        { style: { fontSize: 'var(--text-t13)', marginTop: 'var(--space-s2)' } },
        rows.map((r) =>
          React.createElement(
            'li',
            { key: r.provider },
            `${r.provider}: ${r.has_key ? 'stored' : 'not set'} — handle ${r.ref}`,
          ),
        ),
      ),
  );
}
