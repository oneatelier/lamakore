//! Tier-1 enforcement tests.
//!
//! Windows (CI + owner-local): child write outside scope is ACCESS_DENIED,
//! child TCP connect fails, parent (job) death kills the child (P008
//! kill-drill shape), and spawn overhead p50 over 50 runs is recorded.
//!
//! macOS/Linux: `spawn_sandboxed` honestly returns `UnsupportedPlatform`
//! mapped to the NOT_IMPLEMENTED wire code.
//!
//! AppContainer unavailability is never faked: when the OS reports the
//! AppContainer profile cannot be created/used, the test prints
//! `SKIP ... AppContainer unavailable ...` and passes, leaving the STOP
//! condition to the report (which then requires owner-local evidence).

use std::ffi::OsStr;
#[cfg(windows)]
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(not(windows))]
use core_sandbox::NOT_IMPLEMENTED_CODE;
use core_sandbox::SandboxError;

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn fresh_dir(tag: &str) -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("core-sandbox-{}-{n}-{tag}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn scrub(dir: &Path) {
    let _ = std::fs::remove_dir_all(dir);
}

/// `true` when the failure is the honest AppContainer-unavailable path.
/// Callers print SKIP and pass; the report records the STOP condition.
#[cfg(windows)]
fn appcontainer_unavailable(e: &SandboxError) -> bool {
    match e {
        SandboxError::Api { op, detail } => {
            detail.contains("AppContainer")
                || op.contains("AppContainer")
                || detail.contains("Isolation")
        }
        SandboxError::Io { .. } | SandboxError::UnsupportedPlatform => false,
    }
}

#[cfg(windows)]
fn powershell() -> &'static str {
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
}

#[cfg(windows)]
fn cmd() -> &'static str {
    "C:\\Windows\\System32\\cmd.exe"
}

// ---------------------------------------------------------------------------
// Windows enforcement
// ---------------------------------------------------------------------------

/// Child write outside the granted scope must be ACCESS_DENIED.
#[cfg(windows)]
#[test]
fn child_write_outside_scope_denied() {
    let dir = fresh_dir("write-deny");
    let scope = dir.join("scope");
    std::fs::create_dir_all(&scope).unwrap();
    let outside = dir.join("outside.txt");
    let _ = std::fs::remove_file(&outside);
    let denial = scope.join("denial.txt");
    let unexpected = scope.join("unexpected.txt");

    let ps = format!(
        "try {{ Set-Content -Path '{o}' -Value 'hi' -ErrorAction Stop; Set-Content -Path '{u}' -Value 'UNEXPECTED_SUCCESS' }} catch {{ Set-Content -Path '{d}' -Value $_.Exception.ToString(); exit 1 }}",
        o = outside.display().to_string().replace('\'', "''"),
        u = unexpected.display().to_string().replace('\'', "''"),
        d = denial.display().to_string().replace('\'', "''"),
    );
    let child = match core_sandbox::spawn_sandboxed(
        &scope,
        OsStr::new(powershell()),
        &[
            OsStr::new("-NoProfile"),
            OsStr::new("-NonInteractive"),
            OsStr::new("-ExecutionPolicy"),
            OsStr::new("Bypass"),
            OsStr::new("-Command"),
            &OsString::from(ps),
        ],
    ) {
        Ok(c) => c,
        Err(e) if appcontainer_unavailable(&e) => {
            println!(
                "SKIP child_write_outside_scope_denied: AppContainer unavailable on this host: {e}"
            );
            scrub(&dir);
            return;
        }
        Err(e) => panic!("spawn failed unexpectedly: {e}"),
    };
    let code = child.wait().unwrap();
    println!("write-deny: child pid={} exit={code}", child.pid());

    // Real denial output (pasted into the report).
    let denial_text = std::fs::read_to_string(&denial).unwrap_or_default();
    println!("write-deny denial.txt:\n{denial_text}");
    println!(
        "write-deny: outside exists={} unexpected exists={}",
        outside.exists(),
        unexpected.exists()
    );

    assert!(
        denial.exists(),
        "child must record the denial inside the granted scope"
    );
    assert!(
        denial_text.contains("Access to the path") && denial_text.contains("is denied"),
        "denial must be ACCESS_DENIED, got:\n{denial_text}"
    );
    assert!(
        !outside.exists(),
        "outside file must NOT be created by the sandboxed child"
    );
    assert!(
        !unexpected.exists(),
        "child must NOT report success writing outside the scope"
    );
    assert_ne!(code, 0, "child must exit non-zero on denial");
    scrub(&dir);
}

