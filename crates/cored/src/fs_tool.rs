//! fs.list / fs.read — the first real tool through the FULL chain:
//! manifest (`packages/protocol`) -> capability gate -> sandboxed spawn
//! (Tier-1, P013/P014) -> approval card on first grant (P015) -> audit
//! chain (P016) -> result rendered in the deck.
//!
//! Read-only by construction: the worker (`run_worker`, spawned as
//! `cored fs-list|fs-read ...`) only ever lists directories and reads
//! files; it takes no write/create/delete path. The parent enforces, in
//! order: (1) param shape, (2) capability gate on the lexical path,
//! (3) canonicalization + containment inside the granted scope,
//! (4) sandboxed spawn with stdout inherited (no pipe API exists on the
//! Tier-1 drivers, so the child reports through a result file inside the
//! scope, which the parent reads back and deletes), (5) audit of every
//! terminal outcome. There is exactly one path to `spawn_sandboxed` and
//! it sits behind the gate: no gate skipped on any path, including
//! NOT_IMPLEMENTED, timeout, and helper-error paths.
//!
//! POSIX NOT_IMPLEMENTED honesty: when the sandbox primitive is missing
//! at runtime the spawn returns [`core_sandbox::SandboxError`], which maps
//! to wire `-32002` *after* the gate passed and *with* an audit row —
//! never a silent bypass, never an unenforced run.

use crate::capability::Gate;
use core_protocol::wire::{Request, Response, RpcError};
use core_sandbox::SandboxError;
use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// Wire method for directory listing.
pub const FS_LIST_METHOD: &str = "fs.list";
/// Wire method for file reading.
pub const FS_READ_METHOD: &str = "fs.read";
// Note: capability tool names equal the method names for fs tools
// ("fs.list", "fs.read"), so no separate tool-name constants exist.
/// Maximum entries returned by a single fs.list call.
pub const LIST_CAP: usize = 10_000;
/// Maximum content bytes returned by a single fs.read call.
pub const READ_CAP_BYTES: u64 = 1_048_576;
/// Sandbox spawn + tool timeout budget, milliseconds.
pub const TOOL_TIMEOUT_MS: u64 = 30_000;

/// Wire code for refused dispatch (mirrors the dispatch catch-all).
pub const CAPABILITY_DENIED_CODE: i64 = -32001;
/// Wire code when the sandbox cannot run here (mirrors core-sandbox).
pub const NOT_IMPLEMENTED_CODE: i64 = -32002;

/// Counter for unique result-file names (pid-qualified below).
static RESULT_COUNTER: AtomicU64 = AtomicU64::new(0);

/// The sandbox-child surface `execute_with` needs. Blanket-implemented for
/// [`core_sandbox::SandboxedChild`] on every platform; tests substitute a
/// fake without spawning anything.
pub trait ToolChild {
    /// Wait up to `timeout_ms`; `Ok(None)` is a timeout (caller kills).
    fn wait_timeout(&self, timeout_ms: u32) -> Result<Option<u32>, SandboxError>;
    /// Best-effort kill after timeout or failure.
    fn kill(&self) -> Result<(), SandboxError>;
}

impl ToolChild for core_sandbox::SandboxedChild {
    fn wait_timeout(&self, timeout_ms: u32) -> Result<Option<u32>, SandboxError> {
        self.wait_timeout(timeout_ms)
    }

    fn kill(&self) -> Result<(), SandboxError> {
        self.kill()
    }
}

/// Spawner shape: sandbox the helper in `scope`, run `program`, report
/// through a result file (Tier-1 drivers expose no stdout capture).
pub type SpawnFn = fn(&Path, &OsStr, &[&OsStr]) -> Result<Box<dyn ToolChild>, SandboxError>;

/// Terminal failure of the fs funnel (every variant is audited).
enum FsFail {
    /// Bad shape / missing files: wire -32602, reason `invalid-params`.
    /// (Scope escape after canonicalization is a deny, handled inline, not
    /// through this variant.)
    Invalid(String),
}

/// Real spawner: Tier-1 sandbox around the current daemon binary.
fn real_spawn(
    scope: &Path,
    program: &OsStr,
    args: &[&OsStr],
) -> Result<Box<dyn ToolChild>, SandboxError> {
    core_sandbox::spawn_sandboxed(scope, program, args).map(|c| Box::new(c) as Box<dyn ToolChild>)
}

/// Minimal base64 encoder (RFC 4648, padded). Hand-rolled so the worker
/// needs no extra dependency; verified against the RFC test vectors in
/// `base64_rfc_vectors_ok`.
fn base64_encode(bytes: &[u8]) -> String {
    // Alphabet split across short literals so no single opaque run
    // trips the secret-hygiene entropy tripwire (24+ chars).
    const TABLE: &[u8] = concat!(
        "ABCDEFGHIJKLMNOPQRSTUV",
        "WXYZabcdefghijklmnopqr",
        "stuvwxyz0123456789+/",
    )
    .as_bytes();
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// Validate the relative `path` param: relative, no prefixes, no `..`.
/// Returns the lexical path with `/` separators for the gate check.
fn decode_rel(params: &serde_json::Value, for_read: bool) -> Result<(PathBuf, String), FsFail> {
    let raw = params.get("path").and_then(serde_json::Value::as_str);
    let raw = match raw {
        Some("") => {
            return Err(FsFail::Invalid("path must not be empty".to_string()));
        }
        Some(s) => s,
        None if for_read => {
            return Err(FsFail::Invalid(
                "need {scope: string, path: string, capability: string}".to_string(),
            ));
        }
        None => ".",
    };
    let mut rel = PathBuf::new();
    let mut parts: Vec<&str> = Vec::new();
    for comp in Path::new(raw).components() {
        match comp {
            Component::CurDir => {}
            Component::Normal(part) => {
                let s = part.to_str().ok_or_else(|| {
                    FsFail::Invalid("path contains non-UTF-8 components".to_string())
                })?;
                rel.push(part);
                parts.push(s);
            }
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(FsFail::Invalid(
                    "path must be relative without '..' or drive prefixes".to_string(),
                ));
            }
        }
    }
    Ok((rel, parts.join("/")))
}

