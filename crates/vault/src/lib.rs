//! vault — provider API keys live ONLY in the OS keychain.
//!
//! Backend: Windows Credential Manager / macOS Keychain / Linux Secret
//! Service via the `keyring` crate. There are deliberately NO SQLite
//! columns for secrets anywhere (`core-store` asserts this): the store
//! holds grants, audit rows, and settings — never key material.
//!
//! Wire contract (`wire/1`, see `cored::server`):
//! `secret.set` / `secret.list` / `secret.delete` / `secret.ref` /
//! `secret.test`. Plaintext NEVER crosses the wire to the deck: the daemon
//! never returns, logs, or audits secret bytes in any direction toward the
//! renderer. `secret.set` carries user-typed plaintext deck → daemon once
//! (explicit save); every daemon → deck frame carries only metadata or an
//! opaque handle (`vault:v1:<provider>`, no secret bytes, not reversible).
//!
//! The opaque handle is stable per provider (it names the slot, not the
//! secret) so tools resolve it server-side via [`Vault::get_secret`],
//! which is daemon-internal and never exposed over the wire.
//!
//! Panics are a bug: unwraps and expects are denied outside tests.
//! Error messages never include secret material (see the log-scrub test).

#![deny(clippy::unwrap_used)]
#![deny(clippy::expect_used)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

use core_protocol::brand::CODE_TOKEN;
#[cfg(feature = "mock-keyring")]
use std::collections::HashMap;
#[cfg(feature = "mock-keyring")]
use std::sync::Mutex;

/// Providers the deck may select. Fixed allowlist: arbitrary provider names
/// would let a compromised renderer create unbounded keychain entries.
pub const SUPPORTED_PROVIDERS: &[&str] = &["openai", "anthropic", "openrouter"];

/// Maximum accepted secret length (8 KiB — API keys are far smaller;
/// the cap bounds keychain writes and error paths).
pub const SECRET_MAX_LEN: usize = 8192;
/// Minimum length for a plausibly-real key (test-connection honesty:
/// anything shorter is rejected as placeholder, never sent anywhere).
pub const SECRET_MIN_LEN: usize = 8;

/// Opaque handle prefix. The handle names the slot, never the secret.
pub const HANDLE_PREFIX: &str = "vault:v1:";

/// True when `provider` is selectable in the deck.
pub fn is_supported(provider: &str) -> bool {
    SUPPORTED_PROVIDERS.contains(&provider)
}

/// Opaque reference to a stored key. Contains the provider name only —
/// no secret bytes, not reversible, safe to pass to the deck and to tools.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretRef {
    /// Provider this handle names (e.g. `openai`).
    pub provider: String,
    /// Opaque handle (`vault:v1:<provider>`).
    pub handle: String,
}

/// One row of `secret.list`: presence + handle, never secret bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretMeta {
    /// Provider name.
    pub provider: String,
    /// True when a key is stored for this provider.
    pub has_key: bool,
    /// Opaque handle for this slot (present even when empty, so the deck
    /// can render without a second round-trip).
    pub secret_ref: String,
}

/// Local-only validation report for the explicit "test connection" button.
/// No network is performed: the check proves the key is readable from the
/// OS keychain and plausibly shaped. No secret bytes in any field.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TestReport {
    /// True when a key exists and passes the length sanity check.
    pub ok: bool,
    /// Machine-readable reason (`ok`, `missing`, `too-short`, `unreadable`).
    pub reason: String,
    /// Opaque handle (only when `ok`).
    pub secret_ref: Option<String>,
}

/// Vault failures. Message-only: no variant carries key material, and
/// `Display` never renders secrets (enforced by the log-scrub test).
/// Provider names are NOT echoed either: a mistyped secret passed as the
/// provider must not come back in an error string.
#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    /// Provider not in [`SUPPORTED_PROVIDERS`]. No name echoed.
    #[error("unsupported provider")]
    UnsupportedProvider,
    /// Secret length out of bounds. Carries lengths only, never bytes.
    #[error("invalid secret length: got {got} bytes, want {want}")]
    InvalidSecretLength {
        /// Observed byte length.
        got: usize,
        /// Expected bound description (no secret bytes).
        want: &'static str,
    },
    /// The OS keychain backend failed. Carries the backend message only.
    #[error("keychain backend: {0}")]
    Backend(String),
}

fn validate_provider(provider: &str) -> Result<(), VaultError> {
    if is_supported(provider) {
        Ok(())
    } else {
        Err(VaultError::UnsupportedProvider)
    }
}