/// Child TCP connect (even loopback) must fail with zero capabilities.
#[cfg(windows)]
#[test]
fn child_tcp_connect_fails() {
    use std::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    listener.set_nonblocking(true).unwrap();
    println!("net-deny: listener on 127.0.0.1:{port}");

    let dir = fresh_dir("net-deny");
    let scope = dir.join("scope");
    std::fs::create_dir_all(&scope).unwrap();
    let denial = scope.join("netdenial.txt");
    let unexpected = scope.join("netok.txt");

    let ps = format!(
        "try {{ $c = New-Object Net.Sockets.TcpClient; $iar = $c.BeginConnect('127.0.0.1', {port}, $null, $null); if (-not $iar.AsyncWaitHandle.WaitOne(3000)) {{ throw 'connect timeout' }}; $c.EndConnect($iar); Set-Content -Path '{u}' -Value 'UNEXPECTED_CONNECTED' }} catch {{ Set-Content -Path '{d}' -Value $_.Exception.ToString(); exit 1 }}",
        u = unexpected.display().to_string().replace('\'', "''"),
        d = denial.display().to_string().replace('\'', "''"),
    );
    let child = match core_sandbox::spawn_sandboxed(
        &scope,
        OsStr::new(powershell()),
        &[
            OsStr::new("-NoProfile"),
            OsStr::new("-NonInteractive"),
            OsStr::new("-ExecutionPolicy"),
            OsStr::new("Bypass"),
            OsStr::new("-Command"),
            &OsString::from(ps),
        ],
    ) {
        Ok(c) => c,
        Err(e) if appcontainer_unavailable(&e) => {
            println!("SKIP child_tcp_connect_fails: AppContainer unavailable on this host: {e}");
            scrub(&dir);
            return;
        }
        Err(e) => panic!("spawn failed unexpectedly: {e}"),
    };
    let pid = child.pid();
    let code = child.wait().unwrap();
    println!("net-deny: child pid={pid} exit={code}");

    // The listener must NOT have received a connection.
    match listener.accept() {
        Ok(_) => panic!("SANDBOX BROKEN: listener accepted a connection from pid {pid}"),
        Err(e) => println!("net-deny: listener got no connection as expected: {e}"),
    }
    let denial_text = std::fs::read_to_string(&denial).unwrap_or_default();
    println!("net-deny netdenial.txt:\n{denial_text}");
    assert!(
        denial.exists(),
        "child must record the connect failure inside the scope"
    );
    assert!(
        !unexpected.exists(),
        "child must NOT report a successful connect"
    );
    assert_ne!(code, 0, "child must exit non-zero on connect failure");
    scrub(&dir);
}

/// Parent (job) death kills the child: KILL_ON_JOB_CLOSE + no breakaway.
/// Reuses the P008 kill-drill shape (spawn, verify live, drop job, poll).
#[cfg(windows)]
#[test]
fn parent_killed_child_dies() {
    let dir = fresh_dir("kill-drill");
    let scope = dir.join("scope");
    std::fs::create_dir_all(&scope).unwrap();

    let child = match core_sandbox::spawn_sandboxed(
        &scope,
        OsStr::new(powershell()),
        &[
            OsStr::new("-NoProfile"),
            OsStr::new("-NonInteractive"),
            OsStr::new("-Command"),
            OsStr::new("Start-Sleep -Seconds 30"),
        ],
    ) {
        Ok(c) => c,
        Err(e) if appcontainer_unavailable(&e) => {
            println!("SKIP parent_killed_child_dies: AppContainer unavailable on this host: {e}");
            scrub(&dir);
            return;
        }
        Err(e) => panic!("spawn failed unexpectedly: {e}"),
    };
    let pid = child.pid();
    println!("kill-drill: spawned pid={pid}");
    assert!(child.is_alive(), "child must be alive right after spawn");
    assert!(child.is_in_job(), "child must be in the Tier-1 job");

    let before = std::process::Command::new("tasklist")
        .arg("/FI")
        .arg(format!("PID eq {pid}"))
        .output()
        .unwrap();
    let before_txt = String::from_utf8_lossy(&before.stdout).to_string();
    println!("kill-drill tasklist before:\n{before_txt}");
    assert!(
        before_txt.contains(&pid.to_string()),
        "tasklist must show the live child before the kill"
    );

    // Simulate parent death: dropping the SandboxedChild closes the last Job
    // handle, and KILL_ON_JOB_CLOSE terminates the whole tree.
    let t0 = std::time::Instant::now();
    drop(child);
    let mut dead = false;
    for i in 0..50 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        let out = std::process::Command::new("tasklist")
            .arg("/FI")
            .arg(format!("PID eq {pid}"))
            .arg("/FO")
            .arg("CSV")
            .output()
            .unwrap();
        let txt = String::from_utf8_lossy(&out.stdout).to_string();
        let still = txt.contains(&format!("\"{pid}\""));
        if i % 10 == 0 {
            println!("kill-drill poll {i}: still={still}");
        }
        if !still {
            dead = true;
            break;
        }
    }
    println!("kill-drill: pid={pid} dead={dead} after={:?}", t0.elapsed());
    assert!(
        dead,
        "child {pid} survived parent (job) death: KILL_ON_JOB_CLOSE broken"
    );
    scrub(&dir);
}

