// ApprovalCard: wire/1 approval.request deck card using P007 tokens only.
// Keyboard-first: A approve · D deny · E edit-scope. Deny is exactly as
// prominent as approve (shared ACTION_BTN style object — same metrics).
// Countdown expiry renders expired (DEFAULT DENY). No raw hex anywhere.
import React from 'react';
import {
  approve as approveState,
  deny as denyState,
  editScope as editScopeState,
  keyActionFor,
  remainingSecs,
  tick,
  type ApprovalCardState,
} from './approval.js';

export const ACTION_BTN: React.CSSProperties = {
  flex: 1,
  minHeight: '44px',
  padding: 'var(--space-s3) var(--space-s4)',
  fontSize: 'var(--text-t16)',
  fontWeight: 600,
  borderRadius: 'var(--radius-r8)',
  border: '1px solid var(--text-secondary)',
  backgroundColor: 'var(--surface-overlay)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
};

const EDIT_BTN: React.CSSProperties = {
  minHeight: '44px',
  padding: 'var(--space-s3) var(--space-s4)',
  fontSize: 'var(--text-t14)',
  fontWeight: 600,
  borderRadius: 'var(--radius-r8)',
  border: '1px solid var(--text-secondary)',
  backgroundColor: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
};

const STATUS_DOT: Record<string, string> = {
  pending: 'var(--signal-info)',
  approved: 'var(--signal-success)',
  denied: 'var(--signal-danger)',
  expired: 'var(--signal-warning)',
  edited: 'var(--signal-info)',
};

