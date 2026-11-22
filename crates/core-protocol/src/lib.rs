//! Wire types and the generated brand constants.
//!
//! `brand` is code-generated from branding.config.json — see ADR-003.
//!
//! Versioned explicitly so renderer, daemon, and tools can negotiate
//! compatibility at session start instead of assuming it.
//!
//! Panics are a bug: unwraps and expects are denied outside tests.

#![deny(clippy::unwrap_used)]
#![deny(clippy::expect_used)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod brand;
pub mod events;
pub mod wire;

/// Wire-protocol version negotiated at session start.
pub const PROTOCOL_VERSION: u32 = 0;

/// Direction of a single protocol message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    /// Daemon toward a sandboxed tool.
    Dispatch,
    /// Sandboxed tool back toward the daemon.
    Completed,
}

/// A single envelope carried across the daemon boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Envelope {
    /// Monotonic sequence number within a session.
    pub seq: u64,
    /// Which way this envelope travels.
    pub direction: Direction,
    /// Opaque payload bytes; interpreted by the receiver, never executed.
    pub payload: Vec<u8>,
}

impl Envelope {
    /// Build an outbound dispatch envelope.
    pub fn dispatch(seq: u64, payload: Vec<u8>) -> Self {
        Self {
            seq,
            direction: Direction::Dispatch,
            payload,
        }
    }
}