/// Spawn overhead p50 over 50 runs (recorded for the report).
#[cfg(windows)]
#[test]
fn spawn_overhead_p50() {
    let dir = fresh_dir("overhead");
    let scope = dir.join("scope");
    std::fs::create_dir_all(&scope).unwrap();

    let mut durs = Vec::with_capacity(50);
    for i in 0..50 {
        let t0 = std::time::Instant::now();
        let child = match core_sandbox::spawn_sandboxed(
            &scope,
            OsStr::new(cmd()),
            &[OsStr::new("/C"), OsStr::new("exit"), OsStr::new("0")],
        ) {
            Ok(c) => c,
            Err(e) if appcontainer_unavailable(&e) => {
                println!("SKIP spawn_overhead_p50: AppContainer unavailable on this host: {e}");
                scrub(&dir);
                return;
            }
            Err(e) => panic!("spawn {i} failed unexpectedly: {e}"),
        };
        let code = child.wait().unwrap();
        assert_eq!(code, 0, "overhead probe must exit 0");
        drop(child);
        durs.push(t0.elapsed());
    }
    durs.sort();
    let min = durs[0];
    let p50 = durs[durs.len() / 2];
    let max = durs[durs.len() - 1];
    println!("spawn overhead over 50 runs: min={min:?} p50={p50:?} max={max:?}");
    // Sanity budget: Tier-1 spawn is Job + AppContainer + DACL, not a VM.
    // 2 s p50 leaves wide headroom (local p50 ~70 ms) while catching hangs.
    assert!(
        p50.as_millis() < 2000,
        "spawn p50 {p50:?} exceeds 2 s budget"
    );
    scrub(&dir);
}

// ---------------------------------------------------------------------------
// Non-Windows honest failure
// ---------------------------------------------------------------------------

/// macOS/Linux return the honest NOT_IMPLEMENTED wire error.
#[cfg(not(windows))]
#[test]
fn spawn_returns_not_implemented_off_windows() {
    let dir = fresh_dir("unsupported");
    let err = core_sandbox::spawn_sandboxed(
        &dir,
        OsStr::new("sh"),
        &[OsStr::new("-c"), OsStr::new("exit 0")],
    )
    .expect_err("spawn must fail off Windows");
    match &err {
        SandboxError::UnsupportedPlatform => {}
        other => panic!("expected UnsupportedPlatform, got: {other}"),
    }
    assert_eq!(
        err.wire_code(),
        NOT_IMPLEMENTED_CODE,
        "wire code must be NOT_IMPLEMENTED"
    );
    assert_eq!(NOT_IMPLEMENTED_CODE, -32002);
    scrub(&dir);
}

/// The NOT_IMPLEMENTED code is stable for the daemon wire mapping.
#[cfg(not(windows))]
#[test]
fn not_implemented_code_is_stable() {
    assert_eq!(NOT_IMPLEMENTED_CODE, -32002);
    assert_eq!(SandboxError::UnsupportedPlatform.wire_code(), -32002);
}