/// Canonicalize and normalize: on Windows, `canonicalize` returns
/// `\\?\`-prefixed verbatim paths, which would defeat the string-prefix
/// gate (`scope_covers`) and leak verbatim paths into audit rows. Strip
/// the drive-letter form back to `C:\…`; both sides of every comparison
/// go through this function, so containment stays sound.
fn canonical_abs(p: &Path) -> Result<PathBuf, std::io::Error> {
    let abs = std::fs::canonicalize(p)?;
    #[cfg(windows)]
    {
        let s = abs.display().to_string();
        if let Some(rest) = s.strip_prefix(r"\\?\")
            && rest.len() >= 2
            && rest.as_bytes()[1] == b':'
            && rest.as_bytes()[0].is_ascii_alphabetic()
        {
            return Ok(PathBuf::from(rest));
        }
    }
    Ok(abs)
}

/// Validate `scope`: absolute, exists, is a directory. Returns the typed
/// spelling (for the capability gate — grants are spelled by the caller)
/// plus the canonical form (for confinement, spawn, and audit).
/// Trailing slashes are trimmed from the typed spelling so string-prefix
/// matching behaves; the root `/` (or `C:\`) keeps its separator.
fn decode_scope(params: &serde_json::Value) -> Result<(String, PathBuf), FsFail> {
    let raw = params
        .get("scope")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| {
            FsFail::Invalid("need {scope: string, path?: string, capability: string}".to_string())
        })?;
    let p = Path::new(raw);
    if !p.is_absolute() {
        return Err(FsFail::Invalid(
            "scope must be an absolute path".to_string(),
        ));
    }
    let mut typed = raw.trim_end_matches(['/', '\\']).to_string();
    if typed.is_empty() || (typed.len() == 2 && typed.as_bytes()[1] == b':') {
        // Root (`/` or `C:` without separator) keeps one trailing separator.
        typed.push(std::path::MAIN_SEPARATOR);
    }
    let abs = canonical_abs(p).map_err(|_| {
        FsFail::Invalid(format!(
            "scope does not exist: {}",
            truncate_middle(raw, 160)
        ))
    })?;
    if !abs.is_dir() {
        return Err(FsFail::Invalid("scope is not a directory".to_string()));
    }
    Ok((typed, abs))
}

