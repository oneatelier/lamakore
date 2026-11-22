//! cored socket server: single instance, handshake gate, allowlisted status
//! and capability-issuance methods, and DEFAULT-DENY dispatch for everything
//! else (see `crate::capability`).
//!
//! Transport is local-only on every platform: Unix domain sockets on
//! macOS/Linux, named pipes on Windows. There is deliberately no TCP
//! listener anywhere in this codebase.

use crate::capability::{self, Gate, PendingRequest};
use core_protocol::brand;
use core_protocol::events::{RING_CAPACITY, RingBuffer};
use core_protocol::wire::{
    self, Ack, Event, EventParams, HANDSHAKE_TIMEOUT_SECS, Handshake, HandshakeResponse,
    PROTOCOL_ID, PROTOCOL_VERSION, Request, Response, RpcError,
};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::watch;

/// Daemon configuration. The session token arrives via `PONE_WIRE_TOKEN`
/// and is never logged. The capability root key is loaded once from the OS
/// keychain and shared read-only; each connection opens its own store.
pub struct ServerConfig {
    pub socket_path: PathBuf,
    pub spill_path: PathBuf,
    pub token: String,
    pub build: String,
    pub started: Instant,
    pub root_key: [u8; 32],
    pub db_path: PathBuf,
    pub pending_requests: Mutex<HashMap<String, PendingRequest>>,
}

/// Bind the single-instance listener. A live peer on the address means
/// another daemon owns it; a stale socket file is reclaimed.
pub async fn run(
    cfg: ServerConfig,
    mut shutdown: watch::Receiver<bool>,
) -> Result<(), wire::WireError> {
    #[cfg(unix)]
    {
        run_unix(cfg, &mut shutdown).await
    }
    #[cfg(windows)]
    {
        run_pipe(cfg, &mut shutdown).await
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (cfg, shutdown);
        Err(wire::WireError::Protocol(
            "unsupported platform".to_string(),
        ))
    }
}

#[cfg(unix)]
async fn run_unix(
    cfg: ServerConfig,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<(), wire::WireError> {
    use tokio::net::UnixListener;
    let listener = match UnixListener::bind(&cfg.socket_path) {
        Ok(l) => l,
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            // Live peer? Then we are the second instance. Refused? Stale file.
            match tokio::net::UnixStream::connect(&cfg.socket_path).await {
                Ok(_) => {
                    return Err(wire::WireError::AlreadyRunning(format!(
                        "socket {} is owned by a live daemon",
                        cfg.socket_path.display()
                    )));
                }
                Err(_) => {
                    std::fs::remove_file(&cfg.socket_path).map_err(wire::WireError::Io)?;
                    UnixListener::bind(&cfg.socket_path).map_err(wire::WireError::Io)?
                }
            }
        }
        Err(e) => return Err(wire::WireError::Io(e)),
    };
    let cfg = std::sync::Arc::new(cfg);
    loop {
        tokio::select! {
            _ = shutdown.changed() => break,
            accepted = listener.accept() => {
                let (stream, _) = accepted.map_err(wire::WireError::Io)?;
                let cfg = cfg.clone();
                let mut rx = shutdown.clone();
                tokio::spawn(async move {
                    let _ = serve(stream, cfg, &mut rx).await;
                });
            }
        }
    }
    Ok(())
}

