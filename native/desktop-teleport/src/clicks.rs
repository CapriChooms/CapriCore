// SPDX-License-Identifier: GPL-3.0-only
//! Click logic, fed by polling instead of a low-level hook.
//!
//! The C# helper saw every button event through `WH_MOUSE_LL`, which puts the
//! helper in the path of every mouse movement on the computer. Here a thread
//! samples button state a few hundred times a second and turns the changes it
//! sees into the same events, so nothing ever waits on Capri.

/// A screen point in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

/// One button: held now, and pressed at some moment since the last sample.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Button {
    pub down: bool,
    pub since: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Buttons {
    pub left: Button,
    pub right: Button,
    pub middle: Button,
    pub x1: Button,
    pub x2: Button,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Keys {
    pub escape: Button,
    pub apps: Button,
    pub f10: Button,
    pub shift: bool,
}

/// What lies under the cursor, as far as the teleport menu cares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Place {
    /// Explorer's desktop background.
    Desktop,
    /// An Explorer menu (the desktop context menu and its submenus).
    ShellMenu,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Hit {
    pub place: Place,
    /// Top-level window under the point.
    pub root: isize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Edge {
    LeftDown,
    LeftUp,
    RightDown,
    RightUp,
    MiddleDown,
    XDown,
}

/// The edges between two samples, releases first. A press and release that both
/// fell between samples (seen only through `since`) becomes a down then an up.
pub fn edges(previous: &Buttons, now: &Buttons) -> Vec<Edge> {
    let table = [
        (previous.left, now.left, Edge::LeftDown, Some(Edge::LeftUp)),
        (
            previous.right,
            now.right,
            Edge::RightDown,
            Some(Edge::RightUp),
        ),
        (previous.middle, now.middle, Edge::MiddleDown, None),
        (previous.x1, now.x1, Edge::XDown, None),
        (previous.x2, now.x2, Edge::XDown, None),
    ];
    let mut out = Vec::new();
    for (before, after, _, up) in table {
        if before.down && !after.down {
            out.extend(up);
        }
    }
    for (before, after, down, up) in table {
        if !before.down && after.down {
            out.push(down);
        } else if !before.down && !after.down && after.since {
            out.push(down);
            out.extend(up);
        }
    }
    out
}

fn key_pressed(previous: Button, now: Button) -> bool {
    (!previous.down && now.down) || (!now.down && now.since)
}

/// Remembered desktop right-click and left-release watch.
#[derive(Debug, Default)]
pub struct Clicks {
    origin: Option<Point>,
    release_window: isize,
    release_id: i32,
    track_release: bool,
    previous: Buttons,
    previous_keys: Keys,
}

impl Clicks {
    /// Capri asks to hear about the next left release that starts in `window`.
    pub fn watch_release(&mut self, window: isize, id: i32) {
        self.release_window = window;
        self.release_id = id;
        self.track_release = false;
    }

    /// The Explorer menu entry was chosen: hand over (and forget) the point.
    pub fn take_origin(&mut self) -> Option<Point> {
        self.origin.take()
    }

    pub fn origin(&self) -> Option<Point> {
        self.origin
    }

    /// Applies one button event; returns `(id, point)` for a watched release.
    pub fn on_edge(
        &mut self,
        edge: Edge,
        point: Point,
        hit: &mut dyn FnMut(Point) -> Hit,
    ) -> Option<(i32, Point)> {
        if edge == Edge::LeftUp {
            let id = if self.track_release {
                self.release_id
            } else {
                0
            };
            self.track_release = false;
            return (id != 0).then_some((id, point));
        }
        let under = hit(point);
        let desktop = under.place == Place::Desktop;
        if edge == Edge::RightDown && desktop {
            self.origin = Some(point);
        } else if !(edge == Edge::RightUp && desktop) && under.place != Place::ShellMenu {
            // Button-up on the desktop and clicks inside its menu keep the point.
            self.origin = None;
        }
        if edge == Edge::LeftDown {
            self.track_release = self.release_window != 0 && under.root == self.release_window;
        }
        None
    }

    /// Esc closes the desktop menu; the Apps key and Shift+F10 open a new one.
    pub fn on_keys(&mut self, keys: &Keys) {
        let previous = self.previous_keys;
        if key_pressed(previous.escape, keys.escape)
            || key_pressed(previous.apps, keys.apps)
            || (keys.shift && key_pressed(previous.f10, keys.f10))
        {
            self.origin = None;
        }
        self.previous_keys = *keys;
    }

    /// One poll: returns the watched releases to report.
    pub fn sample(
        &mut self,
        buttons: &Buttons,
        keys: &Keys,
        point: Point,
        hit: &mut dyn FnMut(Point) -> Hit,
    ) -> Vec<(i32, Point)> {
        self.on_keys(keys);
        let changes = edges(&self.previous, buttons);
        self.previous = Buttons {
            left: Button {
                down: buttons.left.down,
                since: false,
            },
            right: Button {
                down: buttons.right.down,
                since: false,
            },
            middle: Button {
                down: buttons.middle.down,
                since: false,
            },
            x1: Button {
                down: buttons.x1.down,
                since: false,
            },
            x2: Button {
                down: buttons.x2.down,
                since: false,
            },
        };
        changes
            .into_iter()
            .filter_map(|edge| self.on_edge(edge, point, hit))
            .collect()
    }
}
