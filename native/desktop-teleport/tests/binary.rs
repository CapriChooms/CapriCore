// SPDX-License-Identifier: GPL-3.0-only
//! Runs the real helper the way Capri does.
#![cfg(windows)]

use capri_desktop_teleport::win;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};

const EXE: &str = env!("CARGO_BIN_EXE_capri-teleport");

fn token() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{:032x}", nanos ^ ((std::process::id() as u128) << 64))
}

fn lines(stdout: ChildStdout) -> Receiver<String> {
    let (send, receive) = channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if send.send(line).is_err() {
                break;
            }
        }
    });
    receive
}

fn start(token: &str) -> (Child, Receiver<String>) {
    let mut child = Command::new(EXE)
        .args(["--watch", token])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let output = lines(child.stdout.take().unwrap());
    assert_eq!(
        output.recv_timeout(Duration::from_secs(4)).unwrap(),
        "ready"
    );
    (child, output)
}

fn exits_within(child: &mut Child, limit: Duration) -> bool {
    let until = Instant::now() + limit;
    while Instant::now() < until {
        if child.try_wait().unwrap().is_some() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    false
}

#[test]
fn bad_arguments_are_refused() {
    for args in [
        vec![],
        vec!["--watch"],
        vec!["--watch", "nothex"],
        vec!["--other", "0123456789abcdef0123456789abcdef"],
    ] {
        assert_eq!(
            Command::new(EXE).args(&args).status().unwrap().code(),
            Some(1),
            "{args:?}"
        );
    }
}

#[test]
fn helper_exits_when_capri_closes_its_input() {
    let (mut child, _output) = start(&token());
    drop(child.stdin.take());
    assert!(exits_within(&mut child, Duration::from_secs(2)));
    assert_eq!(child.wait().unwrap().code(), Some(0));
}

#[test]
fn helper_dies_when_its_parent_is_killed_outright() {
    // A Node parent spawns the helper with a stdin pipe, exactly as Capri's
    // Electron process does, then is killed with no chance to clean up.
    let token = token();
    let script = format!(
        "require('child_process').spawn({exe:?}, ['--watch', {token:?}], {{ stdio: ['pipe', 'inherit', 'ignore'] }}); setInterval(() => {{}}, 1e6);",
        exe = EXE
    );
    let mut parent = Command::new("node")
        .args(["-e", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let output = lines(parent.stdout.take().unwrap());
    assert_eq!(
        output.recv_timeout(Duration::from_secs(4)).unwrap(),
        "ready"
    );
    let helper = find_helper(&token).expect("helper pid");
    parent.kill().unwrap(); // TerminateProcess: no cleanup runs in the parent
    let _ = parent.wait();
    let until = Instant::now() + Duration::from_secs(3);
    while Instant::now() < until && running(helper) {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(!running(helper), "helper {helper} outlived its parent");
}

fn find_helper(token: &str) -> Option<u32> {
    let out = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!("(Get-CimInstance Win32_Process -Filter \"Name='capri-teleport.exe'\" | Where-Object {{ $_.CommandLine -match '{token}' }}).ProcessId"),
        ])
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout)
        .trim()
        .lines()
        .next()?
        .trim()
        .parse()
        .ok()
}

fn running(pid: u32) -> bool {
    let out = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout).contains("capri-teleport")
}

#[test]
fn explorer_menu_entry_without_a_desktop_right_click_reports_nothing() {
    let token = token();
    let (mut child, output) = start(&token);
    let status = Command::new(EXE)
        .args(["--teleport", &token])
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(0));
    assert!(
        output.recv_timeout(Duration::from_millis(500)).is_err(),
        "no remembered point, no line"
    );
    // A second helper cannot take over the same pipe name.
    let second = Command::new(EXE)
        .args(["--watch", &token])
        .stdin(Stdio::piped())
        .output()
        .unwrap();
    assert_eq!(second.status.code(), Some(1));
    drop(child.stdin.take());
    assert!(exits_within(&mut child, Duration::from_secs(2)));
}

