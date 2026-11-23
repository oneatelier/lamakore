// Approval state machine (wire/1 approval.request deck).
// Pure logic only — no DOM, no crypto, no hex. Colors live in CSS vars.
// Mirrors crates/cored/src/capability.rs scope rules so the deck and the
// daemon agree on what "narrow" means.
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'edited';

export interface ApprovalRequest {
  id: string;
  tool: string;
  scope: string;
  reason: string;
  ttlSecs: number;
  requestedAt: number;
  expiresAt: number;
}

export interface ApprovalCardState {
  request: ApprovalRequest;
  status: ApprovalStatus;
  /** Scope the decision actually covers (narrowed on edit). */
  effectiveScope: string;
  decidedAt?: number;
  decidedBy?: string;
  /** True once an edit narrowed the scope (persists across approve). */
  wasEdited: boolean;
}

export interface ApprovalInput {
  tool: string;
  scope: string;
  reason: string;
  ttlSecs: number;
}

export type KeyAction = 'approve' | 'deny' | 'edit' | 'dismiss';

const ID_PREFIX = 'apr';

/** A path prefix covers a resource when equal or on a `/` boundary. */
export function scopeCovers(granted: string, path: string): boolean {
  const g = granted.replace(/\/+$/, '');
  if (g === '') {
    return granted !== '';
  }
  if (path === granted || path === g) return true;
  return path.startsWith(g) && path.charAt(g.length) === '/';
}

/** Narrowing or equal only — widening must go through revoke + re-grant. */
export function scopeNarrowsOrEqual(oldScope: string, newScope: string): boolean {
  return oldScope === newScope || scopeCovers(oldScope, newScope);
}

export function createApproval(input: ApprovalInput, now: number, id?: string): ApprovalCardState {
  if (!input.tool) throw new Error('tool is empty');
  if (input.ttlSecs < 1) throw new Error('ttlSecs must be >= 1');
  const rid = id ?? `${ID_PREFIX}-${now}-${Math.floor(Math.random() * 1e6)}`;
  const req: ApprovalRequest = {
    id: rid,
    tool: input.tool,
    scope: input.scope,
    reason: input.reason,
    ttlSecs: input.ttlSecs,
    requestedAt: now,
    expiresAt: now + input.ttlSecs,
  };
  return { request: req, status: 'pending', effectiveScope: input.scope, wasEdited: false };
}

export function remainingSecs(state: ApprovalCardState, now: number): number {
  return Math.max(0, state.request.expiresAt - now);
}

export function isExpired(state: ApprovalCardState, now: number): boolean {
  return now >= state.request.expiresAt;
}

/** Countdown expiry -> DEFAULT DENY (expired). Pure; caller persists deny. */
export function tick(state: ApprovalCardState, now: number): ApprovalCardState {
  if ((state.status === 'pending' || state.status === 'edited') && isExpired(state, now)) {
    return { ...state, status: 'expired', decidedAt: now, decidedBy: 'countdown' };
  }
  return state;
}

export function approve(
  state: ApprovalCardState,
  now: number,
  by = 'deck',
): ApprovalCardState {
  const cur = tick(state, now);
  if (cur.status === 'expired') return cur;
  if (cur.status !== 'pending' && cur.status !== 'edited') return cur;
  return { ...cur, status: 'approved', decidedAt: now, decidedBy: by };
}

export function deny(state: ApprovalCardState, now: number, by = 'deck'): ApprovalCardState {
  const cur = tick(state, now);
  if (cur.status === 'expired') return cur;
  if (cur.status !== 'pending' && cur.status !== 'edited') return cur;
  return { ...cur, status: 'denied', decidedAt: now, decidedBy: by };
}

/** Edit may only narrow scope. Returns `edited` with the narrowed scope. */
export function editScope(
  state: ApprovalCardState,
  newScope: string,
  now: number,
): ApprovalCardState {
  const cur = tick(state, now);
  if (cur.status === 'expired') return cur;
  if (cur.status !== 'pending' && cur.status !== 'edited') {
    throw new Error(`cannot edit from ${cur.status}`);
  }
  const base = cur.effectiveScope;
  if (!scopeNarrowsOrEqual(base, newScope)) {
    throw new Error('scope edit must narrow, not widen');
  }
  return { ...cur, status: 'edited', effectiveScope: newScope, wasEdited: true };
}

/**
 * Keyboard map — every state has a keyboard path (STOP otherwise).
 * pending/edited: A approve · D deny · E edit-scope.
 * approved/denied/expired: Enter/Escape dismiss (acknowledge).
 */
export function keyActionFor(key: string, status: ApprovalStatus): KeyAction | null {
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (status === 'pending' || status === 'edited') {
    if (k === 'a') return 'approve';
    if (k === 'd') return 'deny';
    if (k === 'e') return 'edit';
    return null;
  }
  if (k === 'Enter' || k === 'Escape' || k === ' ') return 'dismiss';
  // Terminal states also accept their own letter as dismiss so no dead end.
  if (k === 'a' || k === 'd' || k === 'e') return 'dismiss';
  return null;
}

/** All five states and the keys that drive each (for the STOP gate). */
export const KEYBOARD_PATHS: Record<ApprovalStatus, string[]> = {
  pending: ['a → approve', 'd → deny', 'e → edit-scope'],
  edited: ['a → approve (narrowed)', 'd → deny', 'e → narrow further'],
  approved: ['Enter/Escape → dismiss'],
  denied: ['Enter/Escape → dismiss'],
  expired: ['Enter/Escape → dismiss (default deny)'],
};

export function decisionForWire(state: ApprovalCardState): {
  requestId: string;
  decision: 'approved' | 'denied' | 'expired';
  scope: string;
  tool: string;
  reason: string;
} {
  if (state.status === 'approved' || state.status === 'edited') {
    // edited without explicit approve is still pending — but for wire compat
    // map edited→approved only when decided; caller uses approve() after edit.
    // Here: approved carries narrowed scope.
    return {
      requestId: state.request.id,
      decision: state.status === 'approved' ? 'approved' : 'expired',
      scope: state.effectiveScope,
      tool: state.request.tool,
      reason: state.request.reason,
    };
  }
  if (state.status === 'denied') {
    return {
      requestId: state.request.id,
      decision: 'denied',
      scope: state.effectiveScope,
      tool: state.request.tool,
      reason: state.request.reason,
    };
  }
  return {
    requestId: state.request.id,
    decision: 'expired',
    scope: state.effectiveScope,
    tool: state.request.tool,
    reason: state.request.reason,
  };
}

/** Canonical payload the daemon signs (mirrors Rust canonical_payload). */
export function canonicalApprovalPayload(args: {
  requestId: string;
  tool: string;
  scope: string;
  decision: string;
  decidedAt: number;
}): string {
  return JSON.stringify(args);
}