#[cfg(windows)]
async fn run_pipe(
    cfg: ServerConfig,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<(), wire::WireError> {
    use tokio::net::windows::named_pipe::ServerOptions;
    let cfg = std::sync::Arc::new(cfg);
    loop {
        let server = match ServerOptions::new().create(cfg.socket_path.as_os_str()) {
            Ok(s) => s,
            Err(e) => {
                // ERROR_PIPE_BUSY (231) or AlreadyExists means a live owner
                // exists; anything else (bad path, ACL) is fatal, not a conflict.
                let busy =
                    e.raw_os_error() == Some(231) || e.kind() == std::io::ErrorKind::AlreadyExists;
                if busy {
                    return Err(wire::WireError::AlreadyRunning(format!(
                        "pipe {} is owned by a live daemon",
                        cfg.socket_path.display()
                    )));
                }
                return Err(wire::WireError::Io(e));
            }
        };
        tokio::select! {
            _ = shutdown.changed() => break,
            connected = server.connect() => {
                connected.map_err(wire::WireError::Io)?;
                let cfg = cfg.clone();
                let mut rx = shutdown.clone();
                tokio::spawn(async move {
                    let _ = serve(server, cfg, &mut rx).await;
                });
            }
        }
    }
    Ok(())
}

async fn serve<S>(
    mut stream: S,
    cfg: std::sync::Arc<ServerConfig>,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<(), wire::WireError>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let first = tokio::time::timeout(
        Duration::from_secs(HANDSHAKE_TIMEOUT_SECS),
        wire::read_frame(&mut stream),
    )
    .await
    .map_err(|_| wire::WireError::Refused("handshake timeout".to_string()))??;
    let hello: Handshake = serde_json::from_value(first)
        .map_err(|_| wire::WireError::Refused("first frame is not a handshake".to_string()))?;
    if let Err(reason) = wire::check_handshake(&hello, &cfg.token, &cfg.build) {
        let resp = HandshakeResponse {
            ok: false,
            error: Some(reason),
            protocol: PROTOCOL_ID.to_string(),
            version: PROTOCOL_VERSION,
            build: cfg.build.clone(),
        };
        let _ = wire::write_frame(&mut stream, &resp).await;
        return Err(wire::WireError::Refused("handshake rejected".to_string()));
    }
    let resp = HandshakeResponse {
        ok: true,
        error: None,
        protocol: PROTOCOL_ID.to_string(),
        version: PROTOCOL_VERSION,
        build: cfg.build.clone(),
    };
    wire::write_frame(&mut stream, &resp).await?;

    // Each connection gets its own store handle (WAL-safe, no cross-task
    // locking) and a gate bound to the daemon root key. A store failure
    // closes the connection: never serve without enforcement.
    let store = match core_store::Store::open(&cfg.db_path) {
        Ok(s) => s,
        Err(e) => return Err(store_io_err(e)),
    };
    let gate = Gate::new(cfg.root_key);

    let mut ring = RingBuffer::new(RING_CAPACITY, cfg.spill_path.clone());
    let mut ready = Event {
        jsonrpc: "2.0".to_string(),
        method: "event".to_string(),
        params: EventParams {
            seq: 0,
            topic: "daemon.ready".to_string(),
            data: json!({ "build": cfg.build }),
        },
    };
    let seq = ring.push(ready.clone()).map_err(wire::WireError::Io)?;
    ready.params.seq = seq;
    wire::write_frame(&mut stream, &ready).await?;

    loop {
        let frame = tokio::select! {
            _ = shutdown.changed() => break,
            f = wire::read_frame(&mut stream) => f,
        };
        let frame = match frame {
            Ok(v) => v,
            Err(wire::WireError::Closed) => break,
            Err(e) => return Err(e),
        };
        let is_ack = frame.get("method").and_then(|m| m.as_str()) == Some("ack")
            && frame.get("id").is_none();
        if is_ack {
            if let Ok(ack) = serde_json::from_value::<Ack>(frame) {
                ring.ack(&ack.params);
            }
            continue;
        }
        let req: Request = match serde_json::from_value(frame) {
            Ok(r) => r,
            Err(_) => continue,
        };
        if req.jsonrpc != "2.0" {
            continue;
        }
        let resp = dispatch(&req, &cfg, &gate, &store, capability::now_secs());
        wire::write_frame(&mut stream, &resp).await?;
    }
    Ok(())
}

/// Map a store failure to a wire error (fail closed, no details leak).
fn store_io_err(e: core_store::StoreError) -> wire::WireError {
    match e {
        core_store::StoreError::Io { source, .. } => wire::WireError::Io(source),
        other => wire::WireError::Io(std::io::Error::other(other.to_string())),
    }
}

fn method_not_found(req: &Request) -> Response {
    Response {
        jsonrpc: "2.0".to_string(),
        id: Some(req.id.clone()),
        result: None,
        error: Some(RpcError {
            code: -32601,
            message: format!("method not found: {}", req.method),
        }),
    }
}

/// Route one request. `system.health`/`system.info` and the `capability.*`
/// issuance plane need no token. EVERY other method — known or not — must
/// present a valid capability or it is refused with CAPABILITY_DENIED and
/// audited. Authorization success on an unimplemented method still yields
/// method-not-found: gating and dispatch are separate layers.
fn dispatch(
    req: &Request,
    cfg: &ServerConfig,
    gate: &Gate,
    store: &core_store::Store,
    now: Result<u64, capability::CapError>,
) -> Response {
    match req.method.as_str() {
        "system.health" => Response {
            jsonrpc: "2.0".to_string(),
            id: Some(req.id.clone()),
            result: Some(json!({
                "ok": true,
                "uptime_s": cfg.started.elapsed().as_secs(),
                "protocol": PROTOCOL_ID,
                "version": PROTOCOL_VERSION,
            })),
            error: None,
        },
        "system.info" => Response {
            jsonrpc: "2.0".to_string(),
            id: Some(req.id.clone()),
            result: Some(json!({
                "product": brand::PRODUCT_NAME,
                "codename": brand::CODENAME,
                "daemon": brand::DAEMON_BINARY,
                "copyright": brand::COPYRIGHT_HOLDER,
                "protocol": PROTOCOL_ID,
                "version": PROTOCOL_VERSION,
                "build": cfg.build,
                "pid": std::process::id(),
                "publish_blocked": brand::PUBLISH_BLOCKED,
            })),
            error: None,
        },
        m if capability::ISSUANCE_METHODS.contains(&m) => {
            let now = match now {
                Ok(n) => n,
                Err(e) => {
                    return Response {
                        jsonrpc: "2.0".to_string(),
                        id: Some(req.id.clone()),
                        result: None,
                        error: Some(RpcError {
                            code: -32603,
                            message: format!("internal error: {e}"),
                        }),
                    };
                }
            };
            capability::handle_capability(req, &cfg.pending_requests, gate, store, now)
        }
        _ => {
            let now = match now {
                Ok(n) => n,
                Err(e) => {
                    return Response {
                        jsonrpc: "2.0".to_string(),
                        id: Some(req.id.clone()),
                        result: None,
                        error: Some(RpcError {
                            code: -32603,
                            message: format!("internal error: {e}"),
                        }),
                    };
                }
            };
            let path = req.params.get("path").and_then(Value::as_str);
            let token = req.params.get("capability").and_then(Value::as_str);
            match gate.authorize(store, &req.method, path, token, now) {
                Ok(_) => method_not_found(req),
                Err(deny) => Response {
                    jsonrpc: "2.0".to_string(),
                    id: Some(req.id.clone()),
                    result: None,
                    error: Some(RpcError {
                        code: capability::CAPABILITY_DENIED_CODE,
                        message: format!("capability denied: {}", deny.slug()),
                    }),
                },
            }
        }
    }
}

#[cfg(all(test, feature = "mock-keyring"))]
mod gate_matrix_tests {
    //! Exhaustive proof that no dispatch path bypasses the capability gate.
    //!
    //! The method space that reaches `dispatch` is finite: the six
    //! allowlisted methods plus anything else a peer can spell (the gate arm
    //! is total — there is no third arm). For every non-allowlisted method we
    //! try every capability state (absent, valid, wrong-tool, expired,
    //! tampered, revoked) on in-scope and out-of-scope paths, plus a
    //! dedicated scope-violation dispatch below.
    //! Exactly one combination may pass the gate (valid token, matching tool,
    //! covering path), and even it must fail closed with method-not-found
    //! because no tool implementation exists behind the gate yet. Sampling
    //! cannot add anything here: the matrix IS the whole input space shape.

    use super::*;
    use crate::capability::{GrantArgs, MockProvider};
    use capability::KeyProvider as _;
    use core_store::Store;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TAG_COUNTER: AtomicU64 = AtomicU64::new(0);
    const NOW: u64 = 1_800_000_000;

    fn harness(tag: &str) -> (PathBuf, Store, ServerConfig, Gate) {
        let n = TAG_COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "core-cap-dispatch-{}-{n}-{tag}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::open(&dir.join("test.db")).unwrap();
        let key = MockProvider::fixed_test_key().load_or_create_key().unwrap();
        let cfg = ServerConfig {
            socket_path: dir.join("sock"),
            spill_path: dir.join("spill.log"),
            token: "test-session".to_string(),
            build: "test".to_string(),
            started: Instant::now(),
            root_key: key,
            db_path: dir.join("test.db"),
            pending_requests: Mutex::new(HashMap::new()),
        };
        (dir, store, cfg, Gate::new(key))
    }

    fn req(method: &str, params: Value) -> Request {
        Request {
            jsonrpc: "2.0".to_string(),
            id: 1.into(),
            method: method.to_string(),
            params,
        }
    }

    fn err_code(resp: &Response) -> Option<i64> {
        resp.error.as_ref().map(|e| e.code)
    }

    #[test]
    fn allowlisted_methods_need_no_token() {
        let (dir, store, cfg, gate) = harness("allow");
        let gate = &gate;
        // Even garbage or hostile capability values must not matter here.
        let hostile = vec![
            Value::Null,
            json!({}),
            json!({"capability": "forged", "path": "/etc/passwd"}),
        ];
        for method in ["system.health", "system.info"] {
            for params in &hostile {
                let r = dispatch(&req(method, params.clone()), &cfg, gate, &store, Ok(NOW));
                assert!(r.error.is_none(), "{method} must succeed without a token");
                assert!(r.result.is_some(), "{method} must return a result");
            }
        }
        // The issuance plane needs no token either, but takes valid params.
        let listed = dispatch(
            &req("capability.list", json!({})),
            &cfg,
            gate,
            &store,
            Ok(NOW),
        );
        assert!(listed.error.is_none());
        let requested = dispatch(
            &req(
                "capability.request",
                json!({"tool": "tool.exec", "scope": "/proj", "ttl_secs": 60}),
            ),
            &cfg,
            gate,
            &store,
            Ok(NOW),
        );
        assert!(requested.error.is_none());
        assert!(
            requested.result.as_ref().unwrap()["request_id"]
                .as_str()
                .unwrap()
                .starts_with("req-")
        );
        // Issuance plane works end to end through dispatch.
        let grant = dispatch(
            &req(
                "capability.grant",
                json!({"tool": "tool.exec", "scope": "/proj", "ttl_secs": 60}),
            ),
            &cfg,
            gate,
            &store,
            Ok(NOW),
        );
        assert!(grant.error.is_none());
        let token = grant.result.as_ref().unwrap()["token"]
            .as_str()
            .unwrap()
            .to_string();
        let revoke_target = grant.result.as_ref().unwrap()["grant_id"].as_i64().unwrap();
        let listed = dispatch(
            &req("capability.list", json!({})),
            &cfg,
            gate,
            &store,
            Ok(NOW),
        );
        assert_eq!(
            listed.result.as_ref().unwrap()["grants"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let revoked = dispatch(
            &req("capability.revoke", json!({"grant_id": revoke_target})),
            &cfg,
            gate,
            &store,
            Ok(NOW),
        );
        assert!(revoked.error.is_none());
        assert_eq!(
            revoked.result.as_ref().unwrap()["revoked"],
            Value::Bool(true)
        );
        // The revoked token now denies through the SAME dispatch entry point.
        let after = dispatch(
            &req(
                "tool.exec",
                json!({"capability": token, "path": "/proj/a.txt"}),
            ),
            &cfg,
            gate,
            &store,
            Ok(NOW),
        );
        assert_eq!(err_code(&after), Some(-32001));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_dispatch_path_bypasses_the_gate() {
        let (dir, store, cfg, gate) = harness("matrix");
        let gate = &gate;
        let methods = [
            "tool.exec",
            "shell.exec",
            "unknown.method",
            "",
            "system.health ",
            "capability.grantX",
        ];
        let mut expected_denials = 0u64;
        let mut expected_not_found = 0u64;
        for method in methods {
            // The empty method name can never hold a grant (empty tools are
            // rejected at issuance), so mint its tokens under a unique
            // stand-in: presenting them still denies with wrong-tool.
            // Grant rows are per-tool, so states cannot interfere through
            // shared rows.
            let grant_tool = if method.is_empty() {
                "empty.method.stand-in"
            } else {
                method
            };
            // Fresh valid token bound to THIS method and /proj.
            let t = gate
                .grant(
                    &store,
                    &cfg.pending_requests,
                    GrantArgs {
                        tool: grant_tool,
                        scope: "/proj",
                        ttl_secs: 3600,
                        request_id: None,
                    },
                    NOW,
                )
                .unwrap()
                .token;
            // Wrong-tool token bound elsewhere.
            let other = gate
                .grant(
                    &store,
                    &cfg.pending_requests,
                    GrantArgs {
                        tool: "other.tool",
                        scope: "/proj",
                        ttl_secs: 3600,
                        request_id: None,
                    },
                    NOW,
                )
                .unwrap()
                .token;
            // Expired token (issued in the past with a 1s TTL).
            let old = gate
                .grant(
                    &store,
                    &cfg.pending_requests,
                    GrantArgs {
                        tool: grant_tool,
                        scope: "/proj",
                        ttl_secs: 1,
                        request_id: None,
                    },
                    NOW - 100,
                )
                .unwrap()
                .token;
            // Revoked token: minted on a throwaway grant that is deleted
            // right away (same-method revoke is covered in capability.rs).
            let throwaway_tool = format!("revoked.probe.{method}");
            let doomed = gate
                .grant(
                    &store,
                    &cfg.pending_requests,
                    GrantArgs {
                        tool: &throwaway_tool,
                        scope: "/proj",
                        ttl_secs: 3600,
                        request_id: None,
                    },
                    NOW,
                )
                .unwrap();
            gate.revoke(&store, doomed.grant_id, NOW).unwrap();
            // Tampered copy.
            let mut tampered = t.clone();
            tampered.replace_range(20..21, "Z");
            let states: &[(&str, Option<String>)] = &[
                ("absent", None),
                ("valid", Some(t.clone())),
                ("wrong-tool", Some(other.clone())),
                ("expired", Some(old.clone())),
                ("tampered", Some(tampered.clone())),
                ("revoked", Some(doomed.token.clone())),
            ];
            for (state, tok) in states {
                for path in ["/proj/a.txt", "/elsewhere/a.txt"] {
                    let mut params = serde_json::Map::new();
                    if let Some(tk) = tok {
                        params.insert("capability".to_string(), Value::String(tk.clone()));
                    }
                    params.insert("path".to_string(), Value::String(path.to_string()));
                    let resp = dispatch(
                        &req(method, Value::Object(params)),
                        &cfg,
                        gate,
                        &store,
                        Ok(NOW),
                    );
                    let allowed = *state == "valid"
                        && path == "/proj/a.txt"
                        // An empty method name can never match a real grant.
                        && !method.is_empty();
                    if allowed {
                        // Past the gate, but nothing implements it yet.
                        assert_eq!(err_code(&resp), Some(-32601), "{method}/{state}/{path}");
                        expected_not_found += 1;
                    } else {
                        assert_eq!(err_code(&resp), Some(-32001), "{method}/{state}/{path}");
                        expected_denials += 1;
                    }
                }
            }
            // Method-level call (no path param): valid token still gates.
            let bare = dispatch(
                &req(method, json!({"capability": t.clone()})),
                &cfg,
                gate,
                &store,
                Ok(NOW),
            );
            if method.is_empty() {
                assert_eq!(err_code(&bare), Some(-32001));
                expected_denials += 1;
            } else {
                assert_eq!(err_code(&bare), Some(-32601));
                expected_not_found += 1;
            }
        }
        // Every denial above wrote exactly one audit row; allowlisted and
        // authorized-but-unimplemented dispatches wrote none.
        let denied: i64 = store
            .audit_events(10_000)
            .unwrap()
            .iter()
            .filter(|e| e.action == "capability.denied")
            .count() as i64;
        assert_eq!(denied as u64, expected_denials);
        assert!(expected_not_found > 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scope_violation_denies_through_dispatch() {
        let (dir, store, cfg, gate) = harness("scope-dispatch");
        let gate = &gate;
        // Grant covers /other only.
        let issued = gate
            .grant(
                &store,
                &cfg.pending_requests,
                GrantArgs {
                    tool: "scoped.tool",
                    scope: "/other",
                    ttl_secs: 3600,
                    request_id: None,
                },
                NOW,
            )
            .unwrap();
        // Outside the granted scope: denied and audited.
        let outside = dispatch(
            &req(
                "scoped.tool",
                json!({"capability": issued.token, "path": "/proj/a.txt"}),
            ),
            &cfg,
            gate,
            &store,
            Ok(NOW),
        );
        assert_eq!(err_code(&outside), Some(-32001));
        assert_eq!(
            outside.error.as_ref().unwrap().message,
            "capability denied: scope-violation"
        );
        // Inside the granted scope: past the gate (unimplemented method).
        let inside = dispatch(
            &req(
                "scoped.tool",
                json!({"capability": issued.token, "path": "/other/a.txt"}),
            ),
            &cfg,
            gate,
            &store,
            Ok(NOW),
        );
        assert_eq!(err_code(&inside), Some(-32601));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
