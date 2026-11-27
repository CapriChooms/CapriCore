// SPDX-License-Identifier: GPL-3.0-only
//! Thin Windows calls, checked against the real desktop.
#![cfg(windows)]

use capri_desktop_teleport::clicks::{Place, Point};
use capri_desktop_teleport::win::{self, PipeServer, Ticker, decide_place};
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::RECT;
use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowW, GetWindowRect};

fn taskbar() -> isize {
    let class = win::wide("Shell_TrayWnd");
    unsafe { FindWindowW(class.as_ptr(), std::ptr::null()) as isize }
}

#[test]
fn decide_place_follows_the_desktop_and_folder_rules() {
    // Not Explorer: never the desktop, whatever the classes say.
    assert_eq!(
        decide_place(false, "Progman", "SysListView32"),
        Place::Other
    );
    // The desktop: its root and the hit control are both desktop classes.
    for (root, hit) in [
        ("Progman", "SysListView32"),
        ("WorkerW", "SHELLDLL_DefView"),
        ("Progman", "Progman"),
        ("WorkerW", "WorkerW"),
    ] {
        assert_eq!(
            decide_place(true, root, hit),
            Place::Desktop,
            "{root}/{hit}"
        );
    }
    // Folders and the taskbar are left to Explorer.
    for root in [
        "CabinetWClass",
        "ExploreWClass",
        "Shell_TrayWnd",
        "Shell_SecondaryTrayWnd",
    ] {
        assert_eq!(decide_place(true, root, "Button"), Place::Other, "{root}");
    }
    // Any other Explorer menu.
    assert_eq!(decide_place(true, "#32768", "Progman"), Place::ShellMenu);
    assert_eq!(decide_place(true, "Progman", "Button"), Place::ShellMenu);
}

#[test]
fn class_names_are_read_from_the_window() {
    assert_eq!(win::class_name(taskbar()), "Shell_TrayWnd");
    assert_eq!(win::class_name(0), "");
}

#[test]
fn classify_reports_the_taskbar_and_nothing_off_screen() {
    let bar = taskbar();
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    assert_ne!(unsafe { GetWindowRect(bar as _, &mut rect) }, 0);
    let on_bar = Point {
        x: (rect.left + rect.right) / 2,
        y: (rect.top + rect.bottom) / 2,
    };
    let hit = win::classify(on_bar);
    assert_eq!(
        hit.place,
        Place::Other,
        "the taskbar is not a teleport target"
    );
    assert_ne!(hit.root, 0);

    let nowhere = win::classify(Point {
        x: -1_000_000,
        y: -1_000_000,
    });
    assert_eq!(nowhere.root, 0);
    assert_eq!(nowhere.place, Place::Other);
}

#[test]
fn a_ticker_waits_and_the_fallback_sleeps() {
    let ticker = Ticker::new().expect("high-resolution waitable timer");
    let started = Instant::now();
    ticker.wait_micros(2000);
    assert!(started.elapsed() >= Duration::from_micros(1500));

    let started = Instant::now();
    win::wait_on_timer(0, 3000);
    assert!(started.elapsed() >= Duration::from_micros(2500));
}

#[test]
fn a_second_pipe_with_the_same_name_is_refused() {
    let name = format!(r"\\.\pipe\Capri.DesktopTeleport.test{}", std::process::id());
    let first = PipeServer::create(&name).expect("first instance");
    assert!(PipeServer::create(&name).is_none(), "first-instance rule");
    drop(first);
    assert!(
        PipeServer::create(&name).is_some(),
        "free again once closed"
    );
}

#[test]
fn process_identity_is_the_start_time_of_a_live_process() {
    let pid = std::process::id();
    let ticks = win::process_identity(pid).expect("own start time");
    assert!(ticks > 0);
    assert_eq!(win::process_identity(pid), Ok(ticks), "stable");
}

#[test]
fn process_identity_says_closed_for_a_process_that_does_not_exist() {
    assert_eq!(
        win::process_identity(0x7FFF_FFF0),
        Err(capri_desktop_teleport::anchor::Identity::Closed)
    );
}

#[test]
fn process_identity_says_closed_for_a_process_that_has_exited() {
    let mut child = std::process::Command::new("cmd")
        .args(["/C", "exit 3"])
        .spawn()
        .unwrap();
    assert_eq!(child.wait().unwrap().code(), Some(3));
    // The Child still holds the process handle, so the exit code is readable.
    assert_eq!(
        win::process_identity(child.id()),
        Err(capri_desktop_teleport::anchor::Identity::Closed)
    );
}

#[test]
fn process_identity_for_a_protected_process_is_never_called_closed() {
    // System (pid 4) is refused to an ordinary user (access denied), which is not evidence it exited.
    // An elevated run may open it instead; either way it must not be reported closed.
    let answer = win::process_identity(4);
    assert_ne!(
        answer,
        Err(capri_desktop_teleport::anchor::Identity::Closed)
    );
}