#[test]
fn teleport_with_no_helper_running_returns_quickly() {
    let started = Instant::now();
    assert_eq!(
        Command::new(EXE)
            .args(["--teleport", &token()])
            .status()
            .unwrap()
            .code(),
        Some(0)
    );
    assert!(started.elapsed() < Duration::from_secs(2));
}

fn send(child: &mut Child, line: &str) {
    let stdin = child.stdin.as_mut().unwrap();
    writeln!(stdin, "{line}").unwrap();
    stdin.flush().unwrap();
}

#[test]
fn following_a_missing_or_impersonated_window_reports_closed() {
    let (mut child, output) = start(&token());
    send(&mut child, "follow 5 0 0 0");
    assert_eq!(
        output.recv_timeout(Duration::from_secs(2)).unwrap(),
        "anchor 5 closed"
    );
    send(&mut child, "follow 6 999999 4 638000000000000000");
    assert_eq!(
        output.recv_timeout(Duration::from_secs(2)).unwrap(),
        "anchor 6 closed"
    );
    drop(child.stdin.take());
    assert!(exits_within(&mut child, Duration::from_secs(2)));
}

#[test]
fn following_a_real_window_reports_where_it_is() {
    // The taskbar always exists and is never maximized.
    let class: Vec<u16> = "Shell_TrayWnd\0".encode_utf16().collect();
    let window = unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::FindWindowW(class.as_ptr(), std::ptr::null())
    } as isize;
    assert_ne!(window, 0);
    let (_, process) = win::window_owner(window);
    let ticks = win::process_identity(process).expect("explorer start time");
    let (mut child, output) = start(&token());
    send(&mut child, &format!("follow 8 {window} {process} {ticks}"));
    let line = output.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(line.starts_with("anchor 8 visible "), "{line}");
    // Wrong start time means a different process now owns that id: closed.
    send(
        &mut child,
        &format!("follow 9 {window} {process} {}", ticks + 1),
    );
    assert_eq!(
        output.recv_timeout(Duration::from_secs(2)).unwrap(),
        "anchor 9 closed"
    );
    send(&mut child, "follow 0 0 0 0");
    drop(child.stdin.take());
    assert!(exits_within(&mut child, Duration::from_secs(2)));
}

#[test]
fn stdin_lines_that_are_not_commands_are_ignored() {
    let (mut child, output) = start(&token());
    send(&mut child, "0 5"); // a release watch, no drag yet: nothing printed
    send(&mut child, "not a command");
    assert!(output.recv_timeout(Duration::from_millis(300)).is_err());
    drop(child.stdin.take());
    assert!(exits_within(&mut child, Duration::from_secs(2)));
}

#[test]
fn one_input_sample_takes_well_under_a_millisecond() {
    let mut clicks = capri_desktop_teleport::clicks::Clicks::default();
    let rounds = 5000;
    let started = Instant::now();
    for _ in 0..rounds {
        let buttons = win::read_buttons();
        let keys = win::read_keys();
        let point = win::cursor();
        clicks.sample(&buttons, &keys, point, &mut win::classify);
    }
    let each = started.elapsed() / rounds;
    println!("one sample: {each:?}");
    assert!(each < Duration::from_micros(200), "{each:?}");
}

#[test]
fn helper_installs_no_input_hook() {
    // The C# helper imported SetWindowsHookExW; this one must not.
    let bytes = std::fs::read(EXE).unwrap();
    let text = String::from_utf8_lossy(&bytes);
    assert!(!text.contains("SetWindowsHookEx"));
    assert!(text.contains("GetAsyncKeyState"));
}

