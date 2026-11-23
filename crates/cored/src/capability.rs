//! Capability enforcement for daemon dispatch (DEFAULT-DENY).
//!
//! A capability is a signed token binding `{id, tool, scope, issued_at,
//! expires_at, grant_id}` under a device root key with HMAC-SHA256. The root
//! key lives in the OS keychain (see [`KeychainProvider`]); tests and
//! headless CI use the in-memory [`MockProvider`] behind the `mock-keyring`
//! feature.
//!
//! Dispatch rule (see `dispatch` in `server.rs`): `system.health`,
//! `system.info` and the issuance-plane methods (`capability.*`,
//! `approval.*`, `audit.verify`, `audit.export`) need no token.
//! EVERY other method must present a valid token or the call is refused
//! with wire error `CAPABILITY_DENIED` (-32001) and an audit event is
//! recorded. There is no path around [`Gate::authorize`].
//!
//! Grants persist in the store (`capability_grants` table). Revoke deletes
//! the grant row, which invalidates outstanding tokens (they bind to the
//! grant id). Scope edits may only narrow. Timestamps are epoch seconds;
//! callers pass `now` explicitly so tests are deterministic.

use core_protocol::brand::CODE_TOKEN;
use core_store::Store;
use hmac::{Hmac, KeyInit, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

/// Wire error code for refused dispatch.
pub const CAPABILITY_DENIED_CODE: i64 = -32001;
/// Issuance-plane methods (no token required to call them).
pub const ISSUANCE_METHODS: &[&str] = &[
    "capability.request",
    "capability.grant",
    "capability.revoke",
    "capability.list",
    "approval.request",
    "approval.decide",
    "approval.status",
    "audit.verify",
    "audit.export",
];

const TOKEN_VERSION: u8 = 1;
const ROOT_KEY_LEN: usize = 32;

static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

type HmacSha256 = Hmac<Sha256>;

/// Service name for the device root key (built from the brand token, never
/// spelled literally). Shared with the test entry by suffix.
fn keychain_service(test: bool) -> String {
    if test {
        format!("{CODE_TOKEN}-cored-device-root-test")
    } else {
        format!("{CODE_TOKEN}-cored-device-root")
    }
}

const KEYCHAIN_USER: &str = "device-root-key";

/// Lowercase hex encoding (no extra dep; also used for HMAC tags).
fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(char::from_digit(u32::from(*b >> 4), 16).unwrap_or('?'));
        out.push(char::from_digit(u32::from(*b & 0x0f), 16).unwrap_or('?'));
    }
    out
}

/// Strict lowercase-or-uppercase hex decode; `None` on any bad input.
fn hex_decode(text: &str) -> Option<Vec<u8>> {
    if text.is_empty() || !text.len().is_multiple_of(2) {
        return None;
    }
    let mut out = Vec::with_capacity(text.len() / 2);
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let hi = hex_val(bytes[i])?;
        let lo = hex_val(bytes[i + 1])?;
        out.push((hi << 4) | lo);
        i += 2;
    }
    Some(out)
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// A path prefix covers a resource path when equal or when the resource
/// extends it on a `/` boundary. The empty scope covers nothing; `/`
/// covers everything.
pub fn scope_covers(granted: &str, path: &str) -> bool {
    let g = granted.trim_end_matches('/');
    if g.is_empty() {
        // Granted "/" (all slashes trimmed away) covers everything;
        // the empty scope covers nothing.
        return !granted.is_empty();
    }
    if path == granted || path == g {
        return true;
    }
    path.starts_with(g) && path.as_bytes().get(g.len()) == Some(&b'/')
}

/// A scope edit is legal only when the new scope sits inside the old one
/// (narrowing or equal). Widening must go through revoke + re-grant.
pub fn scope_narrows_or_equal(old: &str, new: &str) -> bool {
    old == new || scope_covers(old, new)
}

/// On-the-wire token: fixed field order; `sig` is the hex HMAC-SHA256 of
/// the canonical payload (everything but `sig`).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct TokenWire {
    v: u8,
    id: String,
    tool: String,
    scope: String,
    iat: u64,
    exp: u64,
    gid: String,
    sig: String,
}

/// Verified claims after [`Gate::authorize`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Claims {
    /// Token id.
    pub id: String,
    /// Tool (method) the token covers.
    pub tool: String,
    /// Scope prefix the token covers.
    pub scope: String,
    /// Issued-at, epoch seconds.
    pub iat: u64,
    /// Expires-at, epoch seconds.
    pub exp: u64,
    /// Issuing grant row id, as text.
    pub gid: String,
}

fn canonical_payload(id: &str, tool: &str, scope: &str, iat: u64, exp: u64, gid: &str) -> String {
    let js = serde_json::to_string;
    format!(
        "{{\"v\":{TOKEN_VERSION},\"id\":{},\"tool\":{},\"scope\":{},\"iat\":{iat},\"exp\":{exp},\"gid\":{}}}",
        js(&id).unwrap_or_else(|_| "\"\"".to_string()),
        js(&tool).unwrap_or_else(|_| "\"\"".to_string()),
        js(&scope).unwrap_or_else(|_| "\"\"".to_string()),
        js(&gid).unwrap_or_else(|_| "\"\"".to_string()),
    )
}

fn hmac_sign(key: &[u8; 32], payload: &str) -> Result<[u8; 32], CapError> {
    let mut mac = HmacSha256::new_from_slice(key).map_err(|e| CapError::Crypto(e.to_string()))?;
    mac.update(payload.as_bytes());
    let out = mac.finalize().into_bytes();
    let mut tag = [0u8; 32];
    tag.copy_from_slice(&out);
    Ok(tag)
}

/// Mint a token string for the given claims.
fn mint_token(key: &[u8; 32], claims: &Claims) -> Result<String, CapError> {
    let payload = canonical_payload(
        &claims.id,
        &claims.tool,
        &claims.scope,
        claims.iat,
        claims.exp,
        &claims.gid,
    );
    let tag = hmac_sign(key, &payload)?;
    let body = payload
        .strip_suffix('}')
        .ok_or_else(|| CapError::Crypto("canonical payload malformed".to_string()))?;
    Ok(format!("{body},\"sig\":\"{}\"}}", hex_encode(&tag)))
}

/// Parse and authenticate a presented token (signature only; freshness and
/// grant checks happen in [`Gate::authorize`]).
fn open_token(key: &[u8; 32], presented: &str) -> Result<Claims, Deny> {
    let wire: TokenWire = serde_json::from_str(presented).map_err(|_| Deny::Malformed)?;
    if wire.v != TOKEN_VERSION {
        return Err(Deny::Malformed);
    }
    let payload = canonical_payload(
        &wire.id,
        &wire.tool,
        &wire.scope,
        wire.iat,
        wire.exp,
        &wire.gid,
    );
    let presented_tag = hex_decode(&wire.sig).ok_or(Deny::BadSignature)?;
    let mut mac = HmacSha256::new_from_slice(key).map_err(|_| Deny::BadSignature)?;
    mac.update(payload.as_bytes());
    mac.verify_slice(&presented_tag)
        .map_err(|_| Deny::BadSignature)?;
    Ok(Claims {
        id: wire.id,
        tool: wire.tool,
        scope: wire.scope,
        iat: wire.iat,
        exp: wire.exp,
        gid: wire.gid,
    })
}

/// Why authorization refused a call. Rendered into audit detail and the
/// `capability denied: <slug>` wire message; carries no secrets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Deny {
    /// No token presented at all.
    Missing,
    /// Not a token (bad JSON, wrong version).
    Malformed,
    /// HMAC mismatch (tampered or foreign key).
    BadSignature,
    /// `now >= exp`.
    Expired,
    /// Grant row gone (revoked) or never existed.
    UnknownGrant,
    /// Token tool/scope no longer matches its grant row.
    GrantMismatch,
    /// Grant was narrowed after issuance; token exceeds it now.
    ScopeNarrowed,
    /// Token is for a different tool than the dispatched method.
    WrongTool,
    /// `params.path` lies outside the token scope.
    ScopeViolation,
}