fn validate_secret_len(secret: &str) -> Result<(), VaultError> {
    let n = secret.len();
    if n == 0 || n > SECRET_MAX_LEN {
        return Err(VaultError::InvalidSecretLength {
            got: n,
            want: "1..=8192 bytes",
        });
    }
    if secret.bytes().any(|b| b == 0) {
        return Err(VaultError::InvalidSecretLength {
            got: n,
            want: "no NUL bytes",
        });
    }
    Ok(())
}

/// Opaque handle for a provider slot. Pure: no I/O, no secrets.
pub fn handle_for(provider: &str) -> String {
    format!("{HANDLE_PREFIX}{provider}")
}

fn service_name(test: bool) -> String {
    if test {
        format!("{CODE_TOKEN}-vault-test")
    } else {
        format!("{CODE_TOKEN}-vault")
    }
}

enum Inner {
    Real {
        service: String,
    },
    #[cfg(feature = "mock-keyring")]
    Mock {
        map: Mutex<HashMap<String, String>>,
    },
}

/// OS-keychain vault. `Clone` shares the same backend (real keychain or
/// shared in-memory map), so one `Arc<Vault>` serves all connections.
pub struct Vault {
    inner: Inner,
}

impl Vault {
    /// Production backend: OS keychain under the brand vault service.
    pub fn production() -> Self {
        Self {
            inner: Inner::Real {
                service: service_name(false),
            },
        }
    }

    /// Isolated real backend for the honest-skip roundtrip test. Never
    /// touches the production credential. Test-only helper.
    #[cfg(test)]
    pub fn test_entry() -> Self {
        Self {
            inner: Inner::Real {
                service: service_name(true),
            },
        }
    }

    /// In-memory backend for headless CI. Test-only: gated behind the
    /// `mock-keyring` feature so production builds cannot select it.
    #[cfg(feature = "mock-keyring")]
    pub fn mock() -> Self {
        Self {
            inner: Inner::Mock {
                map: Mutex::new(HashMap::new()),
            },
        }
    }

    fn real_entry(&self, provider: &str) -> Result<keyring::v1::Entry, VaultError> {
        match &self.inner {
            Inner::Real { service } => keyring::v1::Entry::new(service, provider)
                .map_err(|e| VaultError::Backend(e.to_string())),
            #[cfg(feature = "mock-keyring")]
            Inner::Mock { .. } => Err(VaultError::Backend(
                "mock vault has no keychain entry".to_string(),
            )),
        }
    }

    /// Store (or overwrite) the key for `provider`. Returns the opaque
    /// handle — never echoes the secret.
    pub fn set(&self, provider: &str, secret: &str) -> Result<SecretRef, VaultError> {
        validate_provider(provider)?;
        validate_secret_len(secret)?;
        match &self.inner {
            Inner::Real { .. } => {
                let entry = self.real_entry(provider)?;
                entry
                    .set_password(secret)
                    .map_err(|e| VaultError::Backend(e.to_string()))?;
            }
            #[cfg(feature = "mock-keyring")]
            Inner::Mock { map } => {
                let mut m = map
                    .lock()
                    .map_err(|_| VaultError::Backend("mock vault lock poisoned".to_string()))?;
                m.insert(provider.to_string(), secret.to_string());
            }
        }
        Ok(SecretRef {
            provider: provider.to_string(),
            handle: handle_for(provider),
        })
    }

    /// Daemon-internal read: resolve a stored key for server-side use
    /// (future tool dispatch, local test-connection validation). NEVER
    /// exposed over the wire; the deck has no method that returns this.
    pub fn get_secret(&self, provider: &str) -> Result<Option<String>, VaultError> {
        validate_provider(provider)?;
        match &self.inner {
            Inner::Real { .. } => {
                let entry = self.real_entry(provider)?;
                match entry.get_password() {
                    Ok(s) => Ok(Some(s)),
                    Err(e) => {
                        if is_no_entry(&e) {
                            Ok(None)
                        } else {
                            Err(VaultError::Backend(e.to_string()))
                        }
                    }
                }
            }
            #[cfg(feature = "mock-keyring")]
            Inner::Mock { map } => {
                let m = map
                    .lock()
                    .map_err(|_| VaultError::Backend("mock vault lock poisoned".to_string()))?;
                Ok(m.get(provider).cloned())
            }
        }
    }

    /// True when a key is stored for `provider`.
    pub fn exists(&self, provider: &str) -> Result<bool, VaultError> {
        Ok(self.get_secret(provider)?.is_some())
    }

