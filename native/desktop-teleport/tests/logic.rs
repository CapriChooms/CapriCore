// SPDX-License-Identifier: GPL-3.0-only
use capri_desktop_teleport::anchor::{
    Anchor, Identity, Observation, Rect, choose_rect, filetime_to_ticks,
};
use capri_desktop_teleport::clicks::{
    Button, Buttons, Clicks, Edge, Hit, Keys, Place, Point, edges,
};
use capri_desktop_teleport::protocol::{Command, parse_command, pipe_name, valid_token};

const DOWN: Button = Button {
    down: true,
    since: true,
};
const UP: Button = Button {
    down: false,
    since: false,
};
const TAPPED: Button = Button {
    down: false,
    since: true,
};

#[test]
fn tokens_and_pipe_names() {
    assert!(valid_token("0123456789abcdef0123456789abcdef"));
    for bad in [
        "",
        "0123456789ABCDEF0123456789abcdef",
        "0123456789abcdef0123456789abcde",
        "0123456789abcdef0123456789abcdeg",
    ] {
        assert!(!valid_token(bad), "{bad}");
    }
    assert_eq!(pipe_name("ab"), r"\\.\pipe\Capri.DesktopTeleport.ab");
}

#[test]
fn commands_from_capri_parse_like_the_csharp_helper() {
    assert_eq!(
        parse_command("123456 7"),
        Some(Command::Release {
            window: 123456,
            id: 7
        })
    );
    assert_eq!(
        parse_command("0 0\r\n"),
        Some(Command::Release { window: 0, id: 0 })
    );
    assert_eq!(
        parse_command("follow 3 655 4242 638000000000000000"),
        Some(Command::Follow {
            id: 3,
            window: 655,
            process: 4242,
            ticks: 638000000000000000
        })
    );
    assert_eq!(
        parse_command("follow 0 0 0 0"),
        Some(Command::Follow {
            id: 0,
            window: 0,
            process: 0,
            ticks: 0
        })
    );
    // Unsigned 64-bit window handles from Node's BigInt are accepted.
    assert!(matches!(
        parse_command("18446744073709551615 1"),
        Some(Command::Release { id: 1, .. })
    ));
    for bad in [
        "",
        "hello",
        "1 2 3",
        "follow 1 2 3",
        "follow a 2 3 4",
        "x 1",
        "1 y",
    ] {
        assert_eq!(parse_command(bad), None, "{bad}");
    }
}

#[test]
fn edges_find_presses_releases_and_clicks_between_samples() {
    let none = Buttons::default();
    let left = Buttons { left: DOWN, ..none };
    assert_eq!(edges(&none, &none), vec![]);
    assert_eq!(edges(&none, &left), vec![Edge::LeftDown]);
    assert_eq!(edges(&left, &left), vec![]);
    assert_eq!(edges(&left, &none), vec![Edge::LeftUp]);
    // Pressed and released between two samples: still seen, in order.
    assert_eq!(
        edges(
            &none,
            &Buttons {
                right: TAPPED,
                ..none
            }
        ),
        vec![Edge::RightDown, Edge::RightUp]
    );
    // Releases are handled before new presses in the same sample.
    let right = Buttons {
        right: DOWN,
        ..none
    };
    assert_eq!(edges(&left, &right), vec![Edge::LeftUp, Edge::RightDown]);
    assert_eq!(
        edges(
            &none,
            &Buttons {
                middle: DOWN,
                x2: DOWN,
                ..none
            }
        ),
        vec![Edge::MiddleDown, Edge::XDown]
    );
}

fn hit(place: Place, root: isize) -> impl FnMut(Point) -> Hit {
    move |_| Hit { place, root }
}

#[test]
fn desktop_right_click_is_remembered_until_something_else_happens() {
    let mut clicks = Clicks::default();
    let at = Point { x: 900, y: 400 };
    clicks.on_edge(Edge::RightDown, at, &mut hit(Place::Desktop, 1));
    clicks.on_edge(
        Edge::RightUp,
        Point { x: 1, y: 1 },
        &mut hit(Place::Desktop, 1),
    );
    assert_eq!(
        clicks.origin(),
        Some(at),
        "button-up on the desktop keeps the point"
    );
    clicks.on_edge(
        Edge::LeftDown,
        Point::default(),
        &mut hit(Place::ShellMenu, 2),
    );
    assert_eq!(
        clicks.origin(),
        Some(at),
        "clicking inside the desktop menu keeps it"
    );
    assert_eq!(clicks.take_origin(), Some(at));
    assert_eq!(clicks.take_origin(), None, "taken once");

    clicks.on_edge(Edge::RightDown, at, &mut hit(Place::Desktop, 1));
    clicks.on_edge(Edge::LeftDown, at, &mut hit(Place::Other, 3));
    assert_eq!(clicks.origin(), None, "a click elsewhere forgets it");
    clicks.on_edge(Edge::RightDown, at, &mut hit(Place::Other, 3));
    assert_eq!(
        clicks.origin(),
        None,
        "right-click outside the desktop is not remembered"
    );
}