impl Deny {
    /// Stable slug for wire messages and audit detail.
    pub fn slug(self) -> &'static str {
        match self {
            Deny::Missing => "missing",
            Deny::Malformed => "malformed",
            Deny::BadSignature => "bad-signature",
            Deny::Expired => "expired",
            Deny::UnknownGrant => "unknown-grant",
            Deny::GrantMismatch => "grant-mismatch",
            Deny::ScopeNarrowed => "scope-narrowed",
            Deny::WrongTool => "wrong-tool",
            Deny::ScopeViolation => "scope-violation",
        }
    }
}

/// Failures of the issuance plane (grant/request/revoke/list) and of local
/// plumbing. Dispatch denials are [`Deny`], not errors.
#[derive(Debug, thiserror::Error)]
pub enum CapError {
    /// Bad issuance input (empty tool, zero TTL, unknown request ...).
    #[error("invalid params: {0}")]
    InvalidParams(String),
    /// A scope edit that would widen the grant.
    #[error("scope edit must narrow, not widen")]
    ScopeWidening,
    /// Referenced pending request does not exist.
    #[error("unknown request id")]
    UnknownRequest,
    /// Referenced grant row does not exist.
    #[error("unknown grant id")]
    UnknownGrant,
    /// System clock unavailable (fail closed by the caller).
    #[error("clock unavailable")]
    Clock,
    /// Crypto or encoding failure.
    #[error("crypto error: {0}")]
    Crypto(String),
    /// Store failure.
    #[error(transparent)]
    Store(#[from] core_store::StoreError),
}

/// A source for the 32-byte device root key.
pub trait KeyProvider {
    /// Load the persisted key, or create, persist, and return a fresh one.
    fn load_or_create_key(&self) -> Result<[u8; 32], KeyError>;
}

/// Key provider errors (message-only: never include key material).
#[derive(Debug, thiserror::Error)]
pub enum KeyError {
    /// The keychain backend failed.
    #[error("keychain backend: {0}")]
    Backend(String),
    /// A stored key exists but does not parse (never overwritten blindly).
    #[error("stored key corrupt: {0}")]
    Corrupt(String),
    /// OS randomness unavailable.
    #[error("randomness unavailable: {0}")]
    Random(String),
}

/// Device root key in the OS keychain (Credential Manager / Keychain /
/// Secret Service). First call on a machine generates 32 random bytes and
/// persists them; later calls load them back.
pub struct KeychainProvider {
    service: String,
    user: String,
}

impl KeychainProvider {
    /// Production entry (provisional token dir + fixed account name).
    pub fn device_root() -> Self {
        Self {
            service: keychain_service(false),
            user: KEYCHAIN_USER.to_string(),
        }
    }

    /// Isolated entry for the honest-skip roundtrip test (never touches the
    /// production credential). Test-only helper.
    #[cfg(test)]
    pub fn test_entry() -> Self {
        Self {
            service: keychain_service(true),
            user: KEYCHAIN_USER.to_string(),
        }
    }

    fn entry(&self) -> Result<keyring::v1::Entry, KeyError> {
        keyring::v1::Entry::new(&self.service, &self.user)
            .map_err(|e| KeyError::Backend(e.to_string()))
    }

    /// Delete this entry (test cleanup; uninstall flows). Test-only helper.
    #[cfg(test)]
    pub fn delete(&self) -> Result<(), KeyError> {
        self.entry()?
            .delete_credential()
            .map_err(|e| KeyError::Backend(e.to_string()))
    }
}

impl KeyProvider for KeychainProvider {
    fn load_or_create_key(&self) -> Result<[u8; 32], KeyError> {
        let entry = self.entry()?;
        match entry.get_password() {
            Ok(hex) => parse_key_hex(&hex)
                .ok_or_else(|| KeyError::Corrupt(format!("entry {} unparseable", self.service))),
            Err(_) => {
                let mut key = [0u8; ROOT_KEY_LEN];
                getrandom::fill(&mut key).map_err(|e| KeyError::Random(e.to_string()))?;
                entry
                    .set_password(&hex_encode(&key))
                    .map_err(|e| KeyError::Backend(e.to_string()))?;
                Ok(key)
            }
        }
    }
}

fn parse_key_hex(text: &str) -> Option<[u8; 32]> {
    let bytes = hex_decode(text.trim())?;
    if bytes.len() != ROOT_KEY_LEN {
        return None;
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Some(key)
}

/// In-memory key provider for headless CI (no OS keychain). Test-only:
/// gated behind both `cfg(test)` and the `mock-keyring` feature so
/// production builds cannot select it by accident.
#[cfg(all(test, feature = "mock-keyring"))]
#[derive(Debug, Clone)]
pub struct MockProvider {
    key: [u8; 32],
}

#[cfg(all(test, feature = "mock-keyring"))]
impl MockProvider {
    /// Fixed, obviously-fake test key (never persisted anywhere).
    pub fn fixed_test_key() -> Self {
        Self { key: [0xA5u8; 32] }
    }

    /// Explicit key (e.g. to prove cross-key rejection).
    pub fn with_key(key: [u8; 32]) -> Self {
        Self { key }
    }
}

#[cfg(all(test, feature = "mock-keyring"))]
impl KeyProvider for MockProvider {
    fn load_or_create_key(&self) -> Result<[u8; 32], KeyError> {
        Ok(self.key)
    }
}

/// A pending `capability.request`: issuance intent awaiting `grant`.
/// `approval.request` extends this with a human-readable `reason` and a
/// decision deadline (`expires_at = requested_at + ttl_secs`): the deck
/// card counts down to it and expiry is DEFAULT DENY.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingRequest {
    /// Request id (`req-...` or `apr-...` for approval cards).
    pub id: String,
    /// Requested tool (method).
    pub tool: String,
    /// Requested scope prefix.
    pub scope: String,
    /// Requested TTL, seconds (also the decision window for approvals).
    pub ttl_secs: u64,
    /// Request time, epoch seconds.
    pub requested_at: u64,
    /// Human-readable reason shown on the deck card (`approval.request`).
    pub reason: String,
    /// Decision deadline, epoch seconds (`requested_at + ttl_secs`).
    pub expires_at: u64,
}

/// The enforcement point. Holds only the root key; the store (grants +
/// audit) is passed per call so connections each open their own handle.
#[derive(Debug, Clone, Copy)]
pub struct Gate {
    key: [u8; 32],
}

/// Arguments for [`Gate::grant`] (bundled so the method stays under the
/// argument-count lint).
pub struct GrantArgs<'a> {
    /// Tool (method) the grant covers; must be non-empty.
    pub tool: &'a str,
    /// Scope prefix the grant covers.
    pub scope: &'a str,
    /// Time to live, seconds; must be >= 1.
    pub ttl_secs: u64,
    /// Pending request this grant fulfills, if any.
    pub request_id: Option<&'a str>,
}

/// Arguments for [`Gate::request_approval`] (bundled so the method stays
/// under the argument-count lint).
pub struct ApprovalRequestArgs<'a> {
    /// Tool (method) the grant covers; must be non-empty.
    pub tool: &'a str,
    /// Scope prefix the grant covers.
    pub scope: &'a str,
    /// Human-readable reason shown on the deck card.
    pub reason: &'a str,
    /// Time to live, seconds; must be >= 1.
    pub ttl_secs: u64,
}

/// Arguments for [`Gate::decide_approval`] (bundled so the method stays
/// under the argument-count lint).
pub struct DecideArgs<'a> {
    /// Pending request this decision fulfills.
    pub request_id: &'a str,
    /// `approve` or `deny`.
    pub decision: &'a str,
    /// Narrowed scope, if the deck edited it (must narrow, never widen).
    pub scope: Option<&'a str>,
    /// Who decided (`deck`, `countdown`, ...).
    pub decided_by: &'a str,
    /// Free-text note persisted with the decision.
    pub note: &'a str,
}

/// Arguments for persisting an approval decision (bundled so the method
/// stays under the argument-count lint).
pub struct PersistArgs<'a> {
    /// Tool (method) the decision covers.
    pub tool: &'a str,
    /// Effective (possibly narrowed) scope.
    pub scope: &'a str,
    /// `allow`, `allow_once`, or `deny`.
    pub decision: &'a str,
    /// Who decided.
    pub decided_by: &'a str,
    /// Free-text note persisted with the decision.
    pub note: &'a str,
}

