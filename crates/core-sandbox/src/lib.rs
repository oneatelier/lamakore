//! core-sandbox — OS sandbox drivers for tool execution.
//!
//! Driver order follows the P000 host profile: always-present primitives
//! first (Job Objects, AppContainer), hypervisor-backed isolation only as
//! an opt-in tier. See ADR-000, consequence 3.

/// A sandbox driver the daemon may confine a tool with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Driver {
    /// Windows Job Objects: memory, CPU, and process-tree limits.
    JobObjects,
    /// Windows AppContainer / integrity levels: token sandboxing.
    AppContainer,
    /// Windows Low Privilege AppContainer: least-capability tokens.
    Lpac,
}

/// Drivers verified present on the reference host, strongest first.
pub fn default_drivers() -> Vec<Driver> {
    vec![Driver::JobObjects, Driver::AppContainer, Driver::Lpac]
}