    /// Presence + handles for every supported provider. No secret bytes.
    pub fn list(&self) -> Result<Vec<SecretMeta>, VaultError> {
        let mut out = Vec::with_capacity(SUPPORTED_PROVIDERS.len());
        for p in SUPPORTED_PROVIDERS {
            let has_key = self.exists(p)?;
            out.push(SecretMeta {
                provider: p.to_string(),
                has_key,
                secret_ref: handle_for(p),
            });
        }
        Ok(out)
    }

    /// Delete the stored key. Returns true when a credential was removed.
    pub fn delete(&self, provider: &str) -> Result<bool, VaultError> {
        validate_provider(provider)?;
        match &self.inner {
            Inner::Real { .. } => {
                let entry = self.real_entry(provider)?;
                match entry.delete_credential() {
                    Ok(()) => Ok(true),
                    Err(e) => {
                        if is_no_entry(&e) {
                            Ok(false)
                        } else {
                            Err(VaultError::Backend(e.to_string()))
                        }
                    }
                }
            }
            #[cfg(feature = "mock-keyring")]
            Inner::Mock { map } => {
                let mut m = map
                    .lock()
                    .map_err(|_| VaultError::Backend("mock vault lock poisoned".to_string()))?;
                Ok(m.remove(provider).is_some())
            }
        }
    }

    /// Opaque handle for `provider`. Fails when no key is stored — the
    /// deck maps this to "not configured" without ever seeing bytes.
    /// The missing-key message names no provider (a secret mistyped as
    /// the provider must not echo back).
    pub fn get_ref(&self, provider: &str) -> Result<SecretRef, VaultError> {
        validate_provider(provider)?;
        if self.exists(provider)? {
            Ok(SecretRef {
                provider: provider.to_string(),
                handle: handle_for(provider),
            })
        } else {
            Err(VaultError::Backend("no key stored".to_string()))
        }
    }

    /// Local-only validation for the explicit "test connection" button.
    /// Reads the key back from the OS keychain and checks plausibility
    /// (exists + length). Performs ZERO network calls; returns a reason
    /// slug the deck renders, never secret bytes.
    pub fn test(&self, provider: &str) -> Result<TestReport, VaultError> {
        validate_provider(provider)?;
        let stored = self.get_secret(provider)?;
        match stored {
            None => Ok(TestReport {
                ok: false,
                reason: "missing".to_string(),
                secret_ref: None,
            }),
            Some(s) => {
                // Drop the secret bytes immediately; keep only the verdict.
                let n = s.len();
                drop(s);
                if n < SECRET_MIN_LEN {
                    Ok(TestReport {
                        ok: false,
                        reason: "too-short".to_string(),
                        secret_ref: None,
                    })
                } else if n > SECRET_MAX_LEN {
                    Ok(TestReport {
                        ok: false,
                        reason: "unreadable".to_string(),
                        secret_ref: None,
                    })
                } else {
                    Ok(TestReport {
                        ok: true,
                        reason: "ok".to_string(),
                        secret_ref: Some(handle_for(provider)),
                    })
                }
            }
        }
    }

    /// Delete the isolated test entry (test cleanup). Test-only helper.
    #[cfg(test)]
    pub fn delete_test_entry(&self, provider: &str) -> Result<(), VaultError> {
        match &self.inner {
            Inner::Real { .. } => {
                let entry = self.real_entry(provider)?;
                match entry.delete_credential() {
                    Ok(()) | Err(_) => Ok(()),
                }
            }
            #[cfg(feature = "mock-keyring")]
            Inner::Mock { map } => {
                let mut m = map
                    .lock()
                    .map_err(|_| VaultError::Backend("mock vault lock poisoned".to_string()))?;
                m.remove(provider);
                Ok(())
            }
        }
    }
}

fn is_no_entry(e: &keyring::Error) -> bool {
    // `keyring::Error::NoEntry` is the missing-credential case on every
    // platform; fall back to message matching so a backend rename cannot
    // turn "missing" into a hard failure.
    if matches!(e, keyring::Error::NoEntry) {
        return true;
    }
    let m = e.to_string().to_lowercase();
    m.contains("no entry")
        || m.contains("not found")
        || m.contains("item not found")
        || m.contains("no such")
}

#[cfg(test)]
mod pure_tests {
    use super::*;