/// Pending-request id namespace: issuance plane (`req-…`) vs approval
/// plane (`apr-…`). Private: only the two `request_*` entry points pick one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RequestPrefix {
    Capability,
    Approval,
}

impl RequestPrefix {
    fn as_str(self) -> &'static str {
        match self {
            Self::Capability => "req",
            Self::Approval => "apr",
        }
    }
}

impl Gate {
    /// Build a gate from loaded root-key bytes.
    pub fn new(key: [u8; 32]) -> Self {
        Self { key }
    }

    fn unique_id(&self, prefix: &str, now: u64) -> String {
        let n = ID_COUNTER.fetch_add(1, Ordering::SeqCst);
        format!("{prefix}-{now}-{}-{n}", std::process::id())
    }

    fn audit(&self, store: &Store, now: u64, actor: &str, action: &str, detail: &str) {
        let _ = store.record_audit_event(&now.to_string(), actor, action, detail);
    }

    /// Record a grant request without issuing anything.
    pub fn request(
        &self,
        store: &Store,
        pending: &Mutex<HashMap<String, PendingRequest>>,
        tool: &str,
        scope: &str,
        ttl_secs: u64,
        now: u64,
    ) -> Result<String, CapError> {
        self.request_with_reason(
            store,
            pending,
            ApprovalRequestArgs {
                tool,
                scope,
                reason: "",
                ttl_secs,
            },
            now,
            RequestPrefix::Capability,
        )
    }

    /// Record an approval request (`approval.request {tool, scope, reason, ttl}`).
    /// Returns the request id; the deck card counts down to `expires_at` and
    /// expiry is DEFAULT DENY.
    pub fn request_approval(
        &self,
        store: &Store,
        pending: &Mutex<HashMap<String, PendingRequest>>,
        args: ApprovalRequestArgs<'_>,
        now: u64,
    ) -> Result<ApprovalFiled, CapError> {
        let ApprovalRequestArgs {
            tool,
            scope,
            reason,
            ttl_secs,
        } = args;
        if tool.is_empty() {
            return Err(CapError::InvalidParams("tool is empty".to_string()));
        }
        if ttl_secs == 0 {
            return Err(CapError::InvalidParams("ttl_secs must be >= 1".to_string()));
        }
        let id = self.request_with_reason(
            store,
            pending,
            ApprovalRequestArgs {
                tool,
                scope,
                reason,
                ttl_secs,
            },
            now,
            RequestPrefix::Approval,
        )?;
        let expires_at = now
            .checked_add(ttl_secs)
            .ok_or_else(|| CapError::InvalidParams("ttl overflows".to_string()))?;
        self.audit(
            store,
            now,
            "wire-client",
            "approval.requested",
            &serde_json::json!({"request_id": id, "tool": tool, "scope": scope}).to_string(),
        );
        Ok(ApprovalFiled {
            request_id: id,
            expires_at,
        })
    }

    fn request_with_reason(
        &self,
        store: &Store,
        pending: &Mutex<HashMap<String, PendingRequest>>,
        args: ApprovalRequestArgs<'_>,
        now: u64,
        prefix: RequestPrefix,
    ) -> Result<String, CapError> {
        let ApprovalRequestArgs {
            tool,
            scope,
            reason,
            ttl_secs,
        } = args;
        if tool.is_empty() {
            return Err(CapError::InvalidParams("tool is empty".to_string()));
        }
        if ttl_secs == 0 {
            return Err(CapError::InvalidParams("ttl_secs must be >= 1".to_string()));
        }
        let id = self.unique_id(prefix.as_str(), now);
        let expires_at = now
            .checked_add(ttl_secs)
            .ok_or_else(|| CapError::InvalidParams("ttl overflows".to_string()))?;
        let req = PendingRequest {
            id: id.clone(),
            tool: tool.to_string(),
            scope: scope.to_string(),
            ttl_secs,
            requested_at: now,
            reason: reason.to_string(),
            expires_at,
        };
        let mut map = pending
            .lock()
            .map_err(|_| CapError::Crypto("pending-request lock poisoned".to_string()))?;
        map.insert(id.clone(), req);
        drop(map);
        // Capability-plane audit stays for `req-*`; approval-plane audit is
        // added by request_approval so both planes stay queryable.
        if prefix == RequestPrefix::Capability {
            self.audit(
                store,
                now,
                "wire-client",
                "capability.requested",
                &serde_json::json!({"request_id": id, "tool": tool}).to_string(),
            );
        }
        Ok(id)
    }

    /// Issue (or narrowingly re-issue) a grant and mint its token.
    pub fn grant(
        &self,
        store: &Store,
        pending: &Mutex<HashMap<String, PendingRequest>>,
        args: GrantArgs<'_>,
        now: u64,
    ) -> Result<Issued, CapError> {
        let GrantArgs {
            tool,
            scope,
            ttl_secs,
            request_id,
        } = args;
        if tool.is_empty() {
            return Err(CapError::InvalidParams("tool is empty".to_string()));
        }
        if ttl_secs == 0 {
            return Err(CapError::InvalidParams("ttl_secs must be >= 1".to_string()));
        }
        if let Some(rid) = request_id {
            let mut map = pending
                .lock()
                .map_err(|_| CapError::Crypto("pending-request lock poisoned".to_string()))?;
            let req = map.get(rid).ok_or(CapError::UnknownRequest)?;
            if req.tool != tool {
                return Err(CapError::InvalidParams(
                    "request is for a different tool".to_string(),
                ));
            }
            if !scope_narrows_or_equal(&req.scope, scope) {
                return Err(CapError::ScopeWidening);
            }
            map.remove(rid);
        }
        let exp = now
            .checked_add(ttl_secs)
            .ok_or_else(|| CapError::InvalidParams("ttl overflows".to_string()))?;
        let scope_json = serde_json::json!({"prefix": scope}).to_string();
        let grant_id = if let Some(existing) = store.grant_by_tool(tool)? {
            if !scope_narrows_or_equal(&scope_prefix(&existing.scope_json), scope) {
                return Err(CapError::ScopeWidening);
            }
            store.update_grant(existing.id, &scope_json, &now.to_string(), &exp.to_string())?;
            existing.id
        } else {
            store.grant_capability(tool, &scope_json, &now.to_string(), Some(&exp.to_string()))?;
            store
                .grant_by_tool(tool)?
                .map(|g| g.id)
                .ok_or_else(|| CapError::Crypto("grant row missing after insert".to_string()))?
        };
        let claims = Claims {
            id: self.unique_id("cap", now),
            tool: tool.to_string(),
            scope: scope.to_string(),
            iat: now,
            exp,
            gid: grant_id.to_string(),
        };
        let token = mint_token(&self.key, &claims)?;
        self.audit(
            store,
            now,
            "wire-client",
            "capability.granted",
            &serde_json::json!({"grant_id": grant_id, "tool": tool}).to_string(),
        );
        Ok(Issued {
            token,
            grant_id,
            expires_at: exp.to_string(),
        })
    }

    /// Revoke a grant by row id; outstanding tokens bound to it deny after.
    pub fn revoke(&self, store: &Store, grant_id: i64, now: u64) -> Result<(), CapError> {
        let removed = store.delete_grant(grant_id)?;
        if removed == 0 {
            return Err(CapError::UnknownGrant);
        }
        self.audit(
            store,
            now,
            "wire-client",
            "capability.revoked",
            &serde_json::json!({"grant_id": grant_id}).to_string(),
        );
        Ok(())
    }