export function ApprovalCard(props: {
  state: ApprovalCardState;
  now: number;
  sig?: string;
  onApprove: () => void;
  onDeny: () => void;
  onEdit: (scope: string) => void;
  onDismiss?: () => void;
}): React.JSX.Element {
  const { state, now, sig } = props;
  const live = tick(state, now);
  const remaining = remainingSecs(live, now);
  const total = Math.max(1, live.request.ttlSecs);
  const pct = Math.max(0, Math.min(1, remaining / total));
  const [draft, setDraft] = React.useState(live.effectiveScope);
  const [editing, setEditing] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);
  const dismissRef = React.useRef<HTMLButtonElement | null>(null);
  const editRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    setDraft(live.effectiveScope);
  }, [live.effectiveScope]);

  React.useEffect(() => {
    if (live.status === 'approved' || live.status === 'denied' || live.status === 'expired') {
      dismissRef.current?.focus();
    }
  }, [live.status]);

  React.useEffect(() => {
    if (!editing) return;
    editRef.current?.focus();
    editRef.current?.select();
  }, [editing]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && !editing
          ? false
          : target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      // While typing a scope, only Enter (commit) and Escape (cancel) apply.
      if (typing && editing) {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitEdit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setEditing(false);
          setEditError(null);
          setDraft(live.effectiveScope);
        }
        return;
      }
      const action = keyActionFor(e.key, live.status);
      if (!action) return;
      if (action === 'approve') {
        e.preventDefault();
        props.onApprove();
      } else if (action === 'deny') {
        e.preventDefault();
        props.onDeny();
      } else if (action === 'edit') {
        e.preventDefault();
        setEditing(true);
      } else if (action === 'dismiss') {
        e.preventDefault();
        props.onDismiss?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.status, live.effectiveScope, draft, editing]);

  const commitEdit = () => {
    try {
      const next = editScopeState(live, draft.trim(), now);
      void next;
      setEditError(null);
      setEditing(false);
      props.onEdit(draft.trim());
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'edit rejected');
    }
  };

  const terminal = live.status === 'approved' || live.status === 'denied' || live.status === 'expired';

  return React.createElement(
    'div',
    {
      role: 'dialog',
      'aria-modal': 'false',
      'aria-labelledby': `approval-title-${live.request.id}`,
      'aria-live': 'polite',
      'data-status': live.status,
      'data-testid': `approval-card-${live.status}`,
      style: {
        backgroundColor: 'var(--surface-raised)',
        color: 'var(--text-primary)',
        borderRadius: 'var(--radius-r12)',
        padding: 'var(--space-s6)',
        maxWidth: '560px',
        width: '100%',
        boxShadow: 'var(--elevation-e2-shadow), var(--elevation-e2-inner)',
        fontFamily: 'var(--font-ui)',
      },
    },
    React.createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-s3)', marginBottom: 'var(--space-s3)' } },
      React.createElement('span', {
        'aria-hidden': true,
        style: {
          width: '10px',
          height: '10px',
          borderRadius: '999px',
          backgroundColor: STATUS_DOT[live.status],
          display: 'inline-block',
        },
      }),
      React.createElement(
        'h2',
        {
          id: `approval-title-${live.request.id}`,
          style: { fontFamily: 'var(--font-display)', fontSize: 'var(--text-t20)', margin: 0 },
        },
        live.status === 'pending'
          ? 'Approval requested'
          : live.status === 'edited'
            ? 'Scope narrowed — confirm'
            : live.status === 'approved'
              ? 'Approved'
              : live.status === 'denied'
                ? 'Denied'
                : 'Expired — default deny',
      ),
      React.createElement(
        'span',
        {
          style: {
            marginLeft: 'auto',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-t12)',
            color: 'var(--text-secondary)',
          },
        },
        live.request.id,
      ),
    ),
    React.createElement(
      'dl',
      {
        style: {
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: 'var(--space-s2) var(--space-s4)',
          margin: '0 0 var(--space-s4)',
          fontSize: 'var(--text-t14)',
        },
      },
      React.createElement('dt', { style: { color: 'var(--text-secondary)' } }, 'Tool'),
      React.createElement(
        'dd',
        { style: { margin: 0, fontFamily: 'var(--font-mono)' }, 'data-testid': 'approval-tool' },
        live.request.tool,
      ),
      React.createElement('dt', { style: { color: 'var(--text-secondary)' } }, 'Scope'),
      React.createElement(
        'dd',
        { style: { margin: 0, fontFamily: 'var(--font-mono)' }, 'data-testid': 'approval-scope' },
        live.effectiveScope,
        live.wasEdited
          ? React.createElement(
              'span',
              {
                style: {
                  marginLeft: 'var(--space-s2)',
                  fontSize: 'var(--text-t12)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--text-secondary)',
                  borderRadius: 'var(--radius-full)',
                  padding: '0 var(--space-s2)',
                },
              },
              'narrowed',
            )
          : null,
      ),
      React.createElement('dt', { style: { color: 'var(--text-secondary)' } }, 'Reason'),
      React.createElement(
        'dd',
        { style: { margin: 0, color: 'var(--text-secondary)' }, 'data-testid': 'approval-reason' },
        live.request.reason || 'No reason given.',
      ),
    ),
    !terminal &&
      React.createElement(
        'div',
        { style: { marginBottom: 'var(--space-s4)' } },
        React.createElement(
          'div',
          {
            role: 'timer',
            'aria-label': `${remaining} seconds left`,
            'data-testid': 'approval-countdown',
            style: { color: 'var(--text-secondary)', fontSize: 'var(--text-t13)', marginBottom: 'var(--space-s2)' },
          },
          `Expires in ${remaining}s of ${total}s — expiry denies by default.`,
        ),
        React.createElement(
          'div',
          {
            role: 'progressbar',
            'aria-valuenow': remaining,
            'aria-valuemin': 0,
            'aria-valuemax': total,
            style: {
              height: '8px',
              borderRadius: 'var(--radius-full)',
              backgroundColor: 'var(--surface-overlay)',
              overflow: 'hidden',
            },
          },
          React.createElement('div', {
            style: {
              height: '100%',
              width: `${pct * 100}%`,
              backgroundColor: 'var(--brass-primary)',
            },
          }),
        ),
      ),
    terminal &&
      React.createElement(
        'p',
        {
          role: 'status',
          'data-testid': 'approval-result',
          style: { color: 'var(--text-secondary)', fontSize: 'var(--text-t14)', margin: '0 0 var(--space-s4)' },
        },
        live.status === 'approved'
          ? `Allowed ${live.effectiveScope} — signed token issued${sig ? ` · sig ${sig.slice(0, 12)}…` : ''}.`
          : live.status === 'denied'
            ? 'Denied — the tool call is refused with CAPABILITY_DENIED.'
            : 'Countdown reached zero — default deny applied and audited.',
      ),
    !terminal &&
      React.createElement(
        'div',
        { style: { display: 'flex', gap: 'var(--space-s3)' } },
        React.createElement(
          'button',
          {
            type: 'button',
            'data-action': 'approve',
            'data-testid': 'approval-approve',
            'aria-keyshortcuts': 'a',
            onClick: props.onApprove,
            style: ACTION_BTN,
          },
          'Approve (A)',
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            'data-action': 'deny',
            'data-testid': 'approval-deny',
            'aria-keyshortcuts': 'd',
            onClick: props.onDeny,
            style: ACTION_BTN,
          },
          'Deny (D)',
        ),
      ),
    !terminal &&
      React.createElement(
        'div',
        { style: { marginTop: 'var(--space-s3)', display: 'flex', gap: 'var(--space-s3)', alignItems: 'center' } },
        !editing &&
          React.createElement(
            'button',
            {
              type: 'button',
              'data-action': 'edit',
              'data-testid': 'approval-edit',
              'aria-keyshortcuts': 'e',
              onClick: () => setEditing(true),
              style: EDIT_BTN,
            },
            'Edit scope (E)',
          ),
        editing &&
          React.createElement(
            'div',
            { style: { display: 'flex', gap: 'var(--space-s2)', flex: 1, alignItems: 'center' } },
            React.createElement('input', {
              ref: editRef,
              value: draft,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
              'aria-label': 'Narrowed scope',
              'data-testid': 'approval-scope-input',
              style: {
                flex: 1,
                backgroundColor: 'var(--surface-overlay)',
                color: 'var(--text-primary)',
                borderRadius: 'var(--radius-r8)',
                border: '1px solid var(--text-secondary)',
                padding: 'var(--space-s2) var(--space-s3)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-t14)',
              },
            }),
            React.createElement(
              'button',
              { type: 'button', onClick: commitEdit, 'data-testid': 'approval-scope-save', style: EDIT_BTN },
              'Narrow',
            ),
          ),
      ),
    !terminal &&
      editing &&
      editError &&
      React.createElement(
        'p',
        { role: 'alert', style: { color: 'var(--signal-danger)', fontSize: 'var(--text-t13)' } },
        editError,
      ),
    !terminal &&
      editing &&
      React.createElement(
        'p',
        { style: { color: 'var(--text-secondary)', fontSize: 'var(--text-t12)', marginBottom: 0 } },
        'Edits may only narrow scope — widening is rejected. Enter commits, Escape cancels.',
      ),
    terminal &&
      React.createElement(
        'div',
        { style: { display: 'flex', gap: 'var(--space-s3)' } },
        React.createElement(
          'button',
          {
            ref: dismissRef,
            type: 'button',
            'data-action': 'dismiss',
            'data-testid': 'approval-dismiss',
            onClick: props.onDismiss,
            style: ACTION_BTN,
          },
          'Dismiss (Enter)',
        ),
      ),
    React.createElement(
      'p',
      { style: { color: 'var(--text-secondary)', fontSize: 'var(--text-t12)', margin: 'var(--space-s4) 0 0' } },
      live.status === 'pending' || live.status === 'edited'
        ? 'Keyboard: A approve · D deny · E edit-scope. Deny is as prominent as approve.'
        : 'Keyboard: Enter or Escape dismisses. Every state has a keyboard path.',
    ),
  );
}

export function ApprovalDemo(props: { initial: ApprovalCardState }): React.JSX.Element {
  const [state, setState] = React.useState<ApprovalCardState>(props.initial);
  const [sig] = React.useState('sig-demo-0123456789abcdef');
  const [now, setNow] = React.useState<number>(() => Date.now() / 1000);
  React.useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now() / 1000);
      setState((s) => tick(s, Date.now() / 1000));
    }, 500);
    return () => clearInterval(t);
  }, []);
  return React.createElement(ApprovalCard, {
    state,
    now,
    sig: state.status === 'approved' ? sig : undefined,
    onApprove: () => setState((s) => approveState(s, Date.now() / 1000)),
    onDeny: () => setState((s) => denyState(s, Date.now() / 1000)),
    onEdit: (scope: string) =>
      setState((s) => {
        try {
          return editScopeState(s, scope, Date.now() / 1000);
        } catch {
          return s;
        }
      }),
    onDismiss: () => undefined,
  });
}
