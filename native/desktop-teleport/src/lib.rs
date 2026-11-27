// SPDX-License-Identifier: GPL-3.0-only
//! Capri's desktop teleport helper, without global input hooks.
//!
//! Replaces `packages/installer/windows/desktop-teleport.cs`. The protocol is
//! unchanged; the difference is how clicks are seen. The C# helper installed
//! `WH_MOUSE_LL` and `WH_KEYBOARD_LL`, so every mouse movement and key press on
//! the computer waited for it. This helper samples button and key state on its
//! own thread instead and is never in the input path.

pub mod anchor;
pub mod clicks;
pub mod protocol;

#[cfg(windows)]
pub mod watch;
#[cfg(windows)]
pub mod win;
