//! core-policy — capability tokens gating tool dispatch.
//!
//! A token is minted by the trusted daemon, presented by a caller, and
//! checked before any sandboxed tool runs. Safety, audit, policy, and
//! sandbox stay Apache-2.0; see ee/README.md for the commercial boundary.

/// A capability token authorizing one class of tool use.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Capability {
    /// Stable machine-readable name, e.g. "fs.read".
    pub name: String,
    /// Remaining invocations before the token expires.
    pub budget: u32,
}

impl Capability {
    /// Mint a token for `name` with `budget` invocations.
    pub fn new(name: &str, budget: u32) -> Self {
        Self {
            name: name.to_string(),
            budget,
        }
    }

    /// True while at least one invocation remains.
    pub fn is_live(&self) -> bool {
        self.budget > 0
    }
}
