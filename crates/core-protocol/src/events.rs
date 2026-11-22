//! Bounded event buffer with disk spill: the daemon never drops an event
//! silently. The newest 10,000 unacknowledged events stay resident; older
//! ones are appended to a spill file and counted. Clients acknowledge
//! cumulatively, so a slow client degrades to disk replay, not loss.

use crate::wire::{AckParams, Event};
use std::collections::VecDeque;
use std::io;
use std::path::{Path, PathBuf};

/// Production capacity: ten thousand resident unacknowledged events.
pub const RING_CAPACITY: usize = 10_000;

/// Append-only overflow store. Each line is one serialised [`Event`].
pub struct RingBuffer {
    cap: usize,
    buf: VecDeque<Event>,
    next_seq: u64,
    spilled: u64,
    spill_path: PathBuf,
}

impl RingBuffer {
    /// Create a buffer spilling to `spill_path` (parent must exist).
    pub fn new(cap: usize, spill_path: PathBuf) -> Self {
        Self {
            cap,
            buf: VecDeque::new(),
            next_seq: 1,
            spilled: 0,
            spill_path,
        }
    }

    /// Assign the next sequence number without storing (for tests).
    pub fn take_seq(&mut self) -> u64 {
        let s = self.next_seq;
        self.next_seq += 1;
        s
    }

    /// Store an event, spilling the oldest to disk past capacity.
    /// Returns the assigned sequence number.
    pub fn push(&mut self, mut ev: Event) -> io::Result<u64> {
        ev.params.seq = self.take_seq();
        if self.buf.len() >= self.cap {
            let line = serde_json::to_string(&ev).map_err(io::Error::other)?;
            self.append_spill(&line)?;
            self.spilled += 1;
            // Keep the resident window sliding: drop the oldest resident
            // copy only after it is durable on disk.
            self.buf.pop_front();
        }
        let seq = ev.params.seq;
        self.buf.push_back(ev);
        Ok(seq)
    }

    /// Cumulative acknowledgement: forget everything at or below `seq`.
    /// Returns the number of resident events still unacknowledged.
    pub fn ack(&mut self, params: &AckParams) -> usize {
        while self
            .buf
            .front()
            .map(|e| e.params.seq <= params.seq)
            .unwrap_or(false)
        {
            self.buf.pop_front();
        }
        self.buf.len()
    }

    /// Resident unacknowledged events.
    pub fn pending(&self) -> usize {
        self.buf.len()
    }

    /// Events spilled to disk so far (never silently dropped).
    pub fn spilled(&self) -> u64 {
        self.spilled
    }

    /// Next sequence number that will be assigned.
    pub fn next_seq(&self) -> u64 {
        self.next_seq
    }

    fn append_spill(&self, line: &str) -> io::Result<()> {
        use std::io::Write as _;
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.spill_path)?;
        writeln!(f, "{line}")?;
        f.sync_all()
    }

    /// Spill file location (for health reporting and tests).
    pub fn spill_path(&self) -> &Path {
        &self.spill_path
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wire::EventParams;
    use serde_json::json;

    fn event() -> Event {
        Event {
            jsonrpc: "2.0".to_string(),
            method: "event".to_string(),
            params: EventParams {
                seq: 0,
                topic: "t".to_string(),
                data: json!({}),
            },
        }
    }

    #[test]
    fn overflow_spills_to_disk_instead_of_dropping() {
        let dir = std::env::temp_dir().join(format!("wire-ring-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let spill = dir.join("spill.log");
        let _ = std::fs::remove_file(&spill);
        let mut ring = RingBuffer::new(3, spill.clone());
        for _ in 0..5 {
            ring.push(event()).unwrap();
        }
        // 5 pushed into cap 3: 2 spilled, 3 resident, none lost.
        assert_eq!(ring.spilled(), 2);
        assert_eq!(ring.pending(), 3);
        let text = std::fs::read_to_string(&spill).unwrap();
        assert_eq!(text.lines().count(), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cumulative_ack_forgets_prefix() {
        let dir = std::env::temp_dir().join(format!("wire-ack-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut ring = RingBuffer::new(10, dir.join("spill.log"));
        for _ in 0..4 {
            ring.push(event()).unwrap();
        }
        let left = ring.ack(&AckParams { seq: 2 });
        assert_eq!(left, 2);
        assert_eq!(ring.pending(), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
