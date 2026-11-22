//! Build script: expose the Tier-1 AppContainer profile name without spelling
//! the brand literal in Rust source (brand lint forbids it outside the
//! config, generated outputs, and constitutive policy files).
//!
//! Reads `codeToken` from the workspace `branding.config.json` and emits a
//! tiny `sandbox_profile.rs` with `pub const PROFILE_NAME: &str`. The name
//! fits the AppContainer pattern (`[-_. A-Za-z0-9]+`, max 64 chars).

use std::env;
use std::path::PathBuf;

fn read_token_field(text: &str) -> Option<String> {
    let key = "\"codeToken\"";
    let at = text.find(key)?;
    let after_key = &text[at + key.len()..];
    let colon = after_key.find(':')?;
    let after_colon = after_key[colon + 1..].trim_start();
    let mut chars = after_colon.chars();
    if chars.next()? != '"' {
        return None;
    }
    let mut out = String::new();
    let mut escaped = false;
    for ch in chars {
        if escaped {
            out.push(ch);
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else if ch == '"' {
            return Some(out);
        } else {
            out.push(ch);
        }
    }
    None
}

fn main() {
    let manifest =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string()));
    let config = manifest.join("..").join("..").join("branding.config.json");
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed={}", config.display());
    let text = std::fs::read_to_string(&config)
        .unwrap_or_else(|e| panic!("core-sandbox build: cannot read {}: {e}", config.display()));
    let token = read_token_field(&text).unwrap_or_else(|| {
        panic!(
            "core-sandbox build: codeToken not found in {}",
            config.display()
        )
    });
    if token.is_empty()
        || token
            .chars()
            .any(|c| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'))
    {
        panic!("core-sandbox build: refusing unsafe token");
    }
    let profile = format!("{token}-tool-sandbox");
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap_or_else(|_| ".".to_string()));
    let dest = out_dir.join("sandbox_profile.rs");
    let contents = format!("pub const PROFILE_NAME: &str = {profile:?};\n");
    std::fs::write(&dest, &contents)
        .unwrap_or_else(|e| panic!("core-sandbox build: cannot write {}: {e}", dest.display()));
}