    /// Decide a pending approval (`approval.decide`).
    /// `decision` is `"approve"` or `"deny"`; `scope` may only narrow the
    /// requested scope. Approve mints a signed capability token and persists
    /// `allow` (`allow_once` when narrowed); deny/expired persists `deny`.
    /// Expiry is checked first: a late decision is DEFAULT DENY.
    pub fn decide_approval(
        &self,
        store: &Store,
        pending: &Mutex<HashMap<String, PendingRequest>>,
        args: DecideArgs<'_>,
        now: u64,
    ) -> Result<ApprovalDecided, CapError> {
        let DecideArgs {
            request_id,
            decision,
            scope,
            decided_by,
            note,
        } = args;
        let req = {
            let map = pending
                .lock()
                .map_err(|_| CapError::Crypto("pending-request lock poisoned".to_string()))?;
            map.get(request_id)
                .cloned()
                .ok_or(CapError::UnknownRequest)?
        };
        // Countdown expiry -> DEFAULT DENY, persisted + audited.
        if now >= req.expires_at {
            {
                let mut map = pending
                    .lock()
                    .map_err(|_| CapError::Crypto("pending-request lock poisoned".to_string()))?;
                map.remove(request_id);
            }
            self.persist_approval(
                store,
                PersistArgs {
                    tool: &req.tool,
                    scope: &req.scope,
                    decision: "deny",
                    decided_by: if decided_by.is_empty() {
                        "countdown"
                    } else {
                        decided_by
                    },
                    note: "expired: default deny",
                },
                &now.to_string(),
            )?;
            self.audit(
                store,
                now,
                "deck",
                "approval.expired",
                &serde_json::json!({"request_id": request_id, "tool": req.tool}).to_string(),
            );
            return Ok(ApprovalDecided {
                approved: false,
                decision: "expired".to_string(),
                token: None,
                grant_id: None,
                scope: req.scope,
                expires_at: req.expires_at.to_string(),
            });
        }
        if decision == "deny" {
            {
                let mut map = pending
                    .lock()
                    .map_err(|_| CapError::Crypto("pending-request lock poisoned".to_string()))?;
                map.remove(request_id);
            }
            self.persist_approval(
                store,
                PersistArgs {
                    tool: &req.tool,
                    scope: &req.scope,
                    decision: "deny",
                    decided_by: if decided_by.is_empty() {
                        "deck"
                    } else {
                        decided_by
                    },
                    note,
                },
                &now.to_string(),
            )?;
            self.audit(
                store,
                now,
                "deck",
                "approval.denied",
                &serde_json::json!({"request_id": request_id, "tool": req.tool}).to_string(),
            );
            return Ok(ApprovalDecided {
                approved: false,
                decision: "denied".to_string(),
                token: None,
                grant_id: None,
                scope: req.scope,
                expires_at: req.expires_at.to_string(),
            });
        }
        if decision != "approve" {
            return Err(CapError::InvalidParams(
                "decision must be approve or deny".to_string(),
            ));
        }
        let final_scope = scope.unwrap_or(&req.scope);
        if !scope_narrows_or_equal(&req.scope, final_scope) {
            return Err(CapError::ScopeWidening);
        }
        let edited = final_scope != req.scope;
        // Mint the signed token via the standard grant path. The pending
        // entry is consumed by grant(); approval audit follows.
        let issued = self.grant(
            store,
            pending,
            GrantArgs {
                tool: &req.tool,
                scope: final_scope,
                ttl_secs: req.ttl_secs,
                request_id: Some(request_id),
            },
            now,
        )?;
        let db_decision = if edited { "allow_once" } else { "allow" };
        self.persist_approval(
            store,
            PersistArgs {
                tool: &req.tool,
                scope: final_scope,
                decision: db_decision,
                decided_by: if decided_by.is_empty() {
                    "deck"
                } else {
                    decided_by
                },
                note,
            },
            &now.to_string(),
        )?;
        self.audit(
            store,
            now,
            "deck",
            if edited {
                "approval.edited"
            } else {
                "approval.approved"
            },
            &serde_json::json!({"request_id": request_id, "tool": req.tool, "scope": final_scope})
                .to_string(),
        );
        Ok(ApprovalDecided {
            approved: true,
            decision: if edited {
                "edited".to_string()
            } else {
                "approved".to_string()
            },
            token: Some(issued.token),
            grant_id: Some(issued.grant_id),
            scope: final_scope.to_string(),
            expires_at: issued.expires_at,
        })
    }

    /// Current status of a pending approval (checks expiry first).
    /// Store-independent: status derives from the in-memory pending map.
    pub fn approval_status(
        &self,
        pending: &Mutex<HashMap<String, PendingRequest>>,
        request_id: &str,
        now: u64,
    ) -> Result<ApprovalStatus, CapError> {
        let req = {
            let map = pending
                .lock()
                .map_err(|_| CapError::Crypto("pending-request lock poisoned".to_string()))?;
            map.get(request_id)
                .cloned()
                .ok_or(CapError::UnknownRequest)?
        };
        if now >= req.expires_at {
            return Ok(ApprovalStatus {
                status: "expired".to_string(),
                tool: req.tool,
                scope: req.scope,
                reason: req.reason,
                expires_at: req.expires_at.to_string(),
            });
        }
        Ok(ApprovalStatus {
            status: "pending".to_string(),
            tool: req.tool,
            scope: req.scope,
            reason: req.reason,
            expires_at: req.expires_at.to_string(),
        })
    }

    /// Persist one decision to the `approvals` table. Approvals reference a
    /// `tool_calls` row, so each decision hosts an ephemeral
    /// session/message/tool_call triple (`approval-<request_id>`).
    fn persist_approval(
        &self,
        store: &Store,
        args: PersistArgs<'_>,
        now: &str,
    ) -> Result<(), CapError> {
        let PersistArgs {
            tool,
            scope,
            decision,
            decided_by,
            note,
        } = args;
        let session_id = format!("approval-{}-{}", tool, now);
        let _ = store.insert_session(&session_id, tool, now);
        let message_id = store.insert_message(&session_id, "tool", note, now)?;
        let args_json = serde_json::json!({"scope": scope}).to_string();
        let status = if decision == "deny" {
            "cancelled"
        } else {
            "succeeded"
        };
        let tool_call_id = store.insert_tool_call(message_id, tool, &args_json, status, now)?;
        // A retrying decider (double-click, re-sent frame) must not fail the
        // second insert on the UNIQUE(tool_call_id) row: each decision hosts
        // its own tool_call, so uniqueness holds per decision.
        store.insert_approval(tool_call_id, decision, decided_by, note, now)?;
        Ok(())
    }

    /// Authorize one dispatch. Every refusal records an audit event.
    pub fn authorize(
        &self,
        store: &Store,
        method: &str,
        path: Option<&str>,
        presented: Option<&str>,
        now: u64,
    ) -> Result<Claims, Deny> {
        let deny = |store: &Store, actor: &str, method: &str, reason: Deny| -> Deny {
            self.audit(
                store,
                now,
                actor,
                "capability.denied",
                &serde_json::json!({"method": method, "reason": reason.slug()}).to_string(),
            );
            reason
        };
        let token = presented.ok_or_else(|| deny(store, "anonymous", method, Deny::Missing))?;
        let claims =
            open_token(&self.key, token).map_err(|r| deny(store, "anonymous", method, r))?;
        if now >= claims.exp {
            return Err(deny(store, &claims.id, method, Deny::Expired));
        }
        let gid: i64 = claims
            .gid
            .parse()
            .map_err(|_| deny(store, &claims.id, method, Deny::Malformed))?;
        let grant = store
            .grant_by_id(gid)
            .map_err(|_| deny(store, &claims.id, method, Deny::UnknownGrant))?
            .ok_or_else(|| deny(store, &claims.id, method, Deny::UnknownGrant))?;
        if grant.tool != claims.tool {
            return Err(deny(store, &claims.id, method, Deny::GrantMismatch));
        }
        if !scope_narrows_or_equal(&scope_prefix(&grant.scope_json), &claims.scope) {
            return Err(deny(store, &claims.id, method, Deny::ScopeNarrowed));
        }
        if claims.tool != method {
            return Err(deny(store, &claims.id, method, Deny::WrongTool));
        }
        if let Some(p) = path
            && !scope_covers(&claims.scope, p)
        {
            return Err(deny(store, &claims.id, method, Deny::ScopeViolation));
        }
        Ok(claims)
    }
}

/// Scope text out of a `{"prefix": ...}` grant document (raw text on
/// unparseable rows, which then match nothing).
fn scope_prefix(scope_json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(scope_json)
        .ok()
        .and_then(|v| v.get("prefix").and_then(|p| p.as_str()).map(str::to_string))
        .unwrap_or_default()
}

/// Freshly issued token plus its grant binding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Issued {
    /// Compact token to present as `params.capability`.
    pub token: String,
    /// Grant row id (`capability_grants.id`).
    pub grant_id: i64,
    /// Expiry, epoch seconds as text.
    pub expires_at: String,
}

