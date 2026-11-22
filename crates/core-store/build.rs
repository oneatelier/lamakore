//! Build script: expose the provisional token directory name without spelling
//! the brand literal in Rust source (brand lint forbids it outside the
//! config, generated outputs, and constitutive policy files).
//!
//! Reads `codeToken` from the workspace `branding.config.json` and emits a
//! tiny `brand_token.rs` with `pub const TOKEN_DIR: &str`.

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
        .unwrap_or_else(|e| panic!("core-store build: cannot read {}: {e}", config.display()));
    let token = read_token_field(&text).unwrap_or_else(|| {
        panic!(
            "core-store build: codeToken not found in {}",
            config.display()
        )
    });
    let unsafe_name = token.is_empty()
        || token.contains("..")
        || token
            .chars()
            .any(|c| c == '/' || c == '\\' || !(c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    if unsafe_name {
        panic!("core-store build: refusing unsafe token dir name");
    }
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap_or_else(|_| ".".to_string()));
    let dest = out_dir.join("brand_token.rs");
    let contents = format!("pub const TOKEN_DIR: &str = {token:?};\n");
    std::fs::write(&dest, contents)
        .unwrap_or_else(|e| panic!("core-store build: cannot write {}: {e}", dest.display()));
}
