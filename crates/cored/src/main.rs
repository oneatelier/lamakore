//! cored — the trusted daemon. See ADR-000 for the trust boundary.
//!
//! The daemon owns a local-only socket (Unix domain socket or Windows named
//! pipe — never TCP), gates every connection on a wire/1 handshake, and
//! executes an allowlisted method set. Panics are a bug: unwraps and
//! expects are denied outside tests.

#![deny(clippy::unwrap_used)]
#![deny(clippy::expect_used)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

mod capability;
mod fs_tool;
mod secret_tool;
mod server;

use capability::KeyProvider as _;
use core_protocol::wire::WireError;
use std::path::PathBuf;
use std::time::Instant;

const VERSION: &str = env!("CARGO_PKG_VERSION");
const BUILD_TAG: &str = match option_env!("BUILD_HASH") {
    Some(h) => h,
    None => "dev",
};

fn build_string() -> String {
    format!("{VERSION}-{BUILD_TAG}")
}

fn usage() -> ! {
    eprintln!("usage: cored --socket <path>");
    eprintln!("   or: cored fs-list --scope <dir> [--path <rel>] --limit <n> --out <file>");
    eprintln!("   or: cored fs-read --scope <dir> --path <rel> --max-bytes <n> --out <file>");
    std::process::exit(2);
}

#[tokio::main]
async fn main() -> Result<(), WireError> {
    // Sandboxed fs worker subcommands run first: pure filesystem work, no
    // store, no keychain, no network. The parent spawns these confined.
    let mut raw = std::env::args().skip(1);
    let Some(first) = raw.next() else {
        usage();
    };
    if first == "fs-list" || first == "fs-read" {
        let rest: Vec<String> = raw.collect();
        std::process::exit(fs_tool::run_worker(&first, &rest));
    }
    let mut socket: Option<PathBuf> = None;
    let mut argv = std::iter::once(first).chain(raw);
    while let Some(arg) = argv.next() {
        if arg == "--socket" {
            socket = argv.next().map(PathBuf::from);
        } else {
            eprintln!("unknown argument: {arg}");
            usage();
        }
    }
    let socket_path = socket.unwrap_or_else(|| usage());
    let token = std::env::var("PONE_WIRE_TOKEN").unwrap_or_else(|_| {
        eprintln!("PONE_WIRE_TOKEN is not set; refusing to start without a session token");
        std::process::exit(2);
    });
    let spill_path = socket_path.with_extension("spill.log");

    // Device root key for capability minting/verification. Fail closed:
    // without it no dispatch path can be gated, so there is no safe mode.
    let root_key = match capability::KeychainProvider::device_root().load_or_create_key() {
        Ok(k) => k,
        Err(e) => {
            eprintln!("device root key unavailable ({e}); refusing to start");
            std::process::exit(2);
        }
    };
    let db_path = match core_store::Store::default_db_path() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("cannot resolve store path ({e}); refusing to start");
            std::process::exit(2);
        }
    };

    let (shutdown_tx, _shutdown_rx) = tokio::sync::watch::channel(false);

    // Parent death: the launcher holds our stdin open and never writes.
    // EOF therefore means the parent is gone; shut down instead of orphaning.
    let tx = shutdown_tx.clone();
    std::thread::spawn(move || {
        use std::io::Read as _;
        loop {
            let mut buf = [0u8; 1];
            match std::io::stdin().read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
        }
        let _ = tx.send(true);
    });

    // SIGTERM / Ctrl-C: graceful shutdown, never a dirty exit.
    let tx = shutdown_tx.clone();
    tokio::spawn(async move {
        #[cfg(unix)]
        {
            let mut term =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate());
            match term {
                Ok(ref mut s) => {
                    s.recv().await;
                }
                Err(_) => {
                    tokio::signal::ctrl_c().await.ok();
                }
            }
        }
        #[cfg(not(unix))]
        {
            tokio::signal::ctrl_c().await.ok();
        }
        let _ = tx.send(true);
    });

    let cfg = server::ServerConfig {
        socket_path: socket_path.clone(),
        spill_path,
        token,
        build: build_string(),
        started: Instant::now(),
        root_key,
        db_path,
        pending_requests: std::sync::Mutex::new(std::collections::HashMap::new()),
        // Provider keys live in the OS keychain (vault); SQLite never
        // holds secrets. The vault handle is shared across connections.
        vault: std::sync::Arc::new(vault::Vault::production()),
    };
    println!("ready socket={} build={}", socket_path.display(), cfg.build);
    match server::run(cfg, shutdown_tx.subscribe()).await {
        Ok(()) => Ok(()),
        Err(e) => {
            eprintln!("cored: {e}");
            std::process::exit(e.exit_code());
        }
    }
}

trait ExitCode {
    fn exit_code(&self) -> i32;
}

impl ExitCode for WireError {
    fn exit_code(&self) -> i32 {
        match self {
            WireError::AlreadyRunning(_) => 3,
            WireError::Refused(_) => 4,
            _ => 1,
        }
    }
}
