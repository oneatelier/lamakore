// Manifest for the wire/1 provider-secret methods (secret.set / list /
// delete / ref / test). The manifest is the TS-side source of truth for
// method names and params. Rust owns the enforcement
// (crates/cored/src/secret_tool.rs, crates/core-protocol/src/wire.rs,
// crates/vault); tests/ui/secrets.spec.ts asserts the two sides spell
// everything the same way, so a rename on either side fails loudly.
//
// Privacy contract: plaintext NEVER crosses the wire to the deck. The deck
// sends plaintext once (secret.set, explicit save); every daemon response
// carries metadata or an opaque handle (vault:v1:<provider>) only.

/** Canonical wire method names. Must equal the Rust SECRET_*_METHOD. */
export const SECRET_SET_METHOD = 'secret.set';
export const SECRET_LIST_METHOD = 'secret.list';
export const SECRET_DELETE_METHOD = 'secret.delete';
export const SECRET_REF_METHOD = 'secret.ref';
export const SECRET_TEST_METHOD = 'secret.test';

/** Providers the deck may select. Must equal vault::SUPPORTED_PROVIDERS. */
export const SUPPORTED_PROVIDERS = ['openai', 'anthropic', 'openrouter'] as const;

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

export function isSupportedProvider(p: string): p is SupportedProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(p);
}

/** Wire error codes (mirror wire.rs RpcError.code). */
export const SECRET_ERRORS = {
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export interface SecretProviderRow {
  provider: string;
  has_key: boolean;
  ref: string;
}

export interface SecretSetResult {
  ref: string;
  provider: string;
}

export interface SecretRefResult {
  ref: string;
  provider: string;
}

export interface SecretTestResult {
  ok: boolean;
  reason: string;
  ref?: string;
}