/// Filed approval request (`approval.request` result).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApprovalFiled {
    /// Pending request id (`apr-...`).
    pub request_id: String,
    /// Decision deadline, epoch seconds.
    pub expires_at: u64,
}

/// Decided approval (`approval.decide` result, persisted to `approvals`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApprovalDecided {
    /// True when a signed token was issued.
    pub approved: bool,
    /// `approved` | `edited` | `denied` | `expired`.
    pub decision: String,
    /// Signed capability token (approve path only).
    pub token: Option<String>,
    /// Grant row id (approve path only).
    pub grant_id: Option<i64>,
    /// Effective (possibly narrowed) scope.
    pub scope: String,
    /// Token/decision expiry, epoch seconds as text.
    pub expires_at: String,
}

/// Pending approval status (`approval.status` result).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApprovalStatus {
    /// `pending` or `expired` (expiry is computed, not stored).
    pub status: String,
    /// Requested tool.
    pub tool: String,
    /// Requested scope.
    pub scope: String,
    /// Human-readable reason.
    pub reason: String,
    /// Decision deadline, epoch seconds as text.
    pub expires_at: String,
}

/// Current epoch seconds; `Err` only when the system clock is unusable
/// (callers fail closed).
pub fn now_secs() -> Result<u64, CapError> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .map_err(|_| CapError::Clock)
}

// ---------------------------------------------------------------------------
// wire/1 issuance plane
// ---------------------------------------------------------------------------

use core_protocol::wire::{Request, Response, RpcError};

fn ok_result(req: &Request, value: serde_json::Value) -> Response {
    Response {
        jsonrpc: "2.0".to_string(),
        id: Some(req.id.clone()),
        result: Some(value),
        error: None,
    }
}

fn err_result(req: &Request, code: i64, message: String) -> Response {
    Response {
        jsonrpc: "2.0".to_string(),
        id: Some(req.id.clone()),
        result: None,
        error: Some(RpcError { code, message }),
    }
}

fn param_str<'p>(params: &'p serde_json::Value, key: &str) -> Option<&'p str> {
    params.get(key).and_then(serde_json::Value::as_str)
}

fn param_u64(params: &serde_json::Value, key: &str) -> Option<u64> {
    params.get(key).and_then(serde_json::Value::as_u64)
}

fn param_i64(params: &serde_json::Value, key: &str) -> Option<i64> {
    params.get(key).and_then(serde_json::Value::as_i64)
}

fn invalid(req: &Request, what: &str) -> Response {
    err_result(req, -32602, format!("invalid params: {what}"))
}

fn internal(req: &Request, what: &str) -> Response {
    err_result(req, -32603, format!("internal error: {what}"))
}

/// Serve one issuance-plane method (`capability.*`, `approval.*`,
/// `audit.verify`, `audit.export`). These never require a token; every
/// other method is gated by [`Gate::authorize`] in dispatch.
pub fn handle_capability(
    req: &Request,
    pending: &Mutex<HashMap<String, PendingRequest>>,
    gate: &Gate,
    store: &Store,
    now: u64,
) -> Response {
    match req.method.as_str() {
        "capability.request" => {
            let (Some(tool), ttl) = (
                param_str(&req.params, "tool"),
                param_u64(&req.params, "ttl_secs"),
            ) else {
                return invalid(req, "need {tool: string, scope?: string, ttl_secs: u64}");
            };
            let scope = param_str(&req.params, "scope").unwrap_or("");
            let Some(ttl) = ttl else {
                return invalid(req, "need {tool: string, scope?: string, ttl_secs: u64}");
            };
            match gate.request(store, pending, tool, scope, ttl, now) {
                Ok(id) => ok_result(req, serde_json::json!({"request_id": id})),
                Err(CapError::InvalidParams(m)) => invalid(req, &m),
                Err(e) => internal(req, &e.to_string()),
            }
        }
        "capability.grant" => {
            let (Some(tool), ttl) = (
                param_str(&req.params, "tool"),
                param_u64(&req.params, "ttl_secs"),
            ) else {
                return invalid(
                    req,
                    "need {tool: string, scope?: string, ttl_secs: u64, request_id?: string}",
                );
            };
            let scope = param_str(&req.params, "scope").unwrap_or("");
            let Some(ttl) = ttl else {
                return invalid(
                    req,
                    "need {tool: string, scope?: string, ttl_secs: u64, request_id?: string}",
                );
            };
            let rid = param_str(&req.params, "request_id");
            match gate.grant(
                store,
                pending,
                GrantArgs {
                    tool,
                    scope,
                    ttl_secs: ttl,
                    request_id: rid,
                },
                now,
            ) {
                Ok(issued) => ok_result(
                    req,
                    serde_json::json!({
                        "token": issued.token,
                        "grant_id": issued.grant_id,
                        "expires_at": issued.expires_at,
                    }),
                ),
                Err(CapError::InvalidParams(m)) => invalid(req, &m),
                Err(CapError::ScopeWidening) => invalid(req, "scope edit must narrow, not widen"),
                Err(CapError::UnknownRequest) => invalid(req, "unknown request id"),
                Err(e) => internal(req, &e.to_string()),
            }
        }
        "capability.revoke" => {
            let Some(gid) = param_i64(&req.params, "grant_id") else {
                return invalid(req, "need {grant_id: integer}");
            };
            match gate.revoke(store, gid, now) {
                Ok(()) => ok_result(req, serde_json::json!({"revoked": true})),
                Err(CapError::UnknownGrant) => invalid(req, "unknown grant id"),
                Err(e) => internal(req, &e.to_string()),
            }
        }
        "capability.list" => match store.list_grants() {
            Ok(grants) => {
                let items: Vec<serde_json::Value> = grants
                    .iter()
                    .map(|g| {
                        serde_json::json!({
                            "grant_id": g.id,
                            "tool": g.tool,
                            "scope": scope_prefix(&g.scope_json),
                            "expires_at": g.expires_at,
                        })
                    })
                    .collect();
                ok_result(req, serde_json::json!({"grants": items}))
            }
            Err(e) => internal(req, &e.to_string()),
        },
        "approval.request" => {
            let (Some(tool), ttl) = (
                param_str(&req.params, "tool"),
                param_u64(&req.params, "ttl_secs"),
            ) else {
                return invalid(
                    req,
                    "need {tool: string, scope?: string, reason?: string, ttl_secs: u64}",
                );
            };
            let scope = param_str(&req.params, "scope").unwrap_or("");
            let reason = param_str(&req.params, "reason").unwrap_or("");
            let Some(ttl) = ttl else {
                return invalid(
                    req,
                    "need {tool: string, scope?: string, reason?: string, ttl_secs: u64}",
                );
            };
            match gate.request_approval(
                store,
                pending,
                ApprovalRequestArgs {
                    tool,
                    scope,
                    reason,
                    ttl_secs: ttl,
                },
                now,
            ) {
                Ok(filed) => ok_result(
                    req,
                    serde_json::json!({
                        "request_id": filed.request_id,
                        "expires_at": filed.expires_at.to_string(),
                    }),
                ),
                Err(CapError::InvalidParams(m)) => invalid(req, &m),
                Err(e) => internal(req, &e.to_string()),
            }
        }
        "approval.decide" => {
            let (Some(rid), Some(decision)) = (
                param_str(&req.params, "request_id"),
                param_str(&req.params, "decision"),
            ) else {
                return invalid(
                    req,
                    "need {request_id: string, decision: approve|deny, scope?: string}",
                );
            };
            let scope = param_str(&req.params, "scope");
            let decided_by = param_str(&req.params, "decided_by").unwrap_or("deck");
            let note = param_str(&req.params, "note").unwrap_or("");
            match gate.decide_approval(
                store,
                pending,
                DecideArgs {
                    request_id: rid,
                    decision,
                    scope,
                    decided_by,
                    note,
                },
                now,
            ) {
                Ok(d) => {
                    let mut v = serde_json::json!({
                        "approved": d.approved,
                        "decision": d.decision,
                        "scope": d.scope,
                        "expires_at": d.expires_at,
                    });
                    if let Some(t) = d.token {
                        v["token"] = serde_json::Value::String(t);
                    }
                    if let Some(g) = d.grant_id {
                        v["grant_id"] = serde_json::json!(g);
                    }
                    ok_result(req, v)
                }
                Err(CapError::InvalidParams(m)) => invalid(req, &m),
                Err(CapError::ScopeWidening) => invalid(req, "scope edit must narrow, not widen"),
                Err(CapError::UnknownRequest) => invalid(req, "unknown request id"),
                Err(e) => internal(req, &e.to_string()),
            }
        }
        "approval.status" => {
            let Some(rid) = param_str(&req.params, "request_id") else {
                return invalid(req, "need {request_id: string}");
            };
            match gate.approval_status(pending, rid, now) {
                Ok(s) => ok_result(
                    req,
                    serde_json::json!({
                        "status": s.status,
                        "tool": s.tool,
                        "scope": s.scope,
                        "reason": s.reason,
                        "expires_at": s.expires_at,
                    }),
                ),
                Err(CapError::UnknownRequest) => invalid(req, "unknown request id"),
                Err(e) => internal(req, &e.to_string()),
            }
        }
        "audit.verify" => match store.verify_audit_chain() {
            Ok(r) => ok_result(
                req,
                serde_json::json!({
                    "ok": r.ok,
                    "events": r.events,
                    "bad_seq": r.bad_seq,
                    "bad_reason": r.bad_reason,
                    "head": r.head_hash,
                }),
            ),
            Err(e) => internal(req, &e.to_string()),
        },
        "audit.export" => {
            let limit = param_i64(&req.params, "limit").unwrap_or(1000);
            match store.export_audit_jsonl(limit) {
                Ok(jsonl) => {
                    let events = if jsonl.is_empty() {
                        0
                    } else {
                        jsonl.lines().count() as u64
                    };
                    ok_result(req, serde_json::json!({"jsonl": jsonl, "events": events}))
                }
                Err(core_store::StoreError::Config(m)) => invalid(req, &m),
                Err(e) => internal(req, &e.to_string()),
            }
        }
        _ => err_result(req, -32601, format!("method not found: {}", req.method)),
    }
}