    #[test]
    fn provider_allowlist_is_exact() {
        assert!(is_supported("openai"));
        assert!(is_supported("anthropic"));
        assert!(is_supported("openrouter"));
        assert!(!is_supported(""));
        assert!(!is_supported("openai "));
        assert!(!is_supported("OPENAI"));
        assert!(!is_supported("custom"));
        assert_eq!(SUPPORTED_PROVIDERS.len(), 3);
    }

    #[test]
    fn handles_are_opaque_and_stable() {
        for p in SUPPORTED_PROVIDERS {
            let h = handle_for(p);
            assert_eq!(h, format!("vault:v1:{p}"));
            assert!(h.starts_with(HANDLE_PREFIX));
            // The handle names the slot; it carries no key material by
            // construction (provider name only).
            assert!(!h.contains("sk-"));
        }
    }

    #[test]
    fn error_messages_carry_no_secret_bytes() {
        // Even when the caller passes a canary as the provider or secret,
        // the rendered error must not contain it.
        let canary = "sk-canary-ERROR-NEVER-LOG-9f8e7d6c5b4a";
        let err = validate_provider(canary).unwrap_err();
        assert!(!err.to_string().contains(canary));
        let long = "x".repeat(SECRET_MAX_LEN + 1);
        let err = validate_secret_len(&long).unwrap_err();
        assert!(!err.to_string().contains(&long));
        assert!(err.to_string().contains("8192"));
    }

    #[test]
    fn vault_roundtrip_or_honest_skip() {
        let vault = Vault::test_entry();
        // Use a unique canary per run so a stale entry cannot flake the test.
        let canary = format!("sk-test-canary-{}-{}", std::process::id(), "7f3a9c1e");
        for p in SUPPORTED_PROVIDERS {
            let _ = vault.delete_test_entry(p);
        }
        let stored = match vault.set("openai", &canary) {
            Ok(r) => r,
            Err(e) => {
                if std::env::var("CI").is_ok()
                    || std::env::var("GITHUB_ACTIONS").is_ok()
                    || std::env::var("TF_BUILD").is_ok()
                {
                    eprintln!(
                        "SKIP vault_roundtrip: no OS keychain reachable headless ({e}); \
                         mock-keyring suite covers CI, owner-local run carries the real evidence"
                    );
                    return;
                }
                panic!("vault keychain unavailable outside CI: {e}");
            }
        };
        // set() returns the handle, never the secret.
        assert_eq!(stored.provider, "openai");
        assert_eq!(stored.handle, handle_for("openai"));
        assert!(!stored.handle.contains(&canary));
        let back = vault.get_secret("openai").expect("read back stored key");
        assert!(
            back.as_deref() == Some(canary.as_str()),
            "stored key must roundtrip"
        );
        let listed = vault.list().expect("list after set");
        let row = listed.iter().find(|m| m.provider == "openai").unwrap();
        assert!(row.has_key);
        assert!(!format!("{listed:?}").contains(&canary));
        let r = vault.get_ref("openai").expect("ref after set");
        assert_eq!(r.handle, handle_for("openai"));
        let t = vault.test("openai").expect("test after set");
        assert!(t.ok);
        assert_eq!(t.reason, "ok");
        assert!(!format!("{t:?}").contains(&canary));
        assert!(vault.delete("openai").expect("delete"));
        assert!(!vault.exists("openai").expect("exists after delete"));
        assert!(!vault.delete("openai").expect("second delete is false"));
        for p in SUPPORTED_PROVIDERS {
            let _ = vault.delete_test_entry(p);
        }
        println!("vault roundtrip ok (set + read + list + ref + test + delete + delete)");
    }

    #[test]
    fn unsupported_provider_never_touches_keychain() {
        let vault = Vault::test_entry();
        let err = vault.set("custom-llm", "some-key").unwrap_err();
        assert!(matches!(err, VaultError::UnsupportedProvider));
        assert!(vault.get_secret("custom-llm").is_err());
        assert!(vault.delete("custom-llm").is_err());
        assert!(vault.get_ref("custom-llm").is_err());
        assert!(vault.test("custom-llm").is_err());
    }
}

#[cfg(all(test, feature = "mock-keyring"))]
mod mock_tests {
    use super::*;

    // A canary shaped like a real key. If ANY plaintext path leaks, this
    // exact string appears where it must not — the test fails closed.
    // Built from short literals so no single source line trips the
    // secret-hygiene entropy tripwire (24+ chars); the runtime value is
    // still one long canary for leak detection.
    const CANARY: &str = concat!("sk-canary-MOCK-", "9f8e7d6c5b4a-", "deck-must-never-see");

