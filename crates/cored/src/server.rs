//! cored socket server: single instance, handshake gate, two methods.
//!
//! Transport is local-only on every platform: Unix domain sockets on
//! macOS/Linux, named pipes on Windows. There is deliberately no TCP
//! listener anywhere in this codebase.

use core_protocol::brand;
use core_protocol::events::{RING_CAPACITY, RingBuffer};
use core_protocol::wire::{
    self, Ack, Event, EventParams, HANDSHAKE_TIMEOUT_SECS, Handshake, HandshakeResponse,
    PROTOCOL_ID, PROTOCOL_VERSION, Request, Response, RpcError,
};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::watch;

/// Daemon configuration. The session token arrives via `PONE_WIRE_TOKEN`
/// and is never logged.
pub struct ServerConfig {
    pub socket_path: PathBuf,
    pub spill_path: PathBuf,
    pub token: String,
    pub build: String,
    pub started: Instant,
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
        let resp = dispatch(&req, &cfg);
        wire::write_frame(&mut stream, &resp).await?;
    }
    Ok(())
}

fn dispatch(req: &Request, cfg: &ServerConfig) -> Response {
    if !wire::is_allowed(&req.method) {
        return Response {
            jsonrpc: "2.0".to_string(),
            id: Some(req.id.clone()),
            result: None,
            error: Some(RpcError {
                code: -32601,
                message: format!("method not found: {}", req.method),
            }),
        };
    }
    let result = match req.method.as_str() {
        "system.health" => json!({
            "ok": true,
            "uptime_s": cfg.started.elapsed().as_secs(),
            "protocol": PROTOCOL_ID,
            "version": PROTOCOL_VERSION,
        }),
        "system.info" => json!({
            "product": brand::PRODUCT_NAME,
            "codename": brand::CODENAME,
            "daemon": brand::DAEMON_BINARY,
            "copyright": brand::COPYRIGHT_HOLDER,
            "protocol": PROTOCOL_ID,
            "version": PROTOCOL_VERSION,
            "build": cfg.build,
            "pid": std::process::id(),
            "publish_blocked": brand::PUBLISH_BLOCKED,
        }),
        _ => Value::Null,
    };
    Response {
        jsonrpc: "2.0".to_string(),
        id: Some(req.id.clone()),
        result: Some(result),
        error: None,
    }
}