#[cfg(test)]
mod pure_tests {
    use super::*;

    #[test]
    fn scope_prefix_rules() {
        assert!(scope_covers("/proj", "/proj"));
        assert!(scope_covers("/proj", "/proj/a.txt"));
        assert!(scope_covers("/proj/", "/proj/a/b"));
        assert!(scope_covers("/", "/anything/at/all"));
        assert!(!scope_covers("/proj", "/proj-evil/a.txt"));
        assert!(!scope_covers("/proj", "/other"));
        assert!(!scope_covers("", "/proj/a.txt"));
        assert!(!scope_covers("/proj", ""));
        assert!(scope_narrows_or_equal("/proj", "/proj"));
        assert!(scope_narrows_or_equal("/proj", "/proj/sub"));
        assert!(!scope_narrows_or_equal("/proj/sub", "/proj"));
        assert!(!scope_narrows_or_equal("/proj", "/other"));
    }

    #[test]
    fn hex_roundtrip_and_rejects() {
        let bytes = [0x00u8, 0x0f, 0xa5, 0xff];
        assert_eq!(hex_decode(&hex_encode(&bytes)), Some(bytes.to_vec()));
        assert_eq!(hex_decode(""), None);
        assert_eq!(hex_decode("abc"), None);
        assert_eq!(hex_decode("zz"), None);
        assert_eq!(hex_decode("0x12"), None);
    }

    #[test]
    fn canonical_payload_is_stable() {
        let a = canonical_payload("id-1", "tool.exec", "/proj", 100, 200, "7");
        let b = canonical_payload("id-1", "tool.exec", "/proj", 100, 200, "7");
        assert_eq!(a, b);
        assert!(a.starts_with("{\"v\":1,\"id\":\"id-1\""));
        let c = canonical_payload("id-2", "tool.exec", "/proj", 100, 200, "7");
        assert_ne!(a, c);
    }

    #[test]
    fn device_key_roundtrip_or_honest_skip() {
        let provider = KeychainProvider::test_entry();
        let key = match provider.load_or_create_key() {
            Ok(k) => k,
            Err(e) => {
                if std::env::var("CI").is_ok()
                    || std::env::var("GITHUB_ACTIONS").is_ok()
                    || std::env::var("TF_BUILD").is_ok()
                {
                    eprintln!(
                        "SKIP device_key_roundtrip: no OS keychain reachable headless ({e}); \
                         mock-keyring suite covers CI, owner-local run carries the real evidence"
                    );
                    return;
                }
                panic!("keychain unavailable outside CI: {e}");
            }
        };
        let again = provider.load_or_create_key().expect("reload persisted key");
        assert_eq!(key, again);
        provider.delete().expect("cleanup test entry");
        let fresh = provider
            .load_or_create_key()
            .expect("recreate after delete");
        assert_ne!(fresh, [0u8; 32], "fresh key must be real randomness");
        provider.delete().expect("final cleanup");
        println!("keychain roundtrip ok (persist + reload + delete + recreate + delete)");
    }
}

#[cfg(all(test, feature = "mock-keyring"))]
mod mock_tests {
    use super::*;
    use core_store::Store;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TAG_COUNTER: AtomicU64 = AtomicU64::new(0);

    const NOW: u64 = 1_800_000_000;

    fn test_store(tag: &str) -> (PathBuf, Store) {
        let n = TAG_COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("core-cap-{}-{n}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.db");
        (dir, Store::open(&path).unwrap())
    }

    fn scrub(dir: &std::path::Path) {
        let _ = std::fs::remove_dir_all(dir);
    }

    fn gate() -> Gate {
        let key = MockProvider::fixed_test_key().load_or_create_key().unwrap();
        Gate::new(key)
    }

    fn pending() -> Mutex<HashMap<String, PendingRequest>> {
        Mutex::new(HashMap::new())
    }

    fn grant_full(
        gate: &Gate,
        store: &Store,
        pending: &Mutex<HashMap<String, PendingRequest>>,
    ) -> Issued {
        let issued = gate
            .grant(
                store,
                pending,
                GrantArgs {
                    tool: "tool.exec",
                    scope: "/proj",
                    ttl_secs: 3600,
                    request_id: None,
                },
                NOW,
            )
            .unwrap();
        assert_eq!(issued.expires_at, (NOW + 3600).to_string());
        issued
    }

    #[test]
    fn grant_then_authorize_ok() {
        let (dir, store) = test_store("grant-ok");
        let p = pending();
        let g = gate();
        let issued = g
            .grant(
                &store,
                &p,
                GrantArgs {
                    tool: "tool.exec",
                    scope: "/proj",
                    ttl_secs: 3600,
                    request_id: None,
                },
                NOW,
            )
            .unwrap();
        let claims = g
            .authorize(
                &store,
                "tool.exec",
                Some("/proj/a.txt"),
                Some(&issued.token),
                NOW,
            )
            .unwrap();
        assert_eq!(claims.tool, "tool.exec");
        assert_eq!(claims.scope, "/proj");
        assert_eq!(claims.exp, NOW + 3600);
        scrub(&dir);
    }

    #[test]
    fn byte_flip_tamper_denies() {
        let (dir, store) = test_store("tamper");
        let p = pending();
        let g = gate();
        let issued = g
            .grant(
                &store,
                &p,
                GrantArgs {
                    tool: "tool.exec",
                    scope: "/proj",
                    ttl_secs: 3600,
                    request_id: None,
                },
                NOW,
            )
            .unwrap();
        // Flip one byte in a payload value and one in the signature.
        let payload_flip = issued.token.replace("tool.exec", "Xool.exec");
        assert_ne!(payload_flip, issued.token);
        let sig_at = sig_start(&issued.token);
        let mut sig_flip = issued.token.clone();
        let cur = &sig_flip[sig_at..sig_at + 1];
        sig_flip.replace_range(sig_at..sig_at + 1, if cur == "0" { "1" } else { "0" });
        for (label, bad, want) in [
            ("payload-flip", payload_flip, Deny::BadSignature),
            ("sig-flip", sig_flip, Deny::BadSignature),
            (
                "truncated",
                issued.token[..issued.token.len() - 4].to_string(),
                Deny::Malformed,
            ),
            ("extended", format!("{}{{", issued.token), Deny::Malformed),
            ("empty", String::new(), Deny::Malformed),
            ("garbage", "not-a-token".to_string(), Deny::Malformed),
        ] {
            let r = g.authorize(&store, "tool.exec", Some("/proj/a.txt"), Some(&bad), NOW);
            assert_eq!(r.unwrap_err(), want, "case {label} must deny");
        }
        // Cross-key forgery: same claims, different root key.
        let other = Gate::new(
            MockProvider::with_key([0x5Au8; 32])
                .load_or_create_key()
                .unwrap(),
        );
        let r = other.authorize(
            &store,
            "tool.exec",
            Some("/proj/a.txt"),
            Some(&issued.token),
            NOW,
        );
        assert_eq!(r.unwrap_err(), Deny::BadSignature);
        scrub(&dir);
    }