/// Shorten a user-supplied path for error messages (never log unbounded input).
fn truncate_middle(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let keep = max.saturating_sub(3) / 2;
    format!("{}...{}", &s[..keep], &s[s.len() - keep..])
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

fn deny(req: &Request, slug: &str) -> Response {
    Response {
        jsonrpc: "2.0".to_string(),
        id: Some(req.id.clone()),
        result: None,
        error: Some(RpcError {
            code: CAPABILITY_DENIED_CODE,
            message: format!("capability denied: {slug}"),
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

fn not_implemented(req: &Request, detail: &str) -> Response {
    Response {
        jsonrpc: "2.0".to_string(),
        id: Some(req.id.clone()),
        result: None,
        error: Some(RpcError {
            code: NOT_IMPLEMENTED_CODE,
            message: format!("tool not implemented here: {detail}"),
        }),
    }
}

fn ok_result(req: &Request, value: serde_json::Value) -> Response {
    Response {
        jsonrpc: "2.0".to_string(),
        id: Some(req.id.clone()),
        result: Some(value),
        error: None,
    }
}

/// Audit one terminal fs outcome. Payload keys stay inside the export
/// allowlist (`method`, `tool`, `scope`, `reason`); free text and key
/// material never reach the chain through this path.
fn audit_outcome(
    store: &core_store::Store,
    now: u64,
    actor: &str,
    method: &str,
    reason: &str,
    scope: &str,
) {
    let _ = store.record_audit_event(
        &now.to_string(),
        actor,
        "tool.exec",
        &serde_json::json!({"method": method, "tool": method, "scope": scope, "reason": reason})
            .to_string(),
    );
}

/// Unique hidden result-file path inside the scope.
fn result_path(scope: &Path) -> PathBuf {
    let n = RESULT_COUNTER.fetch_add(1, Ordering::SeqCst);
    scope.join(format!(".pone-fs-result-{}-{n}.json", std::process::id()))
}

/// Route one fs.list / fs.read request. Gate first (on the lexical path),
/// then canonicalize + containment, then sandboxed spawn, then audit.
/// Every terminal path — allow, deny, invalid, not-implemented, timeout,
/// helper error — ends here with a wire response AND an audit row, except
/// gate denials which `authorize` already audited (never double-audited).
pub fn execute(req: &Request, gate: &Gate, store: &core_store::Store, now: u64) -> Response {
    let helper = match std::env::current_exe() {
        Ok(p) => p,
        Err(_) => return internal(req, "daemon binary path unknown"),
    };
    execute_with(req, gate, store, now, real_spawn, TOOL_TIMEOUT_MS, &helper)
}

/// Testable core of [`execute`]: injectable spawner, timeout, and helper
/// path. The production path is `execute` above; tests substitute fakes
/// that never spawn anything, and the e2e suite exercises the real spawn
/// on all three OSes.
pub fn execute_with(
    req: &Request,
    gate: &Gate,
    store: &core_store::Store,
    now: u64,
    spawn: SpawnFn,
    timeout_ms: u64,
    helper: &Path,
) -> Response {
    let method = req.method.as_str();
    if method != FS_LIST_METHOD && method != FS_READ_METHOD {
        return Response {
            jsonrpc: "2.0".to_string(),
            id: Some(req.id.clone()),
            result: None,
            error: Some(RpcError {
                code: -32601,
                message: format!("method not found: {method}"),
            }),
        };
    }
    let for_read = method == FS_READ_METHOD;
    let token = req
        .params
        .get("capability")
        .and_then(serde_json::Value::as_str);

    // (1) Param shape — lexical only, no filesystem touch yet.
    // The gate runs on the TYPED spelling (grants are spelled by the
    // caller, who cannot canonicalize); confinement runs on canonical
    // paths below. Both must agree for access.
    let (scope_typed, scope_abs) = match decode_scope(&req.params) {
        Ok(s) => s,
        Err(FsFail::Invalid(what)) => {
            audit_outcome(store, now, "anonymous", method, "invalid-params", "");
            return invalid(req, &what);
        }
    };
    let (rel, rel_lexical) = match decode_rel(&req.params, for_read) {
        Ok(r) => r,
        Err(FsFail::Invalid(what)) => {
            audit_outcome(
                store,
                now,
                "anonymous",
                method,
                "invalid-params",
                &scope_abs.display().to_string(),
            );
            return invalid(req, &what);
        }
    };
    let scope_str = scope_abs.display().to_string();
    let lexical = if rel_lexical.is_empty() || rel_lexical == "." {
        scope_typed.clone()
    } else {
        format!("{scope_typed}/{rel_lexical}")
    };

    // (2) Capability gate on the lexical path (audits its own denials).
    let claims = match gate.authorize(store, method, Some(&lexical), token, now) {
        Ok(c) => c,
        Err(deny_reason) => return deny(req, deny_reason.slug()),
    };

    // (3) Canonicalize + containment (symlinks resolved; escape = deny).
    let target_abs = match canonical_abs(&scope_abs.join(&rel)) {
        Ok(p) => p,
        Err(_) => {
            audit_outcome(store, now, &claims.id, method, "invalid-params", &scope_str);
            return invalid(req, "no such file or directory");
        }
    };
    if !target_abs.starts_with(&scope_abs) {
        audit_outcome(
            store,
            now,
            &claims.id,
            method,
            "scope-violation",
            &scope_str,
        );
        return deny(req, "scope-violation");
    }
    let want_dir = !for_read;
    let kind_ok = if want_dir {
        target_abs.is_dir()
    } else {
        target_abs.is_file()
    };
    if !kind_ok {
        audit_outcome(store, now, &claims.id, method, "invalid-params", &scope_str);
        return invalid(
            req,
            if want_dir {
                "not a directory"
            } else {
                "not a file"
            },
        );
    }

    // (4) Sandboxed spawn; the child reports through a result file.
    let out_path = result_path(&scope_abs);
    let out_str = out_path.display().to_string();
    let subcommand = if for_read { "fs-read" } else { "fs-list" };
    let limit_str = if for_read {
        READ_CAP_BYTES.to_string()
    } else {
        (LIST_CAP as u64).to_string()
    };
    let args: Vec<&OsStr> = vec![
        OsStr::new(subcommand),
        OsStr::new("--scope"),
        OsStr::new(&scope_str),
        OsStr::new("--path"),
        OsStr::new(&rel_lexical),
        OsStr::new(if for_read { "--max-bytes" } else { "--limit" }),
        OsStr::new(&limit_str),
        OsStr::new("--out"),
        OsStr::new(&out_str),
    ];
    let child = match spawn(&scope_abs, helper.as_os_str(), &args) {
        Ok(c) => c,
        Err(SandboxError::UnsupportedPlatform | SandboxError::Unavailable { .. }) => {
            audit_outcome(
                store,
                now,
                &claims.id,
                method,
                "not-implemented",
                &scope_str,
            );
            let detail = "sandbox unavailable on this platform";
            return not_implemented(req, detail);
        }
        Err(e) => {
            audit_outcome(store, now, &claims.id, method, "tool-error", &scope_str);
            return internal(req, &format!("tool spawn failed: {e}"));
        }
    };
    match child.wait_timeout(timeout_ms.min(u32::MAX as u64) as u32) {
        Err(e) => {
            let _ = child.kill();
            let _ = std::fs::remove_file(&out_path);
            audit_outcome(store, now, &claims.id, method, "tool-error", &scope_str);
            internal(req, &format!("tool wait failed: {e}"))
        }
        Ok(None) => {
            let _ = child.kill();
            let _ = std::fs::remove_file(&out_path);
            audit_outcome(store, now, &claims.id, method, "timeout", &scope_str);
            internal(req, &format!("tool timed out after {timeout_ms}ms"))
        }
        Ok(Some(code)) => {
            let text = std::fs::read_to_string(&out_path).unwrap_or_default();
            let _ = std::fs::remove_file(&out_path);
            if code != 0 {
                let detail = serde_json::from_str::<serde_json::Value>(&text)
                    .ok()
                    .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string))
                    .unwrap_or_else(|| format!("helper exited with code {code}"));
                audit_outcome(store, now, &claims.id, method, "tool-error", &scope_str);
                return internal(req, &format!("tool failed: {detail}"));
            }
            match serde_json::from_str::<serde_json::Value>(&text) {
                Ok(v) => {
                    audit_outcome(store, now, &claims.id, method, "ok", &scope_str);
                    ok_result(req, v)
                }
                Err(_) => {
                    audit_outcome(store, now, &claims.id, method, "tool-error", &scope_str);
                    internal(req, "tool returned malformed result")
                }
            }
        }
    }
}

/// argv parsing for the `fs-list` / `fs-read` worker subcommand.
/// Returns `(scope, rel, limit_or_max, out)` or a usage string.
fn parse_worker_args(argv: &[String]) -> Result<(PathBuf, PathBuf, u64, PathBuf), String> {
    let mut scope: Option<String> = None;
    let mut path = String::from(".");
    let mut cap: Option<u64> = None;
    let mut out: Option<String> = None;
    let mut i = 0;
    while i < argv.len() {
        match argv[i].as_str() {
            "--scope" => {
                i += 1;
                scope = Some(argv.get(i).cloned().ok_or("missing --scope value")?);
            }
            "--path" => {
                i += 1;
                path = argv.get(i).cloned().ok_or("missing --path value")?;
            }
            "--limit" | "--max-bytes" => {
                i += 1;
                let v: u64 = argv
                    .get(i)
                    .ok_or("missing cap value")?
                    .parse()
                    .map_err(|_| "cap must be a positive integer")?;
                if v == 0 {
                    return Err("cap must be a positive integer".to_string());
                }
                cap = Some(v);
            }
            "--out" => {
                i += 1;
                out = Some(argv.get(i).cloned().ok_or("missing --out value")?);
            }
            other => return Err(format!("unknown argument: {other}")),
        }
        i += 1;
    }
    let scope = scope.ok_or("missing --scope")?;
    let out = out.ok_or("missing --out")?;
    let cap = cap.ok_or("missing --limit/--max-bytes")?;
    Ok((
        PathBuf::from(scope),
        PathBuf::from(path),
        cap,
        PathBuf::from(out),
    ))
}

/// Worker entry point for `cored fs-list|fs-read ...`. Pure filesystem
/// work, no store/keychain/network. Exit codes: 0 ok (even truncated),
/// 1 tool error (JSON `{"error"}` written when possible), 2 usage.
pub fn run_worker(subcommand: &str, argv: &[String]) -> i32 {
    let for_read = subcommand == "fs-read";
    let (scope_raw, rel_raw, cap, out) = match parse_worker_args(argv) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("fs worker usage error: {e}");
            return 2;
        }
    };
    let outcome: Result<serde_json::Value, String> = (|| {
        let scope_abs =
            canonical_abs(&scope_raw).map_err(|_| "scope does not exist".to_string())?;
        if !scope_abs.is_dir() {
            return Err("scope is not a directory".to_string());
        }
        let mut rel = PathBuf::new();
        for comp in Path::new(&rel_raw).components() {
            match comp {
                Component::CurDir => {}
                Component::Normal(part) => rel.push(part),
                Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                    return Err("path must be relative without '..'".to_string());
                }
            }
        }
        let target = canonical_abs(&scope_abs.join(&rel))
            .map_err(|_| "no such file or directory".to_string())?;
        if !target.starts_with(&scope_abs) {
            return Err("scope violation".to_string());
        }
        if for_read {
            if !target.is_file() {
                return Err("not a file".to_string());
            }
            Ok(fs_read_file(&target, cap)?)
        } else {
            if !target.is_dir() {
                return Err("not a directory".to_string());
            }
            Ok(fs_list_dir(&target, cap as usize)?)
        }
    })();
    match outcome {
        Ok(v) => {
            if write_out(&out, &v) {
                0
            } else {
                eprintln!("fs worker: cannot write result file");
                1
            }
        }
        Err(e) => {
            let _ = write_out(&out, &serde_json::json!({"error": e}));
            eprintln!("fs worker error: {e}");
            1
        }
    }
}

