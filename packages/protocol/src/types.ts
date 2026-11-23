// Shared TypeScript types for the wire/1 read-only filesystem tool.
// Mirrors crates/cored/src/fs_tool.rs (method names, params, results) and
// crates/core-protocol/src/wire.rs (error codes). The manifest in
// manifest.ts is the single TS-side source of truth; method strings must
// stay identical to the Rust constants (checked by tests/ui/protocol.spec.ts).
// No runtime dependencies; no DOM access.

/** A single directory entry returned by fs.list. */
export interface FsEntry {
  /** File name only (no path separators, no parent components). */
  name: string;
  /** Entry kind as observed (symlinks are never followed by fs.list). */
  kind: 'file' | 'dir' | 'symlink' | 'other';
  /** Metadata length in bytes (meaningless for dirs on some platforms). */
  size: number;
  /** Modification time, epoch seconds. */
  mtime: number;
}

/** Result of fs.list. */
export interface FsListResult {
  entries: FsEntry[];
  /** True when more than LIST_CAP entries existed (stable byte-order cut). */
  truncated: boolean;
}

/** Result of fs.read. */
export interface FsReadResult {
  /** Full file length in bytes (content may be shorter when truncated). */
  size: number;
  /** Content encoding. Binary content arrives base64-wrapped, never mangled. */
  encoding: 'utf8' | 'base64';
  /** File content: text, or base64 when encoding is base64. */
  content: string;
  /** True when the file exceeded READ_CAP and content holds the first bytes. */
  truncated: boolean;
}

/** Wire error codes shared with the daemon (see wire.rs RpcError.code). */
export type FsWireCode = -32001 | -32002 | -32601 | -32602 | -32603;

/** Terminal outcomes of an fs tool call, for tests and the deck. */
export type FsOutcome =
  | { kind: 'ok'; result: FsListResult | FsReadResult }
  | { kind: 'denied'; code: -32001; message: string }
  | { kind: 'not-implemented'; code: -32002; message: string }
  | { kind: 'invalid'; code: -32602; message: string }
  | { kind: 'error'; code: -32603; message: string };