#[test]
fn escape_apps_key_and_shift_f10_forget_the_point() {
    let at = Point { x: 5, y: 6 };
    for keys in [
        Keys {
            escape: DOWN,
            ..Keys::default()
        },
        Keys {
            apps: TAPPED,
            ..Keys::default()
        },
        Keys {
            f10: DOWN,
            shift: true,
            ..Keys::default()
        },
    ] {
        let mut clicks = Clicks::default();
        clicks.on_edge(Edge::RightDown, at, &mut hit(Place::Desktop, 1));
        clicks.on_keys(&keys);
        assert_eq!(clicks.origin(), None, "{keys:?}");
    }
    let mut clicks = Clicks::default();
    clicks.on_edge(Edge::RightDown, at, &mut hit(Place::Desktop, 1));
    clicks.on_keys(&Keys {
        f10: DOWN,
        ..Keys::default()
    });
    assert_eq!(clicks.origin(), Some(at), "F10 without Shift does nothing");
    // A key already held when the point was remembered does not clear it again.
    let mut clicks = Clicks::default();
    clicks.on_keys(&Keys {
        escape: DOWN,
        ..Keys::default()
    });
    clicks.on_edge(Edge::RightDown, at, &mut hit(Place::Desktop, 1));
    clicks.on_keys(&Keys {
        escape: Button {
            down: true,
            since: false,
        },
        ..Keys::default()
    });
    assert_eq!(clicks.origin(), Some(at));
}

#[test]
fn release_is_reported_only_for_a_drag_that_started_in_the_watched_window() {
    let mut clicks = Clicks::default();
    let at = Point { x: 10, y: 20 };
    assert_eq!(
        clicks.on_edge(Edge::LeftUp, at, &mut hit(Place::Other, 7)),
        None,
        "nothing watched"
    );
    clicks.watch_release(7, 42);
    clicks.on_edge(Edge::LeftDown, at, &mut hit(Place::Other, 8));
    assert_eq!(
        clicks.on_edge(Edge::LeftUp, at, &mut hit(Place::Other, 8)),
        None,
        "started elsewhere"
    );
    clicks.on_edge(Edge::LeftDown, at, &mut hit(Place::Other, 7));
    let end = Point { x: 300, y: 200 };
    assert_eq!(
        clicks.on_edge(Edge::LeftUp, end, &mut hit(Place::Other, 1)),
        Some((42, end))
    );
    assert_eq!(
        clicks.on_edge(Edge::LeftUp, end, &mut hit(Place::Other, 1)),
        None,
        "reported once"
    );
    clicks.watch_release(0, 0);
    clicks.on_edge(Edge::LeftDown, at, &mut hit(Place::Other, 0));
    assert_eq!(
        clicks.on_edge(Edge::LeftUp, end, &mut hit(Place::Other, 0)),
        None,
        "watch off"
    );
}

#[test]
fn sampling_turns_polled_state_into_releases_and_classifies_only_on_change() {
    let mut clicks = Clicks::default();
    clicks.watch_release(7, 9);
    let keys = Keys::default();
    let lookups = std::cell::Cell::new(0);
    let mut under = |_: Point| {
        lookups.set(lookups.get() + 1);
        Hit {
            place: Place::Other,
            root: 7,
        }
    };
    let none = Buttons::default();
    let held = Buttons { left: DOWN, ..none };
    assert!(
        clicks
            .sample(&none, &keys, Point::default(), &mut under)
            .is_empty()
    );
    assert!(
        clicks
            .sample(&held, &keys, Point::default(), &mut under)
            .is_empty()
    );
    for _ in 0..100 {
        assert!(
            clicks
                .sample(
                    &Buttons {
                        left: Button {
                            down: true,
                            since: false
                        },
                        ..none
                    },
                    &keys,
                    Point::default(),
                    &mut under
                )
                .is_empty()
        );
    }
    let releases = clicks.sample(&none, &keys, Point { x: 4, y: 5 }, &mut under);
    assert_eq!(releases, vec![(9, Point { x: 4, y: 5 })]);
    assert_eq!(lookups.get(), 1, "only the press needed a window lookup");
    // A whole click between samples is still a drag end.
    clicks.watch_release(7, 10);
    let quick = clicks.sample(
        &Buttons {
            left: TAPPED,
            ..none
        },
        &keys,
        Point { x: 1, y: 2 },
        &mut under,
    );
    assert_eq!(quick, vec![(10, Point { x: 1, y: 2 })]);
    let _ = UP;
}

