import React from 'react';

/** Empty state: names the void and teaches the single next action. */
export function EmptyState(props: { title: string; body: string; actionLabel?: string; onAction?: () => void }): React.JSX.Element {
  return React.createElement(
    'div',
    { style: { color: 'var(--text-secondary)', fontSize: 'var(--text-t14)' } },
    React.createElement('p', { style: { margin: '0 0 var(--space-s2)' } }, props.title),
    React.createElement('p', { style: { margin: '0 0 var(--space-s3)' } }, props.body),
    props.actionLabel && props.onAction
      ? React.createElement(
          'button',
          {
            type: 'button',
            onClick: props.onAction,
            style: {
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'var(--brass-primary)',
              cursor: 'pointer',
              fontSize: 'var(--text-t14)',
              textDecoration: 'underline',
            },
          },
          props.actionLabel,
        )
      : null,
  );
}

/** Error state: cause, fix, retry. Never a dead end. */
export function ErrorState(props: { title: string; cause: string; fix: string; actionLabel: string; onAction: () => void }): React.JSX.Element {
  return React.createElement(
    'div',
    {
      role: 'alert',
      style: {
        backgroundColor: 'var(--surface-raised)',
        borderRadius: 'var(--radius-r12)',
        padding: 'var(--space-s6)',
      },
    },
    React.createElement(
      'h1',
      { style: { fontFamily: 'var(--font-display)', fontSize: 'var(--text-t26)', margin: '0 0 var(--space-s2)' } },
      props.title,
    ),
    React.createElement('p', { style: { color: 'var(--text-secondary)', fontSize: 'var(--text-t14)', margin: '0 0 var(--space-s1)' } }, props.cause),
    React.createElement('p', { style: { color: 'var(--text-secondary)', fontSize: 'var(--text-t14)', margin: `0 0 var(--space-s4)` } }, props.fix),
    React.createElement(
      'button',
      {
        type: 'button',
        onClick: props.onAction,
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
      props.actionLabel,
    ),
  );
}

/** Loading state: names what is happening, never spins forever silently. */
export function LoadingState(props: { label: string }): React.JSX.Element {
  return React.createElement(
    'div',
    { role: 'status', style: { color: 'var(--text-secondary)', fontSize: 'var(--text-t16)' } },
    props.label,
  );
}

/** Degraded state: honest banner — what is wrong, what still works, retry. */
export function DegradedState(props: { body: string; actionLabel: string; onAction: () => void }): React.JSX.Element {
  return React.createElement(
    'div',
    {
      role: 'alert',
      style: {
        backgroundColor: 'var(--surface-raised)',
        borderRadius: 'var(--radius-r12)',
        padding: 'var(--space-s4)',
      },
    },
    React.createElement(
      'p',
      { style: { color: 'var(--text-primary)', fontSize: 'var(--text-t14)', margin: 0 } },
      props.body,
      ' ',
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: props.onAction,
          style: {
            background: 'none',
            border: 'none',
            padding: 0,
            color: 'var(--brass-primary)',
            cursor: 'pointer',
            fontSize: 'var(--text-t14)',
            textDecoration: 'underline',
          },
        },
        props.actionLabel,
      ),
    ),
  );
}
