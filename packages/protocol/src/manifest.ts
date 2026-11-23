// Manifest for the wire/1 read-only filesystem tool (fs.list / fs.read).
// The manifest is the TS-side source of truth for method names, limits,
// params, results, and error codes. Rust owns the enforcement
// (crates/cored/src/fs_tool.rs, crates/core-protocol/src/wire.rs);
// tests/ui/protocol.spec.ts asserts the two sides spell everything the
// same way, so a rename on either side fails loudly instead of silently
// forking the protocol.
// Chain position: manifest -> capability gate -> sandboxed spawn
// (P013/P014) -> approval card on first grant (P015) -> audit chain
// (P016) -> result rendered in the deck.

import type { FsListResult, FsReadResult } from './types.js';

/** Canonical wire method names. Must equal the Rust FS_LIST_METHOD / FS_READ_METHOD. */
export const FS_LIST_METHOD = 'fs.list';
export const FS_READ_METHOD = 'fs.read';

/** Capability tool names presented to the gate. One grant per method. */
export const FS_LIST_TOOL = 'fs.list';
export const FS_READ_TOOL = 'fs.read';

/** Maximum entries returned by a single fs.list call. */
export const LIST_CAP = 10000;

/** Maximum content bytes returned by a single fs.read call. */
export const READ_CAP_BYTES = 1048576;

/** Sandbox spawn + tool timeout budget, milliseconds. */
export const TOOL_TIMEOUT_MS = 30000;

/** Wire error codes (mirror wire.rs RpcError.code). */
export const FS_ERRORS = {
  capabilityDenied: -32001,
  notImplemented: -32002,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

/** JSON-schema-ish params for fs.list (documentation + deck validation). */
export const FS_LIST_PARAMS_SCHEMA = {
  type: 'object',
  required: ['scope', 'capability'],
  properties: {
    /** Absolute scope directory; must be covered by the capability grant. */
    scope: { type: 'string' },
    /** Path relative to scope, default '.'. No absolute paths, no '..'. */
    path: { type: 'string', default: '.' },
    /** Signed capability token minted for fs.list over this scope. */
    capability: { type: 'string' },
  },
} as const;

/** JSON-schema-ish params for fs.read. */
export const FS_READ_PARAMS_SCHEMA = {
  type: 'object',
  required: ['scope', 'path', 'capability'],
  properties: {
    scope: { type: 'string' },
    path: { type: 'string' },
    capability: { type: 'string' },
  },
} as const;

export interface FsMethodDef {
  method: string;
  tool: string;
  requiresCapability: true;
  sandboxed: true;
  approvalOnFirstGrant: true;
  audited: true;
  params: unknown;
  result: 'FsListResult' | 'FsReadResult';
}

/** The tool manifest: every read-only filesystem method the deck may call. */
export const FS_MANIFEST: { methods: FsMethodDef[] } = {
  methods: [
    {
      method: FS_LIST_METHOD,
      tool: FS_LIST_TOOL,
      requiresCapability: true,
      sandboxed: true,
      approvalOnFirstGrant: true,
      audited: true,
      params: FS_LIST_PARAMS_SCHEMA,
      result: 'FsListResult',
    },
    {
      method: FS_READ_METHOD,
      tool: FS_READ_TOOL,
      requiresCapability: true,
      sandboxed: true,
      approvalOnFirstGrant: true,
      audited: true,
      params: FS_READ_PARAMS_SCHEMA,
      result: 'FsReadResult',
    },
  ],
};

export type { FsListResult, FsReadResult };