mod own_window {
    use super::*;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, MoveWindow, SW_HIDE, SW_MAXIMIZE, SW_MINIMIZE, ShowWindow,
        WS_CHILD, WS_POPUP, WS_VISIBLE,
    };

    /// A top-level window owned by this test process, so the helper can follow it.
    pub fn window(x: i32) -> isize {
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let title: Vec<u16> = "\0".encode_utf16().collect();
        let handle = unsafe {
            CreateWindowExW(
                0,
                class.as_ptr(),
                title.as_ptr(),
                WS_POPUP | WS_VISIBLE,
                x,
                100,
                200,
                150,
                null_mut(),
                null_mut(),
                null_mut(),
                null(),
            )
        };
        assert!(!handle.is_null());
        handle as isize
    }

    pub fn follow(child: &mut Child, id: i32, window: isize) {
        let process = std::process::id();
        let ticks = win::process_identity(process).expect("own start time");
        send(child, &format!("follow {id} {window} {process} {ticks}"));
    }

    pub fn move_to(window: isize, x: i32) {
        unsafe { MoveWindow(window as _, x, 300, 200, 150, 1) };
    }

    pub fn show(window: isize, command: i32) {
        unsafe { ShowWindow(window as _, command) };
    }

    pub fn destroy(window: isize) {
        unsafe { DestroyWindow(window as _) };
    }

    pub fn child_window(parent: isize) -> isize {
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let title: Vec<u16> = "\0".encode_utf16().collect();
        unsafe {
            CreateWindowExW(
                0,
                class.as_ptr(),
                title.as_ptr(),
                WS_CHILD | WS_VISIBLE,
                0,
                0,
                20,
                20,
                parent as _,
                null_mut(),
                null_mut(),
                null(),
            ) as isize
        }
    }

    pub fn minimize(window: isize) {
        show(window, SW_MINIMIZE);
    }

    pub fn maximize(window: isize) {
        show(window, SW_MAXIMIZE);
    }

    pub fn hide(window: isize) {
        show(window, SW_HIDE);
    }
}

#[test]
fn following_our_own_window_reports_each_change_and_its_end() {
    use own_window::*;
    let (mut child, output) = start(&token());
    let next = |output: &Receiver<String>| output.recv_timeout(Duration::from_secs(3));

    // Moves are reported once per change; a child control inside it is ignored.
    let moved = window(100);
    follow(&mut child, 31, moved);
    let first = next(&output).unwrap();
    assert!(first.starts_with("anchor 31 visible "), "{first}");
    // Idle long enough for the 500 ms fallback check to run with no event at all.
    std::thread::sleep(Duration::from_millis(1200));
    assert!(output.recv_timeout(Duration::from_millis(10)).is_err());
    // A burst of moves: most arrive while a refresh is already queued, and the
    // last one is what the follower must end up reporting.
    for i in 0..200 {
        move_to(moved, if i == 199 { 330 } else { 300 + i % 7 });
    }
    let mut line = next(&output).unwrap();
    while !line.contains(" 330 ") {
        line = next(&output).unwrap();
    }
    assert!(line.starts_with("anchor 31 visible "), "{line}");
    let inner = child_window(moved);
    assert!(
        output.recv_timeout(Duration::from_millis(400)).is_err(),
        "a child control is not the followed window"
    );
    destroy(inner);
    hide(moved);
    assert_eq!(next(&output).unwrap(), "anchor 31 hidden");

    // Destroying a visible window hides it first, which ends following.
    let gone = window(120);
    follow(&mut child, 32, gone);
    assert!(next(&output).unwrap().starts_with("anchor 32 visible "));
    destroy(gone);
    assert_eq!(next(&output).unwrap(), "anchor 32 hidden");

    // Minimizing ends following at once.
    let small = window(140);
    follow(&mut child, 33, small);
    assert!(next(&output).unwrap().starts_with("anchor 33 visible "));
    minimize(small);
    assert_eq!(next(&output).unwrap(), "anchor 33 hidden");
    destroy(small);

    // Maximizing is reported as a state, not a position.
    let big = window(160);
    follow(&mut child, 34, big);
    assert!(next(&output).unwrap().starts_with("anchor 34 visible "));
    maximize(big);
    // A maximized window is no longer where it was followed, so following ends.
    assert_eq!(next(&output).unwrap(), "anchor 34 hidden");
    destroy(big);

    send(&mut child, "follow 0 0 0 0");
    drop(child.stdin.take());
    assert!(exits_within(&mut child, Duration::from_secs(2)));
}
