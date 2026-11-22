//! Dump the core-store v1 schema (CREATE statements + engine posture) for
//! reports. Opens a throwaway database under the OS temp dir; prints to
//! stdout. Usage: cargo run -p core-store --example dump_schema.

use core_store::Store;

fn main() {
    let dir = std::env::temp_dir().join(format!("core-store-dump-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create dump dir");
    let path = dir.join("dump.db");
    let store = Store::open(&path).expect("open dump db");
    println!(
        "-- core-store schema dump (schema_version={})",
        store.schema_version().expect("version")
    );
    let mut names = store.table_names().expect("tables");
    names.sort();
    for name in &names {
        if let Some(sql) = store.table_sql(name).expect("lookup") {
            println!("{sql};");
        }
    }
    println!("-- indexes");
    let mut indexes = store.index_names().expect("indexes");
    indexes.sort();
    for name in &indexes {
        if let Some(sql) = store.table_sql(name).expect("lookup") {
            println!("{sql};");
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
}
