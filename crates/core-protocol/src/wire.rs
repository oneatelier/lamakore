//! wire/1 — length-prefixed JSON-RPC 2.0 transport for the daemon boundary.
//!
//! Every frame is a 4-byte big-endian length followed by UTF-8 JSON. The
//! first frame on a connection MUST be a [`Handshake`]; anything else
//! closes the connection. No TCP is involved on any platform: Unix domain
//! sockets on macOS/Linux, named pipes on Windows (see server.rs).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// Protocol identifier exchanged in every handshake.
pub const PROTOCOL_ID: &str = "wire/1";
/// Current protocol version. Any other version is refused.
pub const PROTOCOL_VERSION: u32 = 1;
/// Method names the daemon will ever execute (validated on both sides).
/// Capability issuance (`capability.*`) is allowlisted like health/info: you
/// cannot require a capability in order to obtain one. Every other method
/// must present a valid capability (see `cored::capability`).
pub const ALLOWED_METHODS: &[&str] = &[
    "system.health",
    "system.info",
    "capability.request",
    "capability.grant",
    "capability.revoke",
    "capability.list",
];
/// Handshake must complete within this window or the peer is dropped.
pub const HANDSHAKE_TIMEOUT_SECS: u64 = 5;
/// Maximum single frame size (8 MiB); larger frames are a protocol error.
pub const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;

/// All wire failures. Carries context; never panics.
#[derive(Debug, Error)]
pub enum WireError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("utf8: {0}")]
    Utf8(#[from] std::string::FromUtf8Error),
    #[error("handshake refused: {0}")]
    Refused(String),
    #[error("already running: {0}")]
    AlreadyRunning(String),
    #[error("protocol: {0}")]
    Protocol(String),
    #[error("peer closed the connection")]
    Closed,
}

/// First frame client -> daemon on every new connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Handshake {
    pub protocol: String,
    pub version: u32,
    pub build: String,
    pub token: String,
}

/// Daemon -> client handshake answer. `ok: false` is always terminal:
/// the daemon closes the connection immediately after sending it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandshakeResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub protocol: String,
    pub version: u32,
    pub build: String,
}

/// JSON-RPC 2.0 request (client -> daemon only).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    pub jsonrpc: String,
    pub id: serde_json::Number,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

/// JSON-RPC 2.0 response (daemon -> client only).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response {
    pub jsonrpc: String,
    pub id: Option<serde_json::Number>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

/// JSON-RPC 2.0 error object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
}

/// Daemon -> client event notification. `seq` is a per-connection counter;
/// the client acknowledges cumulatively (see [`Ack`]).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub jsonrpc: String,
    pub method: String,
    pub params: EventParams,
}

/// Event payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventParams {
    pub seq: u64,
    pub topic: String,
    pub data: Value,
}

/// Client -> daemon cumulative acknowledgement (`seq` = highest contiguous
/// sequence received). Notifications carry no `id` and expect no reply.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ack {
    pub jsonrpc: String,
    pub method: String,
    pub params: AckParams,
}

/// Ack payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AckParams {
    pub seq: u64,
}

/// Method allowlist, enforced on both sides of the boundary.
pub fn is_allowed(method: &str) -> bool {
    ALLOWED_METHODS.contains(&method)
}

/// Read one length-prefixed JSON frame.
pub async fn read_frame<R>(r: &mut R) -> Result<Value, WireError>
where
    R: AsyncRead + Unpin,
{
    let len = r.read_u32().await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::UnexpectedEof {
            WireError::Closed
        } else {
            WireError::Io(e)
        }
    })? as usize;
    if len > MAX_FRAME_BYTES {
        return Err(WireError::Protocol(format!("frame too large: {len} bytes")));
    }
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::UnexpectedEof {
            WireError::Closed
        } else {
            WireError::Io(e)
        }
    })?;
    let text = String::from_utf8(buf)?;
    Ok(serde_json::from_str(&text)?)
}

/// Write one length-prefixed JSON frame.
pub async fn write_frame<W, T>(w: &mut W, value: &T) -> Result<(), WireError>
where
    W: AsyncWrite + Unpin,
    T: Serialize + ?Sized,
{
    let text = serde_json::to_string(value)?;
    let bytes = text.as_bytes();
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(WireError::Protocol(format!(
            "frame too large: {} bytes",
            bytes.len()
        )));
    }
    w.write_u32(bytes.len() as u32).await?;
    w.write_all(bytes).await?;
    w.flush().await?;
    Ok(())
}

/// Validate an inbound handshake against local expectations.
/// Returns the refusal reason on mismatch; the caller must close after sending it.
pub fn check_handshake(
    h: &Handshake,
    expected_token: &str,
    expected_build: &str,
) -> Result<(), String> {
    if h.protocol != PROTOCOL_ID {
        return Err(format!("unknown protocol {:?}", h.protocol));
    }
    if h.version != PROTOCOL_VERSION {
        return Err(format!(
            "version mismatch: peer {}, want {}",
            h.version, PROTOCOL_VERSION
        ));
    }
    if h.token != expected_token {
        return Err("session token mismatch".to_string());
    }
    if h.build != expected_build {
        return Err(format!(
            "build mismatch: peer {:?}, want {:?}",
            h.build, expected_build
        ));
    }
    Ok(())
}

impl fmt::Display for Handshake {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} v{} build={}",
            self.protocol, self.version, self.build
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_gates_methods() {
        assert!(is_allowed("system.health"));
        assert!(is_allowed("system.info"));
        assert!(is_allowed("capability.request"));
        assert!(is_allowed("capability.grant"));
        assert!(is_allowed("capability.revoke"));
        assert!(is_allowed("capability.list"));
        assert!(!is_allowed("shell.exec"));
        assert!(!is_allowed("tool.exec"));
        assert!(!is_allowed("system.health "));
    }

    #[test]
    fn handshake_accepts_exact_match() {
        let h = Handshake {
            protocol: "wire/1".to_string(),
            version: 1,
            build: "0.0.0-dev".to_string(),
            token: "tok".to_string(),
        };
        assert!(check_handshake(&h, "tok", "0.0.0-dev").is_ok());
    }

    #[test]
    fn handshake_refuses_each_mismatch() {
        let base = Handshake {
            protocol: "wire/1".to_string(),
            version: 1,
            build: "0.0.0-dev".to_string(),
            token: "tok".to_string(),
        };
        let mut v = base.clone();
        v.version = 999;
        assert!(check_handshake(&v, "tok", "0.0.0-dev").is_err());
        let mut b = base.clone();
        b.build = "other".to_string();
        assert!(check_handshake(&b, "tok", "0.0.0-dev").is_err());
        let mut t = base.clone();
        t.token = "wrong".to_string();
        assert!(check_handshake(&t, "tok", "0.0.0-dev").is_err());
        let mut p = base;
        p.protocol = "wire/2".to_string();
        assert!(check_handshake(&p, "tok", "0.0.0-dev").is_err());
    }

    #[tokio::test]
    async fn frames_round_trip() {
        let (mut a, mut b) = tokio::io::duplex(65536);
        let req = Request {
            jsonrpc: "2.0".to_string(),
            id: 7.into(),
            method: "system.health".to_string(),
            params: Value::Null,
        };
        write_frame(&mut a, &req).await.unwrap();
        let back: Value = read_frame(&mut b).await.unwrap();
        assert_eq!(back["method"], "system.health");
        assert_eq!(back["id"], 7);
    }
}