    fn sig_start(token: &str) -> usize {
        token.rfind("\"sig\":\"").unwrap() + 7
    }

    #[test]
    fn expiry_boundary_denies() {
        let (dir, store) = test_store("expiry");
        let p = pending();
        let g = gate();
        let issued = g
            .grant(
                &store,
                &p,
                GrantArgs {
                    tool: "tool.exec",
                    scope: "/proj",
                    ttl_secs: 100,
                    request_id: None,
                },
                NOW,
            )
            .unwrap();
        assert_eq!(issued.expires_at, (NOW + 100).to_string());
        // Last valid second passes; the expiry second itself denies.
        assert!(
            g.authorize(
                &store,
                "tool.exec",
                Some("/proj/a.txt"),
                Some(&issued.token),
                NOW + 99
            )
            .is_ok()
        );
        assert_eq!(
            g.authorize(
                &store,
                "tool.exec",
                Some("/proj/a.txt"),
                Some(&issued.token),
                NOW + 100
            )
            .unwrap_err(),
            Deny::Expired
        );
        assert_eq!(
            g.authorize(
                &store,
                "tool.exec",
                Some("/proj/a.txt"),
                Some(&issued.token),
                NOW + 10_000
            )
            .unwrap_err(),
            Deny::Expired
        );
        scrub(&dir);
    }

    #[test]
    fn scope_violation_and_wrong_tool_deny() {
        let (dir, store) = test_store("scope");
        let p = pending();
        let g = gate();
        let issued = grant_full(&g, &store, &p);
        // Sibling prefix shares characters but not the boundary.
        assert_eq!(
            g.authorize(
                &store,
                "tool.exec",
                Some("/proj-evil/a.txt"),
                Some(&issued.token),
                NOW
            )
            .unwrap_err(),
            Deny::ScopeViolation
        );
        assert_eq!(
            g.authorize(
                &store,
                "tool.exec",
                Some("/other/a.txt"),
                Some(&issued.token),
                NOW
            )
            .unwrap_err(),
            Deny::ScopeViolation
        );
        // No path at all is fine for a method-level grant.
        assert!(
            g.authorize(&store, "tool.exec", None, Some(&issued.token), NOW)
                .is_ok()
        );
        // Same token presented for a different method denies.
        let other = g
            .grant(
                &store,
                &p,
                GrantArgs {
                    tool: "other.tool",
                    scope: "/proj",
                    ttl_secs: 3600,
                    request_id: None,
                },
                NOW,
            )
            .unwrap();
        assert_eq!(
            g.authorize(
                &store,
                "tool.exec",
                Some("/proj/a.txt"),
                Some(&other.token),
                NOW
            )
            .unwrap_err(),
            Deny::WrongTool
        );
        // And the reverse direction.
        assert_eq!(
            g.authorize(
                &store,
                "other.tool",
                Some("/proj/a.txt"),
                Some(&issued.token),
                NOW
            )
            .unwrap_err(),
            Deny::WrongTool
        );
        scrub(&dir);
    }

    #[test]
    fn revoke_mid_flight_denies() {
        let (dir, store) = test_store("revoke");
        let p = pending();
        let g = gate();
        let issued = grant_full(&g, &store, &p);
        assert!(
            g.authorize(
                &store,
                "tool.exec",
                Some("/proj/a.txt"),
                Some(&issued.token),
                NOW
            )
            .is_ok()
        );
        g.revoke(&store, issued.grant_id, NOW).unwrap();
        assert_eq!(
            g.authorize(
                &store,
                "tool.exec",
                Some("/proj/a.txt"),
                Some(&issued.token),
                NOW
            )
            .unwrap_err(),
            Deny::UnknownGrant
        );
        assert_eq!(
            g.revoke(&store, issued.grant_id, NOW)
                .unwrap_err()
                .to_string(),
            CapError::UnknownGrant.to_string()
        );
        scrub(&dir);
    }

    #[test]
    fn scope_edits_may_only_narrow() {
        let (dir, store) = test_store("narrow");
        let p = pending();
        let g = gate();
        let issued = grant_full(&g, &store, &p);
        // Narrowing the live grant keeps the id but invalidates wider tokens.
        let narrowed = g
            .grant(
                &store,
                &p,
                GrantArgs {
                    tool: "tool.exec",
                    scope: "/proj/sub",
                    ttl_secs: 3600,
                    request_id: None,
                },
                NOW,
            )
            .unwrap();
        assert_eq!(narrowed.grant_id, issued.grant_id);
        assert_eq!(
            g.authorize(
                &store,
                "tool.exec",
                Some("/proj/a.txt"),
                Some(&issued.token),
                NOW
            )
            .unwrap_err(),
            Deny::ScopeNarrowed
        );
        assert!(
            g.authorize(
                &store,
                "tool.exec",
                Some("/proj/sub/a.txt"),
                Some(&narrowed.token),
                NOW
            )
            .is_ok()
        );
        // Widening is refused outright.
        assert_eq!(
            g.grant(
                &store,
                &p,
                GrantArgs {
                    tool: "tool.exec",
                    scope: "/wider",
                    ttl_secs: 3600,
                    request_id: None
                },
                NOW
            )
            .unwrap_err()
            .to_string(),
            CapError::ScopeWidening.to_string()
        );
        // Revoke + re-grant restores a wider scope under a new grant id.
        g.revoke(&store, issued.grant_id, NOW).unwrap();
        let wide = g
            .grant(
                &store,
                &p,
                GrantArgs {
                    tool: "tool.exec",
                    scope: "/wider",
                    ttl_secs: 3600,
                    request_id: None,
                },
                NOW,
            )
            .unwrap();
        assert_ne!(wide.grant_id, issued.grant_id);
        assert!(
            g.authorize(
                &store,
                "tool.exec",
                Some("/wider/a.txt"),
                Some(&wide.token),
                NOW
            )
            .is_ok()
        );
        scrub(&dir);
    }

    #[test]
    fn request_binds_grant() {
        let (dir, store) = test_store("request");
        let p = pending();
        let g = gate();
        let rid = g
            .request(&store, &p, "tool.exec", "/proj", 60, NOW)
            .unwrap();
        assert!(rid.starts_with("req-"));
        // Unknown request id.
        assert_eq!(
            g.grant(
                &store,
                &p,
                GrantArgs {
                    tool: "tool.exec",
                    scope: "/proj",
                    ttl_secs: 60,
                    request_id: Some("req-nope")
                },
                NOW
            )
            .unwrap_err()
            .to_string(),
            CapError::UnknownRequest.to_string()
        );
        // Right id, wrong tool.
        assert!(
            g.grant(
                &store,
                &p,
                GrantArgs {
                    tool: "other.tool",
                    scope: "/proj",
                    ttl_secs: 60,
                    request_id: Some(&rid)
                },
                NOW
            )
            .is_err()
        );
        // Right id, wider scope than requested.
        assert_eq!(
            g.grant(
                &store,
                &p,
                GrantArgs {
                    tool: "tool.exec",
                    scope: "/elsewhere",
                    ttl_secs: 60,
                    request_id: Some(&rid)
                },
                NOW
            )
            .unwrap_err()
            .to_string(),
            CapError::ScopeWidening.to_string()
        );
        // Happy path consumes the request exactly once.
        let issued = g
            .grant(
                &store,
                &p,
                GrantArgs {
                    tool: "tool.exec",
                    scope: "/proj/sub",
                    ttl_secs: 60,
                    request_id: Some(&rid),
                },
                NOW,
            )
            .unwrap();
        assert!(
            g.authorize(
                &store,
                "tool.exec",
                Some("/proj/sub/a.txt"),
                Some(&issued.token),
                NOW
            )
            .is_ok()
        );
        assert_eq!(
            g.grant(
                &store,
                &p,
                GrantArgs {
                    tool: "tool.exec",
                    scope: "/proj/sub",
                    ttl_secs: 60,
                    request_id: Some(&rid)
                },
                NOW
            )
            .unwrap_err()
            .to_string(),
            CapError::UnknownRequest.to_string()
        );
        scrub(&dir);
    }