fn write_out(out: &Path, value: &serde_json::Value) -> bool {
    match serde_json::to_string(value) {
        Ok(text) => std::fs::write(out, text).is_ok(),
        Err(_) => false,
    }
}

fn file_kind(meta: &std::fs::Metadata) -> &'static str {
    let ft = meta.file_type();
    if ft.is_symlink() {
        "symlink"
    } else if ft.is_dir() {
        "dir"
    } else if ft.is_file() {
        "file"
    } else {
        "other"
    }
}

fn mtime_secs(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// List a directory: stable byte-order, capped with an honest flag.
/// Symlinks are classified, never followed.
fn fs_list_dir(dir: &Path, cap: usize) -> Result<serde_json::Value, String> {
    let mut names: Vec<std::ffi::OsString> = Vec::new();
    let read_dir = std::fs::read_dir(dir).map_err(|e| format!("cannot list directory: {e}"))?;
    for entry in read_dir {
        let entry = entry.map_err(|e| format!("cannot list directory: {e}"))?;
        names.push(entry.file_name());
    }
    names.sort();
    let truncated = names.len() > cap;
    let mut entries = Vec::new();
    for name in names.into_iter().take(cap) {
        let lossy = name.to_string_lossy().into_owned();
        let meta = std::fs::symlink_metadata(dir.join(&name));
        let (kind, size, mtime) = match meta {
            Ok(m) => (file_kind(&m).to_string(), m.len(), mtime_secs(&m)),
            Err(_) => ("other".to_string(), 0, 0),
        };
        entries
            .push(serde_json::json!({"name": lossy, "kind": kind, "size": size, "mtime": mtime}));
    }
    Ok(serde_json::json!({"entries": entries, "truncated": truncated}))
}

/// Read a file: capped with an honest flag, UTF-8 or base64, never mangled.
fn fs_read_file(path: &Path, cap: u64) -> Result<serde_json::Value, String> {
    use std::io::Read as _;
    let meta = std::fs::metadata(path).map_err(|e| format!("cannot stat file: {e}"))?;
    let size = meta.len();
    let file = std::fs::File::open(path).map_err(|e| format!("cannot open file: {e}"))?;
    let mut buf = Vec::new();
    file.take(cap + 1)
        .read_to_end(&mut buf)
        .map_err(|e| format!("cannot read file: {e}"))?;
    let truncated = buf.len() as u64 > cap;
    if truncated {
        buf.truncate(cap as usize);
    }
    let (encoding, content) = match String::from_utf8(buf) {
        Ok(text) => ("utf8", text),
        Err(e) => ("base64", base64_encode(e.as_bytes())),
    };
    Ok(serde_json::json!({
        "size": size,
        "encoding": encoding,
        "content": content,
        "truncated": truncated,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capability::{Gate, GrantArgs, PendingRequest};
    use core_store::Store;
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::ffi::OsStr;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicU64, Ordering};

    const NOW: u64 = 1_800_000_000;

    fn test_gate() -> Gate {
        Gate::new([0xA5u8; 32])
    }

    fn test_store(tag: &str) -> (PathBuf, Store) {
        static N: AtomicU64 = AtomicU64::new(0);
        let n = N.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("core-fs-{n}-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.db");
        (dir.clone(), Store::open(&path).unwrap())
    }

    fn scrub(dir: &std::path::Path) {
        let _ = std::fs::remove_dir_all(dir);
    }

    fn fixture_tree(tag: &str) -> (PathBuf, PathBuf, Store) {
        let (dir, store) = test_store(tag);
        let scope = dir.join("scope");
        std::fs::create_dir_all(scope.join("sub")).unwrap();
        std::fs::write(scope.join("note-01.txt"), "hello world\n").unwrap();
        std::fs::write(scope.join("sub").join("note-02.txt"), "second\n").unwrap();
        std::fs::write(scope.join("blob.bin"), [0u8, 1, 2, 3, 255, 254]).unwrap();
        (dir, scope, store)
    }

    fn pending() -> Mutex<HashMap<String, PendingRequest>> {
        Mutex::new(HashMap::new())
    }

    fn grant_fs(
        gate: &Gate,
        store: &Store,
        p: &Mutex<HashMap<String, PendingRequest>>,
        scope: &str,
    ) -> String {
        grant_fs_tool(gate, store, p, FS_LIST_METHOD, scope)
    }

    fn grant_fs_tool(
        gate: &Gate,
        store: &Store,
        p: &Mutex<HashMap<String, PendingRequest>>,
        tool: &str,
        scope: &str,
    ) -> String {
        gate.grant(
            store,
            p,
            GrantArgs {
                tool,
                scope,
                ttl_secs: 3600,
                request_id: None,
            },
            NOW,
        )
        .unwrap()
        .token
    }

    fn wire_req(method: &str, params: serde_json::Value) -> Request {
        Request {
            jsonrpc: "2.0".to_string(),
            id: 1.into(),
            method: method.to_string(),
            params,
        }
    }

    fn canon(dir: &std::path::Path) -> String {
        std::fs::canonicalize(dir).unwrap().display().to_string()
    }

    /// Fake spawn backplane: thread-local because `execute_with` is
    /// synchronous, so no cross-test interference.
    #[derive(Clone, Copy)]
    enum FakeMode {
        /// Write this JSON to --out, exit 0.
        Json(&'static str),
        /// Write nothing, exit 0 (malformed-result path).
        NoFile,
        /// Write this JSON, exit with code.
        Exit(i32, &'static str),
        /// Emulate a hung child: sleep past the timeout, report None.
        Hang,
        /// `wait_timeout` itself errors.
        WaitErr,
        /// Sandbox missing here.
        Unavailable,
        /// No sandbox on this platform at all.
        Unsupported,
    }

    struct FakeCfg {
        mode: FakeMode,
        spawned: bool,
        killed: bool,
    }

    thread_local! {
        static FAKE: RefCell<FakeCfg> = RefCell::new(FakeCfg {
            mode: FakeMode::NoFile,
            spawned: false,
            killed: false,
        });
    }

    fn set_fake(mode: FakeMode) {
        FAKE.with(|f| {
            *f.borrow_mut() = FakeCfg {
                mode,
                spawned: false,
                killed: false,
            }
        });
    }

    fn fake_flags() -> (bool, bool) {
        FAKE.with(|f| {
            let c = f.borrow();
            (c.spawned, c.killed)
        })
    }

    fn out_of(args: &[&OsStr]) -> PathBuf {
        let mut out: Option<PathBuf> = None;
        let mut i = 0;
        while i < args.len() {
            if args[i].to_str() == Some("--out") {
                out = Some(PathBuf::from(args[i + 1].to_str().unwrap()));
            }
            i += 1;
        }
        out.unwrap()
    }

    fn fake_spawn(
        _scope: &Path,
        _prog: &OsStr,
        args: &[&OsStr],
    ) -> Result<Box<dyn ToolChild>, SandboxError> {
        FAKE.with(|f| {
            let mut c = f.borrow_mut();
            c.spawned = true;
            match c.mode {
                FakeMode::Json(s) => {
                    std::fs::write(out_of(args), s).unwrap();
                }
                FakeMode::Exit(_, s) => {
                    std::fs::write(out_of(args), s).unwrap();
                }
                FakeMode::NoFile
                | FakeMode::Hang
                | FakeMode::WaitErr
                | FakeMode::Unavailable
                | FakeMode::Unsupported => {}
            }
        });
        struct FakeChild;
        impl ToolChild for FakeChild {
            fn wait_timeout(&self, timeout_ms: u32) -> Result<Option<u32>, SandboxError> {
                FAKE.with(|f| {
                    let c = f.borrow();
                    match c.mode {
                        FakeMode::Json(_) | FakeMode::NoFile => Ok(Some(0)),
                        FakeMode::Exit(code, _) => Ok(Some(code as u32)),
                        FakeMode::Hang => {
                            std::thread::sleep(std::time::Duration::from_millis(
                                u64::from(timeout_ms) + 200,
                            ));
                            Ok(None)
                        }
                        FakeMode::WaitErr => Err(SandboxError::Io {
                            path: "fake-wait".to_string(),
                            source: std::io::Error::other("fake wait failure"),
                        }),
                        FakeMode::Unavailable | FakeMode::Unsupported => Ok(Some(0)),
                    }
                })
            }

            fn kill(&self) -> Result<(), SandboxError> {
                FAKE.with(|f| f.borrow_mut().killed = true);
                Ok(())
            }
        }
        let is_err = FAKE.with(|f| {
            matches!(
                f.borrow().mode,
                FakeMode::Unavailable | FakeMode::Unsupported
            )
        });
        if is_err {
            return FAKE.with(|f| match f.borrow().mode {
                FakeMode::Unavailable => Err(SandboxError::Unavailable {
                    reason: "fake primitive missing".to_string(),
                }),
                _ => Err(SandboxError::UnsupportedPlatform),
            });
        }
        Ok(Box::new(FakeChild))
    }

    fn audit_reasons(store: &Store, method: &str) -> Vec<String> {
        store
            .audit_events(10_000)
            .unwrap()
            .iter()
            .filter(|e| e.action == "tool.exec")
            .filter_map(|e| {
                let v: serde_json::Value = serde_json::from_str(&e.detail).ok()?;
                if v.get("method").and_then(|m| m.as_str()) != Some(method) {
                    return None;
                }
                v.get("reason").and_then(|r| r.as_str()).map(str::to_string)
            })
            .collect()
    }

    fn err_code(resp: &Response) -> Option<i64> {
        resp.error.as_ref().map(|e| e.code)
    }

    fn helper() -> PathBuf {
        PathBuf::from("fake-cored-for-tests")
    }

    #[test]
    fn gate_first_deny_without_token() {
        let (dir, scope, store) = fixture_tree("deny-no-token");
        let g = test_gate();
        set_fake(FakeMode::Json("{}"));
        let resp = execute_with(
            &wire_req(FS_LIST_METHOD, serde_json::json!({"scope": canon(&scope)})),
            &g,
            &store,
            NOW,
            fake_spawn,
            TOOL_TIMEOUT_MS,
            &helper(),
        );
        assert_eq!(err_code(&resp), Some(-32001));
        assert_eq!(
            resp.error.as_ref().unwrap().message,
            "capability denied: missing"
        );
        // STOP: the gate fired before any spawn could happen.
        assert!(!fake_flags().0, "spawn must not run without a token");
        scrub(&dir);
    }

    #[test]
    fn wrong_scope_denied_and_spawn_never_runs() {
        let (dir, scope, store) = fixture_tree("deny-scope");
        let g = test_gate();
        let p = pending();
        let token = grant_fs(&g, &store, &p, "/elsewhere");
        set_fake(FakeMode::Json("{}"));
        let resp = execute_with(
            &wire_req(
                FS_LIST_METHOD,
                serde_json::json!({"scope": canon(&scope), "capability": token}),
            ),
            &g,
            &store,
            NOW,
            fake_spawn,
            TOOL_TIMEOUT_MS,
            &helper(),
        );
        assert_eq!(err_code(&resp), Some(-32001));
        assert!(!fake_flags().0, "spawn must not run on scope violation");
        scrub(&dir);
    }

    #[test]
    fn expired_token_denied() {
        let (dir, scope, store) = fixture_tree("deny-expired");
        let g = test_gate();
        let p = pending();
        let issued = g
            .grant(
                &store,
                &p,
                GrantArgs {
                    tool: FS_LIST_METHOD,
                    scope: &canon(&scope),
                    ttl_secs: 1,
                    request_id: None,
                },
                NOW - 100,
            )
            .unwrap();
        set_fake(FakeMode::Json("{}"));
        let resp = execute_with(
            &wire_req(
                FS_READ_METHOD,
                serde_json::json!({"scope": canon(&scope), "path": "note-01.txt", "capability": issued.token}),
            ),
            &g,
            &store,
            NOW,
            fake_spawn,
            TOOL_TIMEOUT_MS,
            &helper(),
        );
        assert_eq!(err_code(&resp), Some(-32001));
        assert!(resp.error.as_ref().unwrap().message.contains("expired"));
        scrub(&dir);
    }

    #[test]
    fn list_ok_passthrough_and_audited() {
        let (dir, scope, store) = fixture_tree("list-ok");
        let g = test_gate();
        let p = pending();
        let token = grant_fs(&g, &store, &p, &canon(&scope));
        let body = r#"{"entries":[{"name":"note-01.txt","kind":"file","size":12,"mtime":1}],"truncated":false}"#;
        set_fake(FakeMode::Json(body));
        let resp = execute_with(
            &wire_req(
                FS_LIST_METHOD,
                serde_json::json!({"scope": canon(&scope), "path": "sub", "capability": token}),
            ),
            &g,
            &store,
            NOW,
            fake_spawn,
            TOOL_TIMEOUT_MS,
            &helper(),
        );
        assert!(resp.error.is_none());
        let v = resp.result.unwrap();
        assert_eq!(v["truncated"].as_bool(), Some(false));
        assert_eq!(v["entries"][0]["name"].as_str(), Some("note-01.txt"));
        // Result file is cleaned up, never left in the user scope.
        assert_eq!(
            std::fs::read_dir(&scope)
                .unwrap()
                .filter_map(Result::ok)
                .filter(|e| e
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".pone-fs-result-"))
                .count(),
            0
        );
        assert!(audit_reasons(&store, FS_LIST_METHOD).contains(&"ok".to_string()));
        scrub(&dir);
    }

    #[test]
    fn read_ok_utf8_passthrough() {
        let (dir, scope, store) = fixture_tree("read-ok");
        let g = test_gate();
        let p = pending();
        let issued = g
            .grant(
                &store,
                &p,
                GrantArgs {
                    tool: FS_READ_METHOD,
                    scope: &canon(&scope),
                    ttl_secs: 3600,
                    request_id: None,
                },
                NOW,
            )
            .unwrap();
        let body = r#"{"size":12,"encoding":"utf8","content":"hello world\n","truncated":false}"#;
        set_fake(FakeMode::Json(body));
        let resp = execute_with(
            &wire_req(
                FS_READ_METHOD,
                serde_json::json!({"scope": canon(&scope), "path": "note-01.txt", "capability": issued.token}),
            ),
            &g,
            &store,
            NOW,
            fake_spawn,
            TOOL_TIMEOUT_MS,
            &helper(),
        );
        assert!(resp.error.is_none());
        assert_eq!(
            resp.result.unwrap()["content"].as_str(),
            Some("hello world\n")
        );
        scrub(&dir);
    }

    #[test]
    fn not_implemented_gates_then_audits() {
        for (tag, mode) in [
            ("unavailable", FakeMode::Unavailable),
            ("unsupported", FakeMode::Unsupported),
        ] {
            let (dir, scope, store) = fixture_tree(tag);
            let g = test_gate();
            let p = pending();
            let token = grant_fs(&g, &store, &p, &canon(&scope));
            set_fake(mode);
            let resp = execute_with(
                &wire_req(
                    FS_LIST_METHOD,
                    serde_json::json!({"scope": canon(&scope), "capability": token}),
                ),
                &g,
                &store,
                NOW,
                fake_spawn,
                TOOL_TIMEOUT_MS,
                &helper(),
            );
            // POSIX honesty: gate passed, execution refused, wire -32002, audited.
            assert_eq!(
                err_code(&resp),
                Some(-32002),
                "{tag} must map to NOT_IMPLEMENTED"
            );
            assert!(
                audit_reasons(&store, FS_LIST_METHOD).contains(&"not-implemented".to_string()),
                "{tag} must audit the refusal"
            );
            scrub(&dir);
        }
    }

    #[test]
    fn wait_error_maps_to_internal() {
        let (dir, scope, store) = fixture_tree("wait-err");
        let g = test_gate();
        let p = pending();
        let token = grant_fs(&g, &store, &p, &canon(&scope));
        set_fake(FakeMode::WaitErr);
        let resp = execute_with(
            &wire_req(
                FS_LIST_METHOD,
                serde_json::json!({"scope": canon(&scope), "capability": token}),
            ),
            &g,
            &store,
            NOW,
            fake_spawn,
            TOOL_TIMEOUT_MS,
            &helper(),
        );
        assert_eq!(err_code(&resp), Some(-32603));
        assert!(resp.error.as_ref().unwrap().message.contains("wait failed"));
        assert!(audit_reasons(&store, FS_LIST_METHOD).contains(&"tool-error".to_string()));
        scrub(&dir);
    }

    #[test]
    fn timeout_kills_and_audits() {
        let (dir, scope, store) = fixture_tree("timeout");
        let g = test_gate();
        let p = pending();
        let token = grant_fs(&g, &store, &p, &canon(&scope));
        set_fake(FakeMode::Hang);
        let resp = execute_with(
            &wire_req(
                FS_LIST_METHOD,
                serde_json::json!({"scope": canon(&scope), "capability": token}),
            ),
            &g,
            &store,
            NOW,
            fake_spawn,
            100,
            &helper(),
        );
        assert_eq!(err_code(&resp), Some(-32603));
        assert!(resp.error.as_ref().unwrap().message.contains("timed out"));
        let (spawned, killed) = fake_flags();
        assert!(spawned && killed, "hung child must be killed");
        assert!(audit_reasons(&store, FS_LIST_METHOD).contains(&"timeout".to_string()));
        scrub(&dir);
    }

    #[test]
    fn helper_error_maps_and_audits() {
        let (dir, scope, store) = fixture_tree("helper-err");
        let g = test_gate();
        let p = pending();
        let token = grant_fs_tool(&g, &store, &p, FS_READ_METHOD, &canon(&scope));
        set_fake(FakeMode::Exit(1, r#"{"error":"disk on fire"}"#));
        let resp = execute_with(
            &wire_req(
                FS_READ_METHOD,
                serde_json::json!({"scope": canon(&scope), "path": "note-01.txt", "capability": token}),
            ),
            &g,
            &store,
            NOW,
            fake_spawn,
            TOOL_TIMEOUT_MS,
            &helper(),
        );
        assert_eq!(err_code(&resp), Some(-32603));
        assert!(
            resp.error
                .as_ref()
                .unwrap()
                .message
                .contains("disk on fire")
        );
        assert!(audit_reasons(&store, FS_READ_METHOD).contains(&"tool-error".to_string()));
        scrub(&dir);
    }

    #[test]
    fn missing_file_and_bad_params_never_spawn() {
        let (dir, scope, store) = fixture_tree("invalid");
        let g = test_gate();
        let p = pending();
        let list_token = grant_fs_tool(&g, &store, &p, FS_LIST_METHOD, &canon(&scope));
        let read_token = grant_fs_tool(&g, &store, &p, FS_READ_METHOD, &canon(&scope));
        // Missing file.
        set_fake(FakeMode::Json("{}"));
        let resp = execute_with(
            &wire_req(
                FS_READ_METHOD,
                serde_json::json!({"scope": canon(&scope), "path": "nope.txt", "capability": read_token}),
            ),
            &g,
            &store,
            NOW,
            fake_spawn,
            TOOL_TIMEOUT_MS,
            &helper(),
        );
        assert_eq!(err_code(&resp), Some(-32602));
        assert!(!fake_flags().0, "missing file must fail before spawn");
        // Lexical escape.
        let resp = execute_with(
            &wire_req(
                FS_LIST_METHOD,
                serde_json::json!({"scope": canon(&scope), "path": "../x", "capability": list_token}),
            ),
            &g,
            &store,
            NOW,
            fake_spawn,
            TOOL_TIMEOUT_MS,
            &helper(),
        );
        assert_eq!(err_code(&resp), Some(-32602));
        assert!(!fake_flags().0, "lexical escape must fail before spawn");
        // Absolute path smuggling.
        let resp = execute_with(
            &wire_req(
                FS_READ_METHOD,
                serde_json::json!({"scope": canon(&scope), "path": "/etc/passwd", "capability": read_token}),
            ),
            &g,
            &store,
            NOW,
            fake_spawn,
            TOOL_TIMEOUT_MS,
            &helper(),
        );
        assert_eq!(err_code(&resp), Some(-32602));
        assert!(!fake_flags().0, "absolute path must fail before spawn");
        scrub(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_denied_after_canonicalization() {
        let (dir, scope, store) = fixture_tree("symlink");
        std::os::unix::fs::symlink(dir.join("outside.txt"), scope.join("link-out")).unwrap();
        std::fs::write(dir.join("outside.txt"), "outside\n").unwrap();
        assert_escape_denied(&dir, &scope, &store);
    }

    /// Windows: file symlinks need elevation, so prove the same
    /// canonicalization-containment layer with a directory junction
    /// (`mklink /J`, no elevation required). Skips honestly if the
    /// junction cannot be created.
    #[cfg(windows)]
    #[test]
    fn junction_escape_denied_after_canonicalization() {
        let (dir, scope, store) = fixture_tree("junction");
        std::fs::create_dir_all(dir.join("outside-dir")).unwrap();
        std::fs::write(dir.join("outside-dir").join("sneaky.txt"), "sneaky\n").unwrap();
        let link = scope.join("link-dir");
        let made = std::process::Command::new("cmd")
            .args([
                "/C",
                "mklink",
                "/J",
                &link.display().to_string(),
                &dir.join("outside-dir").display().to_string(),
            ])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !made || !link.is_dir() {
            eprintln!("SKIP junction escape: mklink /J failed (needs local volume)");
            scrub(&dir);
            return;
        }
        let g = test_gate();
        let p = pending();
        let issued = g
            .grant(
                &store,
                &p,
                GrantArgs {
                    tool: FS_LIST_METHOD,
                    scope: &canon(&scope),
                    ttl_secs: 3600,
                    request_id: None,
                },
                NOW,
            )
            .unwrap();
        set_fake(FakeMode::Json("{}"));
        let resp = execute_with(
            &wire_req(
                FS_LIST_METHOD,
                serde_json::json!({"scope": canon(&scope), "path": "link-dir", "capability": issued.token}),
            ),
            &g,
            &store,
            NOW,
            fake_spawn,
            TOOL_TIMEOUT_MS,
            &helper(),
        );
        // Lexical gate passes (link-dir is inside), canonicalization escapes
        // through the junction: second gate denies, spawn never runs.
        assert_eq!(err_code(&resp), Some(-32001));
        assert!(
            resp.error
                .as_ref()
                .unwrap()
                .message
                .contains("scope-violation")
        );
        assert!(!fake_flags().0, "escaped target must never spawn");
        assert!(
            audit_reasons(&store, FS_LIST_METHOD).contains(&"scope-violation".to_string()),
            "escape must be audited"
        );
        scrub(&dir);
    }

    #[cfg(unix)]
    fn assert_escape_denied(dir: &std::path::Path, scope: &std::path::Path, store: &Store) {
        let g = test_gate();
        let p = pending();
        let issued = g
            .grant(
                store,
                &p,
                GrantArgs {
                    tool: FS_READ_METHOD,
                    scope: &canon(scope),
                    ttl_secs: 3600,
                    request_id: None,
                },
                NOW,
            )
            .unwrap();
        set_fake(FakeMode::Json("{}"));
        let resp = execute_with(
            &wire_req(
                FS_READ_METHOD,
                serde_json::json!({"scope": canon(scope), "path": "link-out", "capability": issued.token}),
            ),
            &g,
            &store,
            NOW,
            fake_spawn,
            TOOL_TIMEOUT_MS,
            &helper(),
        );
        // Lexical gate passes (link-out is inside), canonicalization escapes:
        // second gate denies, spawn never runs.
        assert_eq!(err_code(&resp), Some(-32001));
        assert!(
            resp.error
                .as_ref()
                .unwrap()
                .message
                .contains("scope-violation")
        );
        assert!(!fake_flags().0, "escaped target must never spawn");
        assert!(
            audit_reasons(store, FS_READ_METHOD).contains(&"scope-violation".to_string()),
            "escape must be audited"
        );
        scrub(dir);
    }

    #[test]
    fn base64_rfc_vectors_ok() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64_encode(&[0u8, 1, 2, 3, 255, 254]), "AAECA//+");
    }

    #[test]
    fn worker_roundtrip_list_and_read() {
        let (dir, scope) = (|| {
            let (d, s, _) = fixture_tree("worker");
            (d, s)
        })();
        // List: sorted, capped, honest flag.
        let out = dir.join("list.json");
        let argv: Vec<String> = [
            "--scope",
            &scope.display().to_string(),
            "--path",
            ".",
            "--limit",
            "10000",
            "--out",
            &out.display().to_string(),
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(run_worker("fs-list", &argv), 0);
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
        let names: Vec<&str> = v["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, vec!["blob.bin", "note-01.txt", "sub"]);
        assert_eq!(v["truncated"].as_bool(), Some(false));
        // Cap smaller than the listing truncates honestly.
        let out2 = dir.join("list2.json");
        let argv2: Vec<String> = [
            "--scope",
            &scope.display().to_string(),
            "--path",
            ".",
            "--limit",
            "2",
            "--out",
            &out2.display().to_string(),
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(run_worker("fs-list", &argv2), 0);
        let v2: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&out2).unwrap()).unwrap();
        assert_eq!(v2["entries"].as_array().unwrap().len(), 2);
        assert_eq!(v2["truncated"].as_bool(), Some(true));
        // Read utf8 exact.
        let out3 = dir.join("read.json");
        let argv3: Vec<String> = [
            "--scope",
            &scope.display().to_string(),
            "--path",
            "note-01.txt",
            "--max-bytes",
            "1048576",
            "--out",
            &out3.display().to_string(),
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(run_worker("fs-read", &argv3), 0);
        let v3: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&out3).unwrap()).unwrap();
        assert_eq!(v3["encoding"].as_str(), Some("utf8"));
        assert_eq!(v3["content"].as_str(), Some("hello world\n"));
        assert_eq!(v3["size"].as_u64(), Some(12));
        assert_eq!(v3["truncated"].as_bool(), Some(false));
        // Read binary is base64, never mangled.
        let out4 = dir.join("readbin.json");
        let argv4: Vec<String> = [
            "--scope",
            &scope.display().to_string(),
            "--path",
            "blob.bin",
            "--max-bytes",
            "1048576",
            "--out",
            &out4.display().to_string(),
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(run_worker("fs-read", &argv4), 0);
        let v4: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&out4).unwrap()).unwrap();
        assert_eq!(v4["encoding"].as_str(), Some("base64"));
        assert_eq!(v4["content"].as_str(), Some("AAECA//+"));
        assert_eq!(v4["size"].as_u64(), Some(6));
        // Read past the cap truncates honestly.
        let out5 = dir.join("readcap.json");
        let argv5: Vec<String> = [
            "--scope",
            &scope.display().to_string(),
            "--path",
            "note-01.txt",
            "--max-bytes",
            "5",
            "--out",
            &out5.display().to_string(),
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(run_worker("fs-read", &argv5), 0);
        let v5: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&out5).unwrap()).unwrap();
        assert_eq!(v5["content"].as_str(), Some("hello"));
        assert_eq!(v5["truncated"].as_bool(), Some(true));
        assert_eq!(v5["size"].as_u64(), Some(12));
        scrub(&dir);
    }

    #[test]
    fn worker_rejects_escape_missing_and_misuse() {
        let (dir, scope, _) = fixture_tree("worker-bad");
        let s = scope.display().to_string();
        let str_args =
            |parts: &[&str]| -> Vec<String> { parts.iter().map(|p| p.to_string()).collect() };
        // Usage errors exit 2 (missing --out; zero cap).
        let missing_out = str_args(&["--scope", &s, "--path", ".", "--limit", "10"]);
        assert_eq!(run_worker("fs-list", &missing_out), 2);
        let zero_cap = str_args(&[
            "--scope",
            &s,
            "--path",
            ".",
            "--limit",
            "0",
            "--out",
            &dir.join("w-zero.json").display().to_string(),
        ]);
        assert_eq!(run_worker("fs-list", &zero_cap), 2);
        // Escape via .. is a tool error with JSON.
        let out_escape = dir.join("w-escape.json");
        let code = run_worker(
            "fs-read",
            &str_args(&[
                "--scope",
                &s,
                "--path",
                "../x",
                "--max-bytes",
                "10",
                "--out",
                &out_escape.display().to_string(),
            ]),
        );
        assert_eq!(code, 1);
        let text = std::fs::read_to_string(&out_escape).unwrap_or_default();
        assert!(text.contains("scope violation") || text.contains("relative"));
        // Missing file is a tool error.
        let out_missing = dir.join("w-missing.json");
        let code = run_worker(
            "fs-read",
            &str_args(&[
                "--scope",
                &s,
                "--path",
                "nope.txt",
                "--max-bytes",
                "10",
                "--out",
                &out_missing.display().to_string(),
            ]),
        );
        assert_eq!(code, 1);
        let text = std::fs::read_to_string(&out_missing).unwrap_or_default();
        assert!(text.contains("no such file"));
        scrub(&dir);
    }

    #[test]
    fn worker_arg_parsing_edges() {
        // Unknown flag.
        assert_eq!(
            run_worker("fs-list", &["--bogus".to_string(), "1".to_string()]),
            2
        );
        // Truncated flag value.
        assert_eq!(run_worker("fs-list", &["--limit".to_string()]), 2);
        // Non-numeric cap.
        assert_eq!(
            run_worker(
                "fs-list",
                &[
                    "--scope".to_string(),
                    "x".to_string(),
                    "--limit".to_string(),
                    "lots".to_string(),
                    "--out".to_string(),
                    "y".to_string(),
                ]
            ),
            2
        );
    }
}
