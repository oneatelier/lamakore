//! secret.* — provider API keys through the OS keychain only.
//!
//! The vault (`crates/vault`) holds key bytes in Credential Manager /
//! Keychain / Secret Service. SQLite holds no secrets (asserted by the
//! store schema test). This module is the ONLY wire funnel for secrets:
//! `secret.set` / `secret.list` / `secret.delete` / `secret.ref` /
//! `secret.test`, all issuance-plane (no capability token — the user
//! configures keys without holding one).
//!
//! Plaintext NEVER crosses the wire to the deck:
//! - deck → daemon: `secret.set` carries user-typed plaintext once
//!   (explicit save). It is stored and dropped; never echoed, logged,
//!   or audited.
//! - daemon → deck: every response carries metadata or an opaque handle
//!   (`vault:v1:<provider>`, no secret bytes, not reversible). There is
//!   no method that returns key bytes.
//!
//! Every terminal outcome is audited with provider names and reason slugs
//! only. Audit payload keys stay inside the export allowlist (`method`,
//! `provider`, `reason`); free text and key material can never enter the
//! chain through this path.

use core_protocol::wire::{Request, Response, RpcError};
use vault::Vault;

/// Wire methods for provider secrets (see `wire::ALLOWED_METHODS`).
pub const SECRET_SET_METHOD: &str = "secret.set";
/// Wire method for presence listing (handles only, never bytes).
pub const SECRET_LIST_METHOD: &str = "secret.list";
/// Wire method for key deletion.
pub const SECRET_DELETE_METHOD: &str = "secret.delete";
/// Wire method for the opaque handle (the deck's stored reference).
pub const SECRET_REF_METHOD: &str = "secret.ref";
/// Wire method for the explicit "test connection" button (local check,
/// zero network calls, one user-initiated request).
pub const SECRET_TEST_METHOD: &str = "secret.test";

fn ok_result(req: &Request, value: serde_json::Value) -> Response {
    Response {
        jsonrpc: "2.0".to_string(),
        id: Some(req.id.clone()),
        result: Some(value),
        error: None,
    }
}

fn invalid(req: &Request, what: &str) -> Response {
    Response {
        jsonrpc: "2.0".to_string(),
        id: Some(req.id.clone()),
        result: None,
        error: Some(RpcError {
            code: -32602,
            message: format!("invalid params: {what}"),
        }),
    }
}

fn internal(req: &Request, what: &str) -> Response {
    Response {
        jsonrpc: "2.0".to_string(),
        id: Some(req.id.clone()),
        result: None,
        error: Some(RpcError {
            code: -32603,
            message: format!("internal error: {what}"),
        }),
    }
}

fn param_str<'p>(params: &'p serde_json::Value, key: &str) -> Option<&'p str> {
    params.get(key).and_then(serde_json::Value::as_str)
}

/// Audit one secret outcome. Payload keys (`method`, `provider`, `reason`)
/// are all in the export allowlist; the secret value is never a payload
/// value on any path.
fn audit_outcome(store: &core_store::Store, now: u64, event: &str, provider: &str, reason: &str) {
    // Provider names are allowlisted and bounded; truncate defensively so
    // a hostile provider string cannot bloat the chain (length only —
    // the value itself is never secret).
    let p = if provider.len() <= 64 {
        provider
    } else {
        &provider[..64]
    };
    let _ = store.record_audit_event(
        &now.to_string(),
        "deck",
        event,
        &serde_json::json!({"method": event, "provider": p, "reason": reason}).to_string(),
    );
}

fn audit_list(store: &core_store::Store, now: u64, reason: &str) {
    let _ = store.record_audit_event(
        &now.to_string(),
        "deck",
        "secret.listed",
        &serde_json::json!({"method": "secret.list", "reason": reason}).to_string(),
    );
}

