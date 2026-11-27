// SPDX-License-Identifier: GPL-3.0-only
//! Line protocol shared with Capri's `desktop-teleport-menu.mjs`.
//!
//! Parent to helper (stdin):
//!   `<window> <id>`                       watch for a left-button release that
//!                                         started inside `window` (`0 0` stops)
//!   `follow <id> <window> <pid> <ticks>`  follow a window (`id` 0 stops)
//! Helper to parent (stdout):
//!   `ready`, `<x> <y>`, `release <id> <x> <y>`, `anchor <id> <state>`

/// A parsed command from Capri.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    Release {
        window: isize,
        id: i32,
    },
    Follow {
        id: i32,
        window: isize,
        process: u32,
        ticks: i64,
    },
}

/// Capri passes a 32-character lowercase hex token on the command line.
pub fn valid_token(token: &str) -> bool {
    token.len() == 32
        && token
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// The private pipe the Explorer menu entry connects to.
pub fn pipe_name(token: &str) -> String {
    format!(r"\\.\pipe\Capri.DesktopTeleport.{token}")
}

fn handle(text: &str) -> Option<isize> {
    text.parse::<i64>()
        .ok()
        .or_else(|| text.parse::<u64>().ok().map(|value| value as i64))
        .map(|value| value as isize)
}

/// Parses one stdin line; anything malformed is ignored, as the C# helper did.
pub fn parse_command(line: &str) -> Option<Command> {
    let parts: Vec<&str> = line.trim_end_matches(['\r', '\n']).split(' ').collect();
    match parts.as_slice() {
        ["follow", id, window, process, ticks] => Some(Command::Follow {
            id: id.parse().ok()?,
            window: handle(window)?,
            process: process.parse().ok()?,
            ticks: ticks.parse().ok()?,
        }),
        [window, id] => Some(Command::Release {
            window: handle(window)?,
            id: id.parse().ok()?,
        }),
        _ => None,
    }
}

pub fn origin_line(x: i32, y: i32) -> String {
    format!("{x} {y}")
}

pub fn release_line(id: i32, x: i32, y: i32) -> String {
    format!("release {id} {x} {y}")
}

pub fn anchor_line(id: i32, state: &str) -> String {
    format!("anchor {id} {state}")
}