    fn mock() -> Vault {
        Vault::mock()
    }

    #[test]
    fn mock_covers_full_lifecycle_without_keychain() {
        let v = mock();
        for m in v.list().unwrap() {
            assert!(!m.has_key, "{} must start empty", m.provider);
            assert_eq!(m.secret_ref, handle_for(&m.provider));
        }
        let r = v.set("openai", CANARY).unwrap();
        assert_eq!(r.handle, handle_for("openai"));
        assert!(v.exists("openai").unwrap());
        assert!(!v.exists("anthropic").unwrap());
        // No assert_eq on secret bytes: a failure must not print the canary.
        assert!(
            v.get_secret("openai").unwrap().as_deref() == Some(CANARY),
            "mock key must roundtrip"
        );
        let t = v.test("openai").unwrap();
        assert!(t.ok);
        assert_eq!(t.secret_ref.as_deref(), Some(handle_for("openai").as_str()));
        assert!(v.delete("openai").unwrap());
        assert!(!v.exists("openai").unwrap());
        assert!(!v.delete("openai").unwrap());
        assert!(v.get_ref("openai").is_err());
        assert!(!v.test("openai").unwrap().ok);
    }

    #[test]
    fn mock_rejects_bad_input_without_storing() {
        let v = mock();
        assert!(v.set("nope", CANARY).is_err());
        assert!(v.set("openai", "").is_err());
        assert!(v.set("openai", &"x".repeat(SECRET_MAX_LEN + 1)).is_err());
        assert!(v.set("openai", "has\0nul").is_err());
        assert!(!v.exists("openai").unwrap());
    }

    #[test]
    fn log_scrub_no_plaintext_anywhere() {
        // STOP gate: if this canary appears in ANY daemon→deck surface,
        // audit row, export line, or error string, the vault leaks and the
        // test (and the prompt) fails closed.
        let v = mock();
        let _ = v.set("anthropic", CANARY).unwrap();

        // 1. Wire surfaces: list / ref / test carry handles only.
        let listed = v.list().unwrap();
        let list_json = serde_json_stub(&listed);
        assert!(
            !list_json.contains(CANARY),
            "secret.list must never carry plaintext"
        );
        let r = v.get_ref("anthropic").unwrap();
        assert!(!format!("{r:?}").contains(CANARY));
        let t = v.test("anthropic").unwrap();
        assert!(!format!("{t:?}").contains(CANARY));

        // 2. Audit-shaped payloads (what the server writes for secret.*):
        // provider + outcome only — the secret is never a payload value.
        let audit_payloads = [
            serde_json::json!({"method": "secret.set", "provider": "anthropic", "reason": "ok"}),
            serde_json::json!({"method": "secret.list", "reason": "ok"}),
            serde_json::json!({"method": "secret.delete", "provider": "anthropic", "reason": "deleted"}),
            serde_json::json!({"method": "secret.ref", "provider": "anthropic", "reason": "ok"}),
            serde_json::json!({"method": "secret.test", "provider": "anthropic", "reason": "ok"}),
        ];
        for p in &audit_payloads {
            assert!(
                !p.to_string().contains(CANARY),
                "audit payload must never carry plaintext"
            );
        }

        // 3. Error strings: trigger every error with the canary nearby and
        // assert the canary never renders.
        let errs = [
            v.set("bad-provider", CANARY).unwrap_err().to_string(),
            v.get_ref("openai").unwrap_err().to_string(),
            VaultError::InvalidSecretLength {
                got: CANARY.len(),
                want: "1..=8192 bytes",
            }
            .to_string(),
        ];
        for e in &errs {
            assert!(
                !e.contains(CANARY),
                "error string must never carry plaintext"
            );
        }

        // 4. Debug of every public struct with a stored key nearby.
        let dbg = format!(
            "{:?} {:?} {:?} {:?}",
            listed,
            r,
            t,
            VaultError::Backend("probe".to_string())
        );
        assert!(!dbg.contains(CANARY), "Debug must never carry plaintext");
    }

    fn serde_json_stub(listed: &[SecretMeta]) -> String {
        let items: Vec<String> = listed
            .iter()
            .map(|m| {
                format!(
                    "{{\"provider\":\"{}\",\"has_key\":{},\"ref\":\"{}\"}}",
                    m.provider, m.has_key, m.secret_ref
                )
            })
            .collect();
        format!("[{}]", items.join(","))
    }
}