/// Route one secret.* request. Never logs, returns, or audits key bytes.
pub fn execute(req: &Request, vault: &Vault, store: &core_store::Store, now: u64) -> Response {
    match req.method.as_str() {
        SECRET_SET_METHOD => {
            let (Some(provider), Some(secret)) = (
                param_str(&req.params, "provider"),
                param_str(&req.params, "secret"),
            ) else {
                audit_outcome(store, now, "secret.set", "", "invalid-params");
                return invalid(req, "need {provider: string, secret: string}");
            };
            // Validate the provider name before touching the keychain so a
            // hostile name cannot create unbounded entries; the error names
            // no secret bytes (vault errors never render them).
            if !vault::is_supported(provider) {
                audit_outcome(store, now, "secret.set", provider, "invalid-params");
                return invalid(req, "unsupported provider");
            }
            match vault.set(provider, secret) {
                Ok(r) => {
                    audit_outcome(store, now, "secret.set", provider, "ok");
                    // The secret param is dropped here; only the handle leaves.
                    ok_result(
                        req,
                        serde_json::json!({"ref": r.handle, "provider": r.provider}),
                    )
                }
                Err(vault::VaultError::UnsupportedProvider) => {
                    audit_outcome(store, now, "secret.set", provider, "invalid-params");
                    invalid(req, "unsupported provider")
                }
                Err(vault::VaultError::InvalidSecretLength { .. }) => {
                    audit_outcome(store, now, "secret.set", provider, "invalid-params");
                    invalid(req, "invalid secret length")
                }
                Err(e) => {
                    audit_outcome(store, now, "secret.set", provider, "backend-error");
                    internal(req, &e.to_string())
                }
            }
        }
        SECRET_LIST_METHOD => match vault.list() {
            Ok(items) => {
                audit_list(store, now, "ok");
                let providers: Vec<serde_json::Value> = items
                    .iter()
                    .map(|m| {
                        serde_json::json!({
                            "provider": m.provider,
                            "has_key": m.has_key,
                            "ref": m.secret_ref,
                        })
                    })
                    .collect();
                ok_result(req, serde_json::json!({"providers": providers}))
            }
            Err(e) => {
                audit_list(store, now, "backend-error");
                internal(req, &e.to_string())
            }
        },
        SECRET_DELETE_METHOD => {
            let Some(provider) = param_str(&req.params, "provider") else {
                audit_outcome(store, now, "secret.deleted", "", "invalid-params");
                return invalid(req, "need {provider: string}");
            };
            if !vault::is_supported(provider) {
                audit_outcome(store, now, "secret.deleted", provider, "invalid-params");
                return invalid(req, "unsupported provider");
            }
            match vault.delete(provider) {
                Ok(deleted) => {
                    audit_outcome(
                        store,
                        now,
                        "secret.deleted",
                        provider,
                        if deleted { "deleted" } else { "missing" },
                    );
                    ok_result(req, serde_json::json!({"deleted": deleted}))
                }
                Err(vault::VaultError::UnsupportedProvider) => {
                    audit_outcome(store, now, "secret.deleted", provider, "invalid-params");
                    invalid(req, "unsupported provider")
                }
                Err(e) => {
                    audit_outcome(store, now, "secret.deleted", provider, "backend-error");
                    internal(req, &e.to_string())
                }
            }
        }
        SECRET_REF_METHOD => {
            let Some(provider) = param_str(&req.params, "provider") else {
                audit_outcome(store, now, "secret.ref", "", "invalid-params");
                return invalid(req, "need {provider: string}");
            };
            if !vault::is_supported(provider) {
                audit_outcome(store, now, "secret.ref", provider, "invalid-params");
                return invalid(req, "unsupported provider");
            }
            match vault.get_ref(provider) {
                Ok(r) => {
                    audit_outcome(store, now, "secret.ref", provider, "ok");
                    ok_result(
                        req,
                        serde_json::json!({"ref": r.handle, "provider": r.provider}),
                    )
                }
                Err(_) => {
                    // Missing key and backend failure both surface as
                    // invalid here (no secret bytes in either message);
                    // the deck renders "not configured".
                    audit_outcome(store, now, "secret.ref", provider, "missing");
                    invalid(req, "no key stored for this provider")
                }
            }
        }
        SECRET_TEST_METHOD => {
            let Some(provider) = param_str(&req.params, "provider") else {
                audit_outcome(store, now, "secret.tested", "", "invalid-params");
                return invalid(req, "need {provider: string}");
            };
            if !vault::is_supported(provider) {
                audit_outcome(store, now, "secret.tested", provider, "invalid-params");
                return invalid(req, "unsupported provider");
            }
            match vault.test(provider) {
                Ok(t) => {
                    audit_outcome(
                        store,
                        now,
                        "secret.tested",
                        provider,
                        if t.ok { "ok" } else { &t.reason },
                    );
                    let mut v = serde_json::json!({"ok": t.ok, "reason": t.reason});
                    if let Some(h) = t.secret_ref {
                        v["ref"] = serde_json::Value::String(h);
                    }
                    ok_result(req, v)
                }
                Err(vault::VaultError::UnsupportedProvider) => {
                    audit_outcome(store, now, "secret.tested", provider, "invalid-params");
                    invalid(req, "unsupported provider")
                }
                Err(e) => {
                    audit_outcome(store, now, "secret.tested", provider, "backend-error");
                    internal(req, &e.to_string())
                }
            }
        }
        _ => Response {
            jsonrpc: "2.0".to_string(),
            id: Some(req.id.clone()),
            result: None,
            error: Some(RpcError {
                code: -32601,
                message: format!("method not found: {}", req.method),
            }),
        },
    }
}

