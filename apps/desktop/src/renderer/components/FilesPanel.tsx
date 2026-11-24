// FilesPanel: read-only filesystem tool in the deck — the full chain in one
// view: manifest (packages/protocol) -> capability gate -> sandboxed spawn
// -> approval card on first grant -> audit chain -> result rendered here.
//
// Flow: List invokes fs.list with the cached grant. A missing grant (-32001)
// files an approval.request and shows the shared ApprovalCard; approving
// calls approval.decide, caches the token, and retries automatically.
// Deny, expiry, timeouts, and NOT_IMPLEMENTED (-32002) all render honestly;
// every terminal outcome is audited server-side. Directory display favors
// the basename; the full scope stays visible because hiding the read path
// would be a security anti-pattern (and the GIF fixture root is synthetic).
import React from 'react';
import { FS_LIST_METHOD, FS_READ_METHOD } from '../../../../../packages/protocol/src/manifest.js';
import type { FsEntry, FsListResult, FsReadResult } from '../../../../../packages/protocol/src/types.js';
import {
  approve as approveCard,
  createApproval,
  deny as denyCard,
  editScope as editCardScope,
  tick as tickCard,
  type ApprovalCardState,
} from '../../../../../packages/ui/src/approvals/approval.js';
import { ApprovalCard } from '../../../../../packages/ui/src/approvals/ApprovalCard.js';
import { DegradedState, EmptyState, ErrorState } from './states.js';

const APPROVAL_TTL_SECS = 120;

export interface FilesInvoke {
  (method: string, params?: unknown): Promise<unknown>;
}

interface FilesPanelProps {
  invoke: FilesInvoke;
  initialScope: string;
}

type Phase =
  | { name: 'idle' }
  | { name: 'listing' }
  | { name: 'reading'; path: string }
  | { name: 'approval'; op: 'list' | 'read'; rel: string }
  | { name: 'error'; message: string }
  | { name: 'unavailable'; message: string };

interface Grant {
  token: string;
  scope: string;
}

function basename(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, '');
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return i < 0 ? trimmed : trimmed.slice(i + 1);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

function daemonMessage(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) {
    // Electron wraps daemon failures ("Error invoking remote method
    // '<bridge>:invoke': Error: daemon error <code>: <message>"), so match the
    // inner daemon error anywhere, not just at the start.
    const m = e.message.match(/daemon error (-?\d+): (.+)/);
    if (m) return m[2];
    return e.message;
  }
  return 'unknown error';
}

function daemonCode(e: unknown): number | null {
  const text = typeof e === 'string' ? e : e instanceof Error ? e.message : '';
  const m = text.match(/daemon error (-?\d+)/);
  if (m) return Number(m[1]);
  return null;
}