fn seen(identity: Identity, visible: bool, rect: Option<Rect>) -> Observation {
    Observation {
        identity,
        visible,
        iconic: false,
        zoomed: false,
        rect,
    }
}

const R: Rect = Rect {
    left: 10,
    top: 20,
    right: 110,
    bottom: 220,
};

#[test]
fn followed_window_reports_position_once_per_change() {
    let mut anchor = Anchor::new(4);
    let first = anchor.observe(&seen(Identity::Verified, true, Some(R)), 0);
    assert_eq!(
        first.line.as_deref(),
        Some("anchor 4 visible 10 20 100 200")
    );
    assert!(!first.stop);
    assert_eq!(
        anchor
            .observe(&seen(Identity::Verified, true, Some(R)), 10)
            .line,
        None,
        "unchanged"
    );
    let moved = Rect { left: 11, ..R };
    assert_eq!(
        anchor
            .observe(&seen(Identity::Verified, true, Some(moved)), 20)
            .line
            .as_deref(),
        Some("anchor 4 visible 11 20 99 200")
    );
}

#[test]
fn followed_window_hidden_closed_maximized_or_gone_ends_following() {
    let mut a = Anchor::new(1);
    let out = a.observe(&seen(Identity::Verified, false, Some(R)), 0);
    assert_eq!(
        (out.line.as_deref(), out.stop),
        (Some("anchor 1 hidden"), true)
    );
    let mut a = Anchor::new(2);
    let out = a.observe(&seen(Identity::Closed, true, Some(R)), 0);
    assert_eq!(
        (out.line.as_deref(), out.stop),
        (Some("anchor 2 closed"), true)
    );
    let mut a = Anchor::new(3);
    let out = a.observe(
        &Observation {
            zoomed: true,
            ..seen(Identity::Verified, true, Some(R))
        },
        0,
    );
    assert_eq!(out.line.as_deref(), Some("anchor 3 hidden"));
    let mut a = Anchor::new(5);
    let out = a.observe(
        &Observation {
            iconic: true,
            ..seen(Identity::Verified, true, Some(R))
        },
        0,
    );
    assert_eq!(out.line.as_deref(), Some("anchor 5 hidden"));
    let mut a = Anchor::new(0);
    assert_eq!(
        a.observe(&seen(Identity::Verified, true, Some(R)), 0).line,
        None
    );
}

#[test]
fn unverifiable_window_is_held_then_given_up() {
    let mut a = Anchor::new(6);
    assert_eq!(
        a.observe(&seen(Identity::Unavailable, true, None), 1000)
            .line
            .as_deref(),
        Some("anchor 6 unavailable")
    );
    assert_eq!(
        a.observe(&seen(Identity::Unavailable, true, None), 1500)
            .line,
        None,
        "already said"
    );
    let out = a.observe(&seen(Identity::Unavailable, true, None), 6000);
    assert_eq!(
        (out.line.as_deref(), out.stop),
        (Some("anchor 6 closed"), true),
        "5 s without proof"
    );

    // After a known position, a short hiccup is not reported; a long one is.
    let mut a = Anchor::new(7);
    a.observe(&seen(Identity::Verified, true, Some(R)), 0);
    assert_eq!(
        a.observe(&seen(Identity::Verified, true, None), 100).line,
        None
    );
    assert_eq!(
        a.observe(&seen(Identity::Verified, true, None), 849).line,
        None
    );
    assert_eq!(
        a.observe(&seen(Identity::Verified, true, None), 850)
            .line
            .as_deref(),
        Some("anchor 7 unavailable")
    );
    // Recovery resets the clock.
    assert!(
        a.observe(&seen(Identity::Verified, true, Some(R)), 900)
            .line
            .is_some()
    );
    assert_eq!(
        a.observe(&seen(Identity::Unavailable, true, None), 5000)
            .line,
        None
    );
}

#[test]
fn rectangle_choice_and_tick_conversion() {
    let empty = Rect {
        left: 5,
        top: 5,
        right: 5,
        bottom: 9,
    };
    assert_eq!(choose_rect(Some(R), Some(empty)), Some(R));
    assert_eq!(choose_rect(Some(empty), Some(R)), Some(R));
    assert_eq!(choose_rect(None, None), None);
    assert_eq!(choose_rect(Some(empty), None), None);
    // 2026-01-01T00:00:00Z: FILETIME 134116992000000000, .NET ticks 639028224000000000.
    assert_eq!(
        filetime_to_ticks(134_116_992_000_000_000),
        Some(639_028_224_000_000_000)
    );
    assert_eq!(filetime_to_ticks(u64::MAX), None);
}
