// SPDX-License-Identifier: GPL-3.0-only
//! Deciding what to tell Capri about a followed window, ported from the C#
//! helper's `ApplyAnchorObservation` so Capri sees the same states.

pub const HOLD_MS: i64 = 750;
pub const UNAVAILABLE_TIMEOUT_MS: i64 = 5000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Identity {
    /// Could not check (access denied, window not answering).
    Unavailable,
    Verified,
    /// The window or the process that owned it is gone.
    Closed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Rect {
    pub fn usable(&self) -> bool {
        self.right > self.left && self.bottom > self.top
    }
}

/// DWM's visible frame when it has one, else the outer window rectangle.
pub fn choose_rect(dwm: Option<Rect>, outer: Option<Rect>) -> Option<Rect> {
    dwm.filter(Rect::usable)
        .or_else(|| outer.filter(Rect::usable))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Observation {
    pub identity: Identity,
    pub visible: bool,
    pub iconic: bool,
    pub zoomed: bool,
    pub rect: Option<Rect>,
}

/// What one observation produced: a line for Capri, and whether following ends.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Outcome {
    pub line: Option<String>,
    pub stop: bool,
}

#[derive(Debug, Default)]
pub struct Anchor {
    pub id: i32,
    last: Option<String>,
    unavailable_at: Option<i64>,
}

impl Anchor {
    pub fn new(id: i32) -> Self {
        Anchor {
            id,
            last: None,
            unavailable_at: None,
        }
    }

    /// Ends following with a final state (closed, hidden).
    pub fn end(&mut self, state: &str) -> Outcome {
        let id = self.id;
        self.id = 0;
        Outcome {
            line: (id != 0).then(|| crate::protocol::anchor_line(id, state)),
            stop: true,
        }
    }

    fn publish(&mut self, state: String) -> Outcome {
        if self.last.as_deref() == Some(state.as_str()) {
            return Outcome::default();
        }
        self.last = Some(state.clone());
        Outcome {
            line: Some(crate::protocol::anchor_line(self.id, &state)),
            stop: false,
        }
    }

    pub fn observe(&mut self, seen: &Observation, now_ms: i64) -> Outcome {
        if self.id == 0 {
            return Outcome {
                line: None,
                stop: true,
            };
        }
        let showing = seen.visible && !seen.iconic;
        let verified = seen.identity == Identity::Verified;
        // A maximized window's frame can put the sprite off screen.
        if verified && showing && seen.zoomed {
            return self.end("hidden");
        }
        if seen.identity == Identity::Closed {
            return self.end("closed");
        }
        let rect = if verified && showing {
            seen.rect.filter(Rect::usable)
        } else {
            None
        };
        if !verified || (showing && rect.is_none()) {
            let since = *self.unavailable_at.get_or_insert(now_ms);
            let waited = now_ms - since;
            if waited >= UNAVAILABLE_TIMEOUT_MS {
                return self.end("closed");
            }
            if self.last.is_none() || waited >= HOLD_MS {
                return self.publish("unavailable".to_string());
            }
            return Outcome::default();
        }
        self.unavailable_at = None;
        let Some(r) = rect else {
            return self.end("hidden");
        };
        self.publish(format!(
            "visible {} {} {} {}",
            r.left,
            r.top,
            r.right - r.left,
            r.bottom - r.top
        ))
    }
}

/// .NET `DateTime.Ticks` (100 ns since 0001-01-01) for a Windows FILETIME
/// (100 ns since 1601-01-01). Capri identifies processes by this value.
pub fn filetime_to_ticks(filetime: u64) -> Option<i64> {
    const EPOCH_1601: i64 = 504_911_232_000_000_000;
    i64::try_from(filetime).ok()?.checked_add(EPOCH_1601)
}