export function FilesPanel(props: FilesPanelProps): React.JSX.Element {
  const [scopeInput, setScopeInput] = React.useState(props.initialScope);
  const [scope, setScope] = React.useState<string | null>(props.initialScope || null);
  const [rel, setRel] = React.useState('.');
  const [entries, setEntries] = React.useState<FsEntry[] | null>(null);
  const [truncated, setTruncated] = React.useState(false);
  const [reading, setReading] = React.useState<{ path: string; result: FsReadResult } | null>(null);
  const [phase, setPhase] = React.useState<Phase>({ name: 'idle' });
  const [grants, setGrants] = React.useState<Record<string, Grant>>({});
  const [card, setCard] = React.useState<ApprovalCardState | null>(null);
  const [now, setNow] = React.useState(() => Date.now() / 1000);
  const [pendingOp, setPendingOp] = React.useState<{ op: 'list' | 'read'; rel: string } | null>(null);

  React.useEffect(() => {
    if (!card) return undefined;
    const t = setInterval(() => setNow(Date.now() / 1000), 500);
    return () => clearInterval(t);
  }, [card !== null]);

  const callFs = React.useCallback(
    async (method: 'fs.list' | 'fs.read', dir: string, relPath: string, token: string | null): Promise<unknown> => {
      // Omit a missing token entirely: the daemon reports `missing`, which
      // the panel maps to the first-grant approval card.
      const params =
        token === null ? { scope: dir, path: relPath } : { scope: dir, path: relPath, capability: token };
      return props.invoke(method, params);
    },
    [props.invoke],
  );

  const startApproval = React.useCallback(
    async (tool: string, dir: string, op: 'list' | 'read', relPath: string) => {
      const reason = tool === FS_LIST_METHOD ? 'Read-only listing of the chosen directory' : 'Read-only read of a file in the chosen directory';
      const filed = (await props.invoke('approval.request', {
        tool,
        scope: dir,
        reason,
        ttl_secs: APPROVAL_TTL_SECS,
      })) as { request_id?: string; expires_at?: string };
      if (typeof filed?.request_id !== 'string') throw new Error('approval.request failed');
      const nowSecs = Date.now() / 1000;
      setCard(
        createApproval(
          { tool, scope: dir, reason, ttlSecs: APPROVAL_TTL_SECS },
          nowSecs,
          filed.request_id,
        ),
      );
      setPendingOp({ op, rel: relPath });
      setPhase({ name: 'approval', op, rel: relPath });
    },
    [props.invoke],
  );

  const handleFsError = async (
    e: unknown,
    method: 'fs.list' | 'fs.read',
    dir: string,
    token: string | null,
    op: 'list' | 'read',
    relPath: string,
  ): Promise<void> => {
    const code = daemonCode(e);
    if (code === -32001) {
      if (token !== null) {
        // Stale grant (narrowed or expired): forget it so the next attempt
        // asks again instead of error-looping on the same token.
        const key = `${method}:${dir}`;
        setGrants((g) => {
          const next = { ...g };
          delete next[key];
          return next;
        });
      }
      await startApproval(method, dir, op, relPath).catch((e2: unknown) => {
        setPhase({ name: 'error', message: `Approval request failed: ${daemonMessage(e2)}` });
      });
      return;
    }
    if (code === -32002) {
      setPhase({ name: 'unavailable', message: daemonMessage(e) });
      return;
    }
    setPhase({ name: 'error', message: daemonMessage(e) });
  };

  const runList = async (dir: string, relPath: string, token: string | null): Promise<void> => {
    setPhase({ name: 'listing' });
    setReading(null);
    try {
      const res = (await callFs(FS_LIST_METHOD, dir, relPath, token ?? '')) as FsListResult;
      if (!isRecord(res) || !Array.isArray(res['entries'])) throw new Error('malformed fs.list result');
      setEntries(res['entries'] as FsEntry[]);
      setTruncated(res['truncated'] === true);
      setScope(dir);
      setRel(relPath);
      setPhase({ name: 'idle' });
    } catch (e) {
      await handleFsError(e, FS_LIST_METHOD, dir, token, 'list', relPath);
    }
  };

  const runRead = async (dir: string, relPath: string, token: string | null): Promise<void> => {
    setPhase({ name: 'reading', path: relPath });
    try {
      const res = (await callFs(FS_READ_METHOD, dir, relPath, token ?? '')) as FsReadResult;
      if (!isRecord(res) || typeof res['content'] !== 'string') throw new Error('malformed fs.read result');
      setReading({ path: relPath, result: res });
      setPhase({ name: 'idle' });
    } catch (e) {
      await handleFsError(e, FS_READ_METHOD, dir, token, 'read', relPath);
    }
  };

  const onListClick = () => {
    const dir = scopeInput.trim();
    if (!dir) {
      setPhase({ name: 'error', message: 'Enter a directory first.' });
      return;
    }
    const g = grants[`${FS_LIST_METHOD}:${dir}`];
    void runList(dir, '.', g ? g.token : null);
  };

  const onApproveCard = () => {
    // The card carries everything the decision needs (request id, tool,
    // effective scope): never gate on local state that lags the first
    // grant, or the very first approval silently no-ops.
    if (!card || !pendingOp) return;
    const next = approveCard(card, Date.now() / 1000, 'deck');
    setCard(next);
    const decided = props
      .invoke('approval.decide', {
        request_id: card.request.id,
        decision: 'approve',
        scope: next.effectiveScope,
        decided_by: 'deck',
        note: '',
      })
      .then((v) => v as { approved?: boolean; token?: string; decision?: string });
    void decided.then(
      (d) => {
        if (d && d.approved === true && typeof d.token === 'string') {
          const tool = card.request.tool;
          const effScope = next.effectiveScope;
          setGrants((g) => ({ ...g, [`${tool}:${effScope}`]: { token: d.token as string, scope: effScope } }));
          setCard(null);
          if (pendingOp.op === 'list') void runList(effScope, pendingOp.rel, d.token);
          else void runRead(effScope, pendingOp.rel, d.token);
          setPendingOp(null);
        } else {
          setPhase({ name: 'error', message: `Approval was not granted (${String(d?.decision ?? 'unknown')}).` });
          setCard(null);
          setPendingOp(null);
        }
      },
      (e: unknown) => {
        setPhase({ name: 'error', message: `Approval failed: ${daemonMessage(e)}` });
        setCard(null);
        setPendingOp(null);
      },
    );
  };

  const onDenyCard = () => {
    if (!card) return;
    const next = denyCard(card, Date.now() / 1000, 'deck');
    setCard(next);
    void props
      .invoke('approval.decide', {
        request_id: card.request.id,
        decision: 'deny',
        decided_by: 'deck',
        note: '',
      })
      .catch(() => {
        /* the countdown default-denies server-side; the card already shows denied */
      });
    setPendingOp(null);
  };

  const onEditCard = (editedScope: string) => {
    setCard((s) => {
      if (!s) return s;
      try {
        return editCardScope(s, editedScope, Date.now() / 1000);
      } catch {
        // Widening edits are rejected by the state machine; the card
        // surfaces its own edit error, so the narrowed draft is kept.
        return s;
      }
    });
  };

  const rows: React.ReactNode = entries
    ? entries.map((e) => {
        const full = rel === '.' ? e.name : `${rel}/${e.name}`;
        const isDir = e.kind === 'dir';
        return React.createElement(
          'li',
          { key: e.name, style: { listStyle: 'none', margin: 0 } },
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: () => {
                if (!scope) return;
                if (isDir) {
                  const g = grants[`${FS_LIST_METHOD}:${scope}`];
                  void runList(scope, full, g ? g.token : null);
                } else {
                  const g = grants[`${FS_READ_METHOD}:${scope}`];
                  void runRead(scope, full, g ? g.token : null);
                }
              },
              style: {
                display: 'flex',
                width: '100%',
                textAlign: 'left',
                backgroundColor: 'transparent',
                color: 'var(--text-primary)',
                border: 'none',
                borderRadius: 'var(--radius-r8)',
                padding: 'var(--space-s1) var(--space-s2)',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-t13)',
              },
            },
            `${isDir ? 'dir' : e.kind}  ${e.name}`,
          ),
        );
      })
    : null;

  return React.createElement(
    'section',
    { 'aria-label': 'Read-only files', style: { marginTop: 'var(--space-s6)' } },
    React.createElement(
      'h2',
      { style: { fontFamily: 'var(--font-display)', fontSize: 'var(--text-t20)', margin: '0 0 var(--space-s2)' } },
      'Files (read-only)',
    ),
    React.createElement(
      'p',
      { style: { color: 'var(--text-secondary)', fontSize: 'var(--text-t13)', margin: '0 0 var(--space-s3)' } },
      'List and read files inside one directory you choose. Every call is capability-gated, sandboxed, and audited; the first grant asks first.',
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', gap: 'var(--space-s2)', marginBottom: 'var(--space-s3)' } },
      React.createElement('input', {
        'aria-label': 'Directory to list',
        value: scopeInput,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setScopeInput(e.target.value),
        placeholder: '/path/to/directory',
        spellCheck: false,
        style: {
          flex: 1,
          backgroundColor: 'var(--surface-overlay)',
          color: 'var(--text-primary)',
          border: '1px solid var(--text-secondary)',
          borderRadius: 'var(--radius-r8)',
          padding: 'var(--space-s2) var(--space-s3)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-t13)',
        },
      }),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: onListClick,
          style: {
            backgroundColor: 'var(--brass-primary)',
            color: 'var(--surface-void)',
            border: 'none',
            borderRadius: 'var(--radius-r8)',
            padding: 'var(--space-s2) var(--space-s4)',
            cursor: 'pointer',
            fontSize: 'var(--text-t14)',
          },
        },
        'List files',
      ),
    ),
    scope &&
      React.createElement(
        'p',
        { style: { color: 'var(--text-secondary)', fontSize: 'var(--text-t13)', margin: '0 0 var(--space-s2)' } },
        `Scope ${basename(scope)}`,
        truncated ? ' — list truncated at 10,000 entries' : '',
      ),
    phase.name === 'listing' && React.createElement(EmptyState, { title: 'Listing…', body: 'Sandboxed read in progress.' }),
    phase.name === 'reading' &&
      React.createElement(EmptyState, { title: 'Reading…', body: `Sandboxed read of ${(phase as { path: string }).path} in progress.` }),
    phase.name === 'error' &&
      React.createElement(ErrorState, {
        title: 'File tool failed',
        cause: (phase as { message: string }).message,
        fix: 'Grants expire; listing again re-asks through the approval card.',
        actionLabel: 'Dismiss',
        onAction: () => setPhase({ name: 'idle' }),
      }),
    phase.name === 'unavailable' &&
      React.createElement(DegradedState, {
        body: `Sandbox unavailable here: ${(phase as { message: string }).message}. The gate held — nothing ran unsandboxed, and the refusal is in the audit log.`,
        actionLabel: 'Dismiss',
        onAction: () => setPhase({ name: 'idle' }),
      }),
    card && phase.name === 'approval'
      ? React.createElement(
          'div',
          { 'data-testid': 'files-approval' },
          React.createElement(ApprovalCard, {
            state: card,
            now,
            onApprove: onApproveCard,
            onDeny: onDenyCard,
            onEdit: onEditCard,
            onDismiss: () => {
              setCard(null);
              setPendingOp(null);
              setPhase({ name: 'idle' });
            },
          }),
        )
      : null,
    entries &&
      React.createElement(
        'ul',
        { style: { margin: 'var(--space-s2) 0 0', padding: 0 } },
        rows,
        rel !== '.' &&
          React.createElement(
            'li',
            { key: '..', style: { listStyle: 'none' } },
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: () => {
                  if (!scope) return;
                  const parent = rel.split('/').slice(0, -1).join('/') || '.';
                  const g = grants[`${FS_LIST_METHOD}:${scope}`];
                  void runList(scope, parent, g ? g.token : null);
                },
                style: {
                  background: 'none',
                  border: 'none',
                  color: 'var(--brass-primary)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-t13)',
                  padding: 'var(--space-s1) var(--space-s2)',
                },
              },
              'Up one level',
            ),
          ),
      ),
    reading &&
      React.createElement(
        'div',
        {
          style: {
            marginTop: 'var(--space-s4)',
            backgroundColor: 'var(--surface-raised)',
            borderRadius: 'var(--radius-r12)',
            padding: 'var(--space-s4)',
          },
        },
        React.createElement(
          'p',
          { style: { color: 'var(--text-primary)', fontSize: 'var(--text-t14)', margin: '0 0 var(--space-s2)', fontFamily: 'var(--font-mono)' } },
          `${reading.path} — ${reading.result.size} bytes${reading.result.truncated ? ' (truncated)' : ''}${reading.result.encoding === 'base64' ? ' (binary, base64)' : ''}`,
        ),
        reading.result.encoding === 'utf8'
          ? React.createElement(
              'pre',
              {
                style: {
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--text-t13)',
                  fontFamily: 'var(--font-mono)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: '320px',
                  overflow: 'auto',
                  margin: 0,
                },
              },
              reading.result.content,
            )
          : React.createElement(
              'p',
              { style: { color: 'var(--text-secondary)', fontSize: 'var(--text-t13)', margin: 0 } },
              'Binary content is not rendered as text; the audited size above is the whole story.',
            ),
      ),
  );
}