    #[test]
    fn missing_token_denies_and_audits() {
        let (dir, store) = test_store("missing");
        let g = gate();
        assert_eq!(
            g.authorize(&store, "tool.exec", Some("/proj/a.txt"), None, NOW)
                .unwrap_err(),
            Deny::Missing
        );
        let rows = store.audit_events(10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].action, "capability.denied");
        assert!(rows[0].detail.contains("\"reason\":\"missing\""));
        println!(
            "audit: {} | {} | {} | {}",
            rows[0].ts, rows[0].actor, rows[0].action, rows[0].detail
        );
        scrub(&dir);
    }

    #[test]
    fn denials_leave_audit_trail() {
        let (dir, store) = test_store("audit");
        let p = pending();
        let g = gate();
        let issued = grant_full(&g, &store, &p);
        // One grant + one allowed dispatch (no audit) + three denials.
        let _ = g.authorize(
            &store,
            "tool.exec",
            Some("/proj/a.txt"),
            Some(&issued.token),
            NOW,
        );
        let _ = g.authorize(
            &store,
            "tool.exec",
            Some("/nope/a.txt"),
            Some(&issued.token),
            NOW,
        );
        let _ = g.authorize(
            &store,
            "tool.exec",
            Some("/proj/a.txt"),
            Some(&issued.token),
            NOW + 999_999,
        );
        g.revoke(&store, issued.grant_id, NOW).unwrap();
        let _ = g.authorize(
            &store,
            "tool.exec",
            Some("/proj/a.txt"),
            Some(&issued.token),
            NOW,
        );
        let rows = store.audit_events(100).unwrap();
        let kinds: Vec<&str> = rows.iter().map(|r| r.action.as_str()).collect();
        assert_eq!(
            kinds,
            vec![
                "capability.granted",
                "capability.denied",
                "capability.denied",
                "capability.revoked",
                "capability.denied",
            ]
        );
        for r in &rows {
            println!(
                "audit: {} | {} | {} | {}",
                r.ts, r.actor, r.action, r.detail
            );
        }
        scrub(&dir);
    }

    #[test]
    fn approval_approve_issues_signed_token_and_persists() {
        let (dir, store) = test_store("apr-approve");
        let p = pending();
        let g = gate();
        let filed = g
            .request_approval(
                &store,
                &p,
                ApprovalRequestArgs {
                    tool: "tool.exec",
                    scope: "/proj",
                    reason: "read logs",
                    ttl_secs: 60,
                },
                NOW,
            )
            .unwrap();
        assert!(filed.request_id.starts_with("apr-"));
        // Deck approves: signed token, tool proceeds.
        let decided = g
            .decide_approval(
                &store,
                &p,
                DecideArgs {
                    request_id: &filed.request_id,
                    decision: "approve",
                    scope: None,
                    decided_by: "deck",
                    note: "looks good",
                },
                NOW + 5,
            )
            .unwrap();
        assert!(decided.approved);
        assert_eq!(decided.decision, "approved");
        let token = decided.token.clone().unwrap();
        assert!(
            g.authorize(
                &store,
                "tool.exec",
                Some("/proj/a.txt"),
                Some(&token),
                NOW + 5
            )
            .is_ok(),
            "approved token must authorize"
        );
        let rows = store.audit_events(100).unwrap();
        let kinds: Vec<&str> = rows.iter().map(|r| r.action.as_str()).collect();
        assert!(kinds.contains(&"approval.requested"));
        assert!(kinds.contains(&"approval.approved"));
        scrub(&dir);
    }

    #[test]
    fn approval_deny_maps_to_capability_denied() {
        let (dir, store) = test_store("apr-deny");
        let p = pending();
        let g = gate();
        let filed = g
            .request_approval(
                &store,
                &p,
                ApprovalRequestArgs {
                    tool: "tool.exec",
                    scope: "/proj",
                    reason: "risky",
                    ttl_secs: 60,
                },
                NOW,
            )
            .unwrap();
        let decided = g
            .decide_approval(
                &store,
                &p,
                DecideArgs {
                    request_id: &filed.request_id,
                    decision: "deny",
                    scope: None,
                    decided_by: "deck",
                    note: "no",
                },
                NOW + 5,
            )
            .unwrap();
        assert!(!decided.approved);
        assert_eq!(decided.decision, "denied");
        assert!(decided.token.is_none());
        // No token: dispatch denies with CAPABILITY_DENIED shape.
        let r = g.authorize(&store, "tool.exec", Some("/proj/a.txt"), None, NOW + 5);
        assert_eq!(r.unwrap_err(), Deny::Missing);
        let rows = store.audit_events(100).unwrap();
        assert!(
            rows.iter().any(|r| r.action == "approval.denied"),
            "deny must audit approval.denied"
        );
        scrub(&dir);
    }

    #[test]
    fn approval_timeout_is_default_deny() {
        let (dir, store) = test_store("apr-timeout");
        let p = pending();
        let g = gate();
        let filed = g
            .request_approval(
                &store,
                &p,
                ApprovalRequestArgs {
                    tool: "tool.exec",
                    scope: "/proj",
                    reason: "slow",
                    ttl_secs: 10,
                },
                NOW,
            )
            .unwrap();
        // Countdown hits zero: late approve stays expired (fail closed).
        let decided = g
            .decide_approval(
                &store,
                &p,
                DecideArgs {
                    request_id: &filed.request_id,
                    decision: "approve",
                    scope: None,
                    decided_by: "deck",
                    note: "too late",
                },
                NOW + 11,
            )
            .unwrap();
        assert!(!decided.approved);
        assert_eq!(decided.decision, "expired");
        let status = g
            .approval_status(&p, &filed.request_id, NOW + 11)
            .unwrap_err();
        assert_eq!(status.to_string(), CapError::UnknownRequest.to_string());
        let rows = store.audit_events(100).unwrap();
        assert!(
            rows.iter().any(|r| r.action == "approval.expired"),
            "timeout must audit approval.expired"
        );
        scrub(&dir);
    }

    #[test]
    fn approval_edit_may_only_narrow() {
        let (dir, store) = test_store("apr-edit");
        let p = pending();
        let g = gate();
        let filed = g
            .request_approval(
                &store,
                &p,
                ApprovalRequestArgs {
                    tool: "tool.exec",
                    scope: "/proj",
                    reason: "narrow me",
                    ttl_secs: 60,
                },
                NOW,
            )
            .unwrap();
        // Widening edit is refused.
        assert_eq!(
            g.decide_approval(
                &store,
                &p,
                DecideArgs {
                    request_id: &filed.request_id,
                    decision: "approve",
                    scope: Some("/other"),
                    decided_by: "deck",
                    note: "",
                },
                NOW + 5
            )
            .unwrap_err()
            .to_string(),
            CapError::ScopeWidening.to_string()
        );
        // Narrowing edit approves as `edited` and authorizes the subset only.
        let decided = g
            .decide_approval(
                &store,
                &p,
                DecideArgs {
                    request_id: &filed.request_id,
                    decision: "approve",
                    scope: Some("/proj/sub"),
                    decided_by: "deck",
                    note: "narrowed",
                },
                NOW + 5,
            )
            .unwrap();
        assert!(decided.approved);
        assert_eq!(decided.decision, "edited");
        assert_eq!(decided.scope, "/proj/sub");
        let token = decided.token.unwrap();
        assert!(
            g.authorize(
                &store,
                "tool.exec",
                Some("/proj/sub/a.txt"),
                Some(&token),
                NOW + 5
            )
            .is_ok()
        );
        assert_eq!(
            g.authorize(
                &store,
                "tool.exec",
                Some("/proj/a.txt"),
                Some(&token),
                NOW + 5
            )
            .unwrap_err(),
            Deny::ScopeViolation
        );
        scrub(&dir);
    }
}