#[cfg(all(test, feature = "mock-keyring"))]
mod tests {
    use super::*;
    use core_protocol::wire::Request;
    use core_store::Store;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static N: AtomicU64 = AtomicU64::new(0);
    const NOW: u64 = 1_800_000_000;
    // Canary shaped like a real key: any leak fails the test closed.
    // Short literals so no source line trips the entropy tripwire (24+).
    const CANARY: &str = concat!(
        "sk-canary-WIRE-",
        "7d2c9a4f1e8b6a5c-",
        "deck-must-never-see"
    );

    fn harness(tag: &str) -> (PathBuf, Store, Vault) {
        let n = N.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("core-secret-{n}-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::open(&dir.join("test.db")).unwrap();
        (dir, store, Vault::mock())
    }

    fn scrub(dir: &std::path::Path) {
        let _ = std::fs::remove_dir_all(dir);
    }

    fn req(method: &str, params: serde_json::Value) -> Request {
        Request {
            jsonrpc: "2.0".to_string(),
            id: 1.into(),
            method: method.to_string(),
            params,
        }
    }

    fn dump(v: &serde_json::Value) -> String {
        serde_json::to_string(v).unwrap()
    }

    fn dump_err(e: &core_protocol::wire::RpcError) -> String {
        format!("{} {}", e.code, e.message)
    }

    #[test]
    fn set_list_ref_test_delete_roundtrip_without_plaintext_on_wire() {
        let (dir, store, vault) = harness("roundtrip");
        // set carries the canary deck->daemon once; the response must not echo it.
        let r = execute(
            &req(
                SECRET_SET_METHOD,
                serde_json::json!({"provider": "openai", "secret": CANARY}),
            ),
            &vault,
            &store,
            NOW,
        );
        assert!(r.error.is_none(), "set must succeed");
        let body = r.result.unwrap();
        assert_eq!(body["provider"], "openai");
        assert_eq!(body["ref"], vault::handle_for("openai"));
        assert!(
            !dump(&body).contains(CANARY),
            "secret.set response must not echo plaintext"
        );
        // list: handles only.
        let r = execute(
            &req(SECRET_LIST_METHOD, serde_json::json!({})),
            &vault,
            &store,
            NOW,
        );
        assert!(r.error.is_none());
        let body = r.result.unwrap();
        assert!(
            !dump(&body).contains(CANARY),
            "list must not carry plaintext"
        );
        let row = body["providers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["provider"] == "openai")
            .unwrap();
        assert_eq!(row["has_key"], true);
        // ref: handle only.
        let r = execute(
            &req(SECRET_REF_METHOD, serde_json::json!({"provider": "openai"})),
            &vault,
            &store,
            NOW,
        );
        assert!(r.error.is_none());
        assert!(!dump(&r.result.unwrap()).contains(CANARY));
        // test: ok + handle, no bytes.
        let r = execute(
            &req(
                SECRET_TEST_METHOD,
                serde_json::json!({"provider": "openai"}),
            ),
            &vault,
            &store,
            NOW,
        );
        assert!(r.error.is_none());
        let body = r.result.unwrap();
        assert_eq!(body["ok"], true);
        assert!(!dump(&body).contains(CANARY));
        // delete: no bytes.
        let r = execute(
            &req(
                SECRET_DELETE_METHOD,
                serde_json::json!({"provider": "openai"}),
            ),
            &vault,
            &store,
            NOW,
        );
        assert!(r.error.is_none());
        assert_eq!(r.result.unwrap()["deleted"], true);
        // ref after delete: honest missing, no bytes.
        let r = execute(
            &req(SECRET_REF_METHOD, serde_json::json!({"provider": "openai"})),
            &vault,
            &store,
            NOW,
        );
        assert!(r.error.is_some());
        let err = r.error.unwrap();
        assert!(!dump_err(&err).contains(CANARY));
        scrub(&dir);
    }

    #[test]
    fn bad_input_rejected_without_leak_or_store() {
        let (dir, store, vault) = harness("bad-input");
        for (method, params) in [
            (
                SECRET_SET_METHOD,
                serde_json::json!({"provider": "nope", "secret": CANARY}),
            ),
            (
                SECRET_SET_METHOD,
                serde_json::json!({"provider": "openai", "secret": ""}),
            ),
            (SECRET_SET_METHOD, serde_json::json!({"provider": "openai"})),
            (
                SECRET_DELETE_METHOD,
                serde_json::json!({"provider": "nope"}),
            ),
            (SECRET_REF_METHOD, serde_json::json!({"provider": "nope"})),
            (SECRET_TEST_METHOD, serde_json::json!({"provider": "nope"})),
            (SECRET_TEST_METHOD, serde_json::json!({})),
        ] {
            let r = execute(&req(method, params), &vault, &store, NOW);
            assert!(r.error.is_some(), "{method} must reject bad input");
            let msg = dump_err(&r.error.unwrap());
            assert!(!msg.contains(CANARY), "{method} error must not leak");
        }
        assert!(!vault.exists("openai").unwrap());
        scrub(&dir);
    }

    #[test]
    fn audit_and_export_carry_provider_never_plaintext() {
        let (dir, store, vault) = harness("audit");
        let _ = execute(
            &req(
                SECRET_SET_METHOD,
                serde_json::json!({"provider": "anthropic", "secret": CANARY}),
            ),
            &vault,
            &store,
            NOW,
        );
        let _ = execute(
            &req(SECRET_LIST_METHOD, serde_json::json!({})),
            &vault,
            &store,
            NOW,
        );
        let _ = execute(
            &req(
                SECRET_REF_METHOD,
                serde_json::json!({"provider": "anthropic"}),
            ),
            &vault,
            &store,
            NOW,
        );
        let _ = execute(
            &req(
                SECRET_TEST_METHOD,
                serde_json::json!({"provider": "anthropic"}),
            ),
            &vault,
            &store,
            NOW,
        );
        let _ = execute(
            &req(
                SECRET_DELETE_METHOD,
                serde_json::json!({"provider": "anthropic"}),
            ),
            &vault,
            &store,
            NOW,
        );
        let events = store.audit_events(10_000).unwrap();
        assert!(events.len() >= 5, "every secret call must audit");
        for e in &events {
            assert!(
                !e.detail.contains(CANARY),
                "audit row must never hold plaintext"
            );
            assert!(
                !e.payload_json.contains(CANARY),
                "audit payload must never hold plaintext"
            );
        }
        // Exported JSONL: envelope + allowlisted payload, no secret bytes.
        let jsonl = store.export_audit_jsonl(1000).unwrap();
        assert!(!jsonl.contains(CANARY), "export must never hold plaintext");
        for line in jsonl.lines() {
            let v: serde_json::Value = serde_json::from_str(line).unwrap();
            assert!(!dump(&v).contains(CANARY));
        }
        // Provider names survive export (secret.* rows stay meaningful).
        assert!(jsonl.contains("anthropic"));
        scrub(&dir);
    }
}
