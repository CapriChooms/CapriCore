// SPDX-License-Identifier: GPL-3.0-only
//! `--watch`: the long-running helper Capri starts and talks to over stdio.
//!
//! Threads:
//! - main: message loop; follows a window through WinEvent notifications
//!   (delivered asynchronously, never in the input path) plus a 500 ms check.
//! - poll: samples buttons, keys and cursor every POLL_INTERVAL_US.
//! - pipe: answers the Explorer menu entry with the remembered point.
//! - stdin: commands from Capri; end of input (Capri gone) ends the helper.

use crate::anchor::{Anchor, Identity, Observation, Outcome, choose_rect};
use crate::clicks::{Buttons, Clicks, Keys, Point};
use crate::protocol::{self, Command};
use crate::win;
use std::cell::RefCell;
use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use windows_sys::Win32::System::Threading::GetCurrentThreadId;
use windows_sys::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook, UnhookWinEvent};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetMessageW, KillTimer, MSG, PM_NOREMOVE, PeekMessageW, PostThreadMessageW,
    SetTimer, TranslateMessage, WM_APP, WM_QUIT, WM_TIMER,
};

/// How often buttons are sampled. A click lasts tens of milliseconds.
pub const POLL_INTERVAL_US: i64 = 2000;
const FALLBACK_CHECK_MS: u32 = 500;
const WM_FOLLOW: u32 = WM_APP + 1;
const WM_REFRESH: u32 = WM_APP + 2;

pub fn emit(line: &str) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

/// Writes each line to Capri in order.
pub fn emit_all(lines: impl IntoIterator<Item = String>) {
    for line in lines {
        emit(&line);
    }
}

/// The line reporting one watched release.
fn release_text((id, at): (i32, Point)) -> String {
    protocol::release_line(id, at.x, at.y)
}

/// Writes a menu reply, if there is one.
pub fn emit_reply(reply: Option<String>) {
    if let Some(line) = reply {
        emit(&line);
    }
}

/// Hands a message to Windows' default processing, as the message loop always did.
pub fn dispatch(message: &MSG) {
    unsafe {
        TranslateMessage(message);
        DispatchMessageW(message);
    }
}

fn post(thread: u32, message: u32, wparam: usize) {
    unsafe { PostThreadMessageW(thread, message, wparam, 0) };
}

pub fn run(args: Vec<String>) -> i32 {
    match args.as_slice() {
        [mode, token] if protocol::valid_token(token) => match mode.as_str() {
            "--watch" => watch(&protocol::pipe_name(token)),
            "--teleport" => {
                win::connect_pipe(&protocol::pipe_name(token));
                0
            }
            _ => 1,
        },
        _ => 1,
    }
}

struct Follow {
    anchor: Anchor,
    window: isize,
    process: u32,
    thread: u32,
    started: i64,
    hooks: [HWINEVENTHOOK; 2],
    timer: usize,
    destroyed: bool,
    pending: bool,
    generation: usize,
}

thread_local! {
    static FOLLOW: RefCell<Option<Follow>> = const { RefCell::new(None) };
    static GENERATION: RefCell<usize> = const { RefCell::new(0) };
    static MAIN_THREAD: RefCell<u32> = const { RefCell::new(0) };
}

fn stop_following() {
    GENERATION.with(|g| *g.borrow_mut() += 1);
    if let Some(follow) = FOLLOW.with(|f| f.borrow_mut().take()) {
        unsafe {
            if follow.timer != 0 {
                KillTimer(std::ptr::null_mut(), follow.timer);
            }
            for hook in follow.hooks {
                if !hook.is_null() {
                    UnhookWinEvent(hook);
                }
            }
        }
    }
}

fn finish(outcome: Outcome) {
    if let Some(line) = outcome.line {
        emit(&line);
    }
    if outcome.stop {
        stop_following();
    }
}

fn end_with(state: &str) {
    let outcome = FOLLOW.with(|f| {
        f.borrow_mut()
            .as_mut()
            .map(|follow| follow.anchor.end(state))
    });
    if let Some(outcome) = outcome {
        finish(outcome);
    }
}

/// What the followed window currently is, given what Windows reports for it now.
/// `owner` is (thread, process) of the window; `expected` is what was followed.
/// Returns the verdict and, when it was not yet known, the thread id to remember.
pub fn judge(
    alive: bool,
    owner: (u32, u32),
    expected: (u32, u32, i64),
    identity_of: impl FnOnce(u32) -> Result<i64, Identity>,
) -> (Identity, Option<u32>) {
    let (thread, process) = owner;
    let (followed_process, followed_thread, started) = expected;
    if !alive {
        return (Identity::Closed, None);
    }
    if (process != 0 && process != followed_process)
        || (thread != 0 && followed_thread != 0 && thread != followed_thread)
    {
        return (Identity::Closed, None);
    }
    if process == 0 || thread == 0 {
        return (Identity::Unavailable, None);
    }
    match identity_of(process) {
        Ok(ticks) if ticks == started => {
            (Identity::Verified, (followed_thread == 0).then_some(thread))
        }
        Ok(_) => (Identity::Closed, None),
        Err(other) => (other, None),
    }
}

fn identity(follow: &mut Follow) -> Identity {
    let alive = !follow.destroyed && win::is_window(follow.window);
    let owner = if alive {
        win::window_owner(follow.window)
    } else {
        (0, 0)
    };
    let (verdict, learned) = judge(
        alive,
        owner,
        (follow.process, follow.thread, follow.started),
        win::process_identity,
    );
    if let Some(thread) = learned {
        follow.thread = thread;
    }
    verdict
}

fn check(started: Instant) {
    let outcome = FOLLOW.with(|f| {
        let mut slot = f.borrow_mut();
        let follow = slot.as_mut()?;
        let identity = identity(follow);
        let state = win::window_state(follow.window);
        let seen = Observation {
            identity,
            visible: state.visible,
            iconic: state.iconic,
            zoomed: state.zoomed,
            rect: choose_rect(state.dwm, state.outer),
        };
        Some(
            follow
                .anchor
                .observe(&seen, started.elapsed().as_millis() as i64),
        )
    });
    if let Some(outcome) = outcome {
        finish(outcome);
    }
}

unsafe extern "system" fn on_window_event(
    hook: HWINEVENTHOOK,
    kind: u32,
    window: windows_sys::Win32::Foundation::HWND,
    object: i32,
    child: i32,
    _thread: u32,
    _time: u32,
) {
    let destroyed = match event_kind(kind, object, child) {
        Event::Ignore => return,
        Event::Hidden => {
            // Minimize or hide ends it at once, before a quick restore can mask it.
            if owns(window as isize, hook) {
                end_with("hidden");
            }
            return;
        }
        Event::Moved { destroyed } => destroyed,
    };
    if !owns(window as isize, hook) {
        return;
    }
    // One queued refresh reads the latest position after a burst of moves.
    if let Some(generation) = note_change(destroyed) {
        post(MAIN_THREAD.with(|t| *t.borrow()), WM_REFRESH, generation);
    }
}

/// What a WinEvent means to the follower.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Event {
    Ignore,
    Hidden,
    Moved { destroyed: bool },
}

/// Only the followed top-level window itself, never controls inside it.
pub fn event_kind(kind: u32, object: i32, child: i32) -> Event {
    if kind >= 0x8000 && (object != 0 || child != 0) {
        return Event::Ignore;
    }
    match kind {
        // EVENT_SYSTEM_MINIMIZESTART, EVENT_OBJECT_HIDE
        0x0016 | 0x8003 => Event::Hidden,
        // EVENT_OBJECT_DESTROY
        0x8001 => Event::Moved { destroyed: true },
        // EVENT_OBJECT_SHOW, EVENT_OBJECT_LOCATIONCHANGE, EVENT_SYSTEM_MINIMIZEEND
        0x8002 | 0x800A | 0x800B | 0x0017 => Event::Moved { destroyed: false },
        _ => Event::Ignore,
    }
}

fn owns(window: isize, hook: HWINEVENTHOOK) -> bool {
    FOLLOW.with(|f| {
        f.try_borrow()
            .map(|slot| owned_by(slot.as_ref(), window, hook))
            .unwrap_or(false)
    })
}

/// Whether the followed window is `window` and the event came through one of our hooks.
fn owned_by(follow: Option<&Follow>, window: isize, hook: HWINEVENTHOOK) -> bool {
    follow.is_some_and(|x| x.window == window && x.hooks.contains(&hook))
}

/// Marks a change as pending; returns the generation to post only when none was pending.
fn note_change(destroyed: bool) -> Option<usize> {
    FOLLOW.with(|f| mark_pending(&mut f.borrow_mut(), destroyed))
}

fn mark_pending(slot: &mut Option<Follow>, destroyed: bool) -> Option<usize> {
    let follow = slot.as_mut()?;
    if destroyed {
        follow.destroyed = true;
    }
    if follow.pending {
        return None;
    }
    follow.pending = true;
    Some(follow.generation)
}

/// Clears the pending flag for a refresh posted for `generation`; true when it is still current.
fn take_refresh(slot: &mut Option<Follow>, generation: usize) -> bool {
    slot.as_mut().is_some_and(|follow| {
        let same = follow.generation == generation && follow.anchor.id != 0;
        if same {
            follow.pending = false;
        }
        same
    })
}

fn follow_window(id: i32, window: isize, process: u32, ticks: i64, started: Instant) {
    stop_following();
    if id <= 0 {
        return;
    }
    if window == 0 || process == 0 || ticks <= 0 {
        emit(&protocol::anchor_line(id, "closed"));
        return;
    }
    let (thread, actual) = win::window_owner(window);
    if !win::is_window(window) || (actual != 0 && actual != process) {
        emit(&protocol::anchor_line(id, "closed"));
        return;
    }
    let hooks = unsafe {
        [
            SetWinEventHook(
                0x8001,
                0x800B,
                std::ptr::null_mut(),
                Some(on_window_event),
                process,
                thread,
                0,
            ),
            SetWinEventHook(
                0x0016,
                0x0017,
                std::ptr::null_mut(),
                Some(on_window_event),
                process,
                thread,
                0,
            ),
        ]
    };
    let generation = GENERATION.with(|g| *g.borrow());
    FOLLOW.with(|f| {
        *f.borrow_mut() = Some(Follow {
            anchor: Anchor::new(id),
            window,
            process,
            thread,
            started: ticks,
            hooks,
            timer: 0,
            destroyed: false,
            pending: false,
            generation,
        })
    });
    check(started);
    FOLLOW.with(|f| {
        if let Some(follow) = f.borrow_mut().as_mut() {
            follow.timer = unsafe { SetTimer(std::ptr::null_mut(), 0, FALLBACK_CHECK_MS, None) };
        }
    });
}

/// One sampling pass; `None` when the shared state is unusable (a poisoned lock).
pub fn sample_releases(
    clicks: &Mutex<Clicks>,
    buttons: &Buttons,
    keys: &Keys,
    point: Point,
) -> Option<Vec<(i32, Point)>> {
    clicks
        .lock()
        .ok()
        .map(|mut state| state.sample(buttons, keys, point, &mut win::classify))
}

/// Waits out the rest of a poll interval, on the high-resolution timer when there is one.
pub fn pause(ticker: Option<&win::Ticker>) {
    match ticker {
        Some(ticker) => ticker.wait_micros(POLL_INTERVAL_US),
        None => std::thread::sleep(std::time::Duration::from_micros(POLL_INTERVAL_US as u64)),
    }
}

/// The line answering a menu entry: the remembered desktop point, if there is one.
pub fn origin_reply(clicks: &Mutex<Clicks>) -> Option<String> {
    clicks
        .lock()
        .ok()
        .and_then(|mut state| state.take_origin())
        .map(|point| protocol::origin_line(point.x, point.y))
}

fn poll_loop(clicks: Arc<Mutex<Clicks>>, stop: Arc<AtomicBool>) {
    let ticker = win::Ticker::new();
    while !stop.load(Ordering::Relaxed) {
        let buttons = win::read_buttons();
        let keys = win::read_keys();
        let point = win::cursor();
        let Some(releases) = sample_releases(&clicks, &buttons, &keys, point) else {
            return;
        };
        emit_all(releases.into_iter().map(release_text));
        pause(ticker.as_ref());
    }
}

/// Acts on one message from the main thread's queue.
fn route(message: &MSG, follows: &Mutex<Option<Command>>, started: Instant) {
    match message.message {
        WM_FOLLOW => {
            let next = follows.lock().ok().and_then(|mut slot| slot.take());
            if let Some(Command::Follow {
                id,
                window,
                process,
                ticks,
            }) = next
            {
                follow_window(id, window, process, ticks, started);
            }
        }
        WM_REFRESH => {
            let current = FOLLOW.with(|f| take_refresh(&mut f.borrow_mut(), message.wParam));
            if current {
                check(started);
            }
        }
        WM_TIMER if message.hwnd.is_null() => check(started),
        _ => dispatch(message),
    }
}

fn watch(pipe_name: &str) -> i32 {
    win::per_monitor_dpi();
    let main = unsafe { GetCurrentThreadId() };
    MAIN_THREAD.with(|t| *t.borrow_mut() = main);
    // Create this thread's message queue before other threads post to it.
    let mut message: MSG = unsafe { std::mem::zeroed() };
    unsafe { PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_NOREMOVE) };

    let Some(pipe) = win::PipeServer::create(pipe_name) else {
        return 1;
    };
    let clicks = Arc::new(Mutex::new(Clicks::default()));
    let stop = Arc::new(AtomicBool::new(false));
    let follows: Arc<Mutex<Option<Command>>> = Arc::new(Mutex::new(None));

    let poll = {
        let (clicks, stop) = (clicks.clone(), stop.clone());
        std::thread::spawn(move || poll_loop(clicks, stop))
    };
    {
        let clicks = clicks.clone();
        std::thread::spawn(move || {
            emit("ready");
            while pipe.accept() {
                let reply = origin_reply(&clicks);
                pipe.disconnect();
                emit_reply(reply);
            }
            post(main, WM_QUIT, 0);
        });
    }
    {
        let (clicks, follows) = (clicks.clone(), follows.clone());
        std::thread::spawn(move || {
            for line in std::io::stdin().lock().lines() {
                let Ok(line) = line else { break };
                match protocol::parse_command(&line) {
                    Some(Command::Release { window, id }) => {
                        if let Ok(mut c) = clicks.lock() {
                            c.watch_release(window, id);
                        }
                    }
                    Some(follow @ Command::Follow { .. }) => {
                        if let Ok(mut slot) = follows.lock() {
                            *slot = Some(follow);
                        }
                        post(main, WM_FOLLOW, 0);
                    }
                    None => {}
                }
            }
            // Capri closed our input: it exited or was killed.
            post(main, WM_QUIT, 0);
        });
    }

    let started = Instant::now();
    loop {
        let result = unsafe { GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) };
        if result <= 0 {
            break;
        }
        route(&message, &follows, started);
    }
    stop_following();
    stop.store(true, Ordering::Relaxed);
    let _ = poll.join();
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clicks::{Edge, Hit, Place};
    use std::ptr::null_mut;
    use std::time::Duration;

    fn follow(window: isize, process: u32, thread: u32, generation: usize, id: i32) -> Follow {
        Follow {
            anchor: Anchor::new(id),
            window,
            process,
            thread,
            started: 5,
            hooks: [null_mut(); 2],
            timer: 0,
            destroyed: false,
            pending: false,
            generation,
        }
    }

    // judge(alive, (thread, process), (process, thread, started), identity_of)

    #[test]
    fn judge_is_closed_once_the_window_is_gone() {
        let (verdict, learned) = judge(false, (4, 2), (2, 4, 5), |_| Ok(5));
        assert_eq!((verdict, learned), (Identity::Closed, None));
    }

    #[test]
    fn judge_is_closed_when_another_process_owns_the_window() {
        let (verdict, _) = judge(true, (4, 9), (2, 4, 5), |_| Ok(5));
        assert_eq!(verdict, Identity::Closed);
    }

    #[test]
    fn judge_is_closed_when_another_thread_owns_the_window() {
        let (verdict, _) = judge(true, (7, 2), (2, 4, 5), |_| Ok(5));
        assert_eq!(verdict, Identity::Closed);
    }

    #[test]
    fn judge_is_unavailable_without_an_owner() {
        assert_eq!(
            judge(true, (4, 0), (2, 0, 5), |_| Ok(5)).0,
            Identity::Unavailable
        );
        assert_eq!(
            judge(true, (0, 2), (2, 0, 5), |_| Ok(5)).0,
            Identity::Unavailable
        );
    }

    #[test]
    fn judge_verifies_the_start_time_and_learns_the_thread() {
        let (verdict, learned) = judge(true, (4, 2), (2, 0, 5), |pid| {
            assert_eq!(pid, 2, "the owner's process is the one checked");
            Ok(5)
        });
        assert_eq!((verdict, learned), (Identity::Verified, Some(4)));
    }

    #[test]
    fn judge_keeps_a_thread_it_already_knows() {
        let (verdict, learned) = judge(true, (4, 2), (2, 4, 5), |_| Ok(5));
        assert_eq!((verdict, learned), (Identity::Verified, None));
    }

    #[test]
    fn judge_is_closed_for_a_different_start_time() {
        let (verdict, learned) = judge(true, (4, 2), (2, 0, 5), |_| Ok(6));
        assert_eq!((verdict, learned), (Identity::Closed, None));
    }

    #[test]
    fn judge_passes_identity_lookup_failures_through() {
        assert_eq!(
            judge(true, (4, 2), (2, 0, 5), |_| Err(Identity::Unavailable)).0,
            Identity::Unavailable
        );
        assert_eq!(
            judge(true, (4, 2), (2, 0, 5), |_| Err(Identity::Closed)).0,
            Identity::Closed
        );
    }

    #[test]
    fn events_map_to_hidden_moved_or_ignored() {
        assert_eq!(event_kind(0x8001, 0, 0), Event::Moved { destroyed: true });
        for kind in [0x8002, 0x800A, 0x800B, 0x0017] {
            assert_eq!(
                event_kind(kind, 0, 0),
                Event::Moved { destroyed: false },
                "{kind:#x}"
            );
        }
        assert_eq!(
            event_kind(0x0016, 5, 5),
            Event::Hidden,
            "system events ignore ids"
        );
        assert_eq!(event_kind(0x8003, 0, 0), Event::Hidden);
        // Child controls and object-level events are never the followed window.
        assert_eq!(event_kind(0x8001, 1, 0), Event::Ignore);
        assert_eq!(event_kind(0x800B, 0, 3), Event::Ignore);
        // Events we do not follow.
        assert_eq!(event_kind(0x8000, 0, 0), Event::Ignore);
        assert_eq!(event_kind(0x0001, 0, 0), Event::Ignore);
    }

    #[test]
    fn owned_by_needs_our_window_and_one_of_our_hooks() {
        let ours = 8usize as HWINEVENTHOOK;
        assert!(!owned_by(None, 5, null_mut()));
        let mut mine = follow(5, 2, 4, 0, 1);
        mine.hooks = [ours, null_mut()];
        assert!(owned_by(Some(&mine), 5, ours));
        assert!(!owned_by(Some(&mine), 6, ours), "another window");
        assert!(
            !owned_by(Some(&mine), 5, 16usize as HWINEVENTHOOK),
            "another hook"
        );
    }

    #[test]
    fn a_change_is_queued_once_until_the_refresh_runs() {
        let mut slot = None;
        assert_eq!(mark_pending(&mut slot, false), None, "nothing followed");
        slot = Some(follow(5, 2, 4, 3, 1));
        assert_eq!(mark_pending(&mut slot, false), Some(3));
        assert_eq!(mark_pending(&mut slot, false), None, "already queued");
        assert!(!slot.as_ref().unwrap().destroyed);
        assert_eq!(mark_pending(&mut slot, true), None);
        assert!(
            slot.as_ref().unwrap().destroyed,
            "a destroyed window is remembered"
        );
    }

    #[test]
    fn a_refresh_is_taken_only_for_the_current_follow() {
        let mut slot = None;
        assert!(!take_refresh(&mut slot, 3), "nothing followed");
        slot = Some(follow(5, 2, 4, 3, 1));
        slot.as_mut().unwrap().pending = true;
        assert!(!take_refresh(&mut slot, 2), "an older follow");
        assert!(
            slot.as_ref().unwrap().pending,
            "left queued for the right one"
        );
        assert!(take_refresh(&mut slot, 3));
        assert!(!slot.as_ref().unwrap().pending, "cleared once taken");
        slot = Some(follow(5, 2, 4, 3, 0));
        assert!(!take_refresh(&mut slot, 3), "an anchor that was stopped");
    }

    #[test]
    fn a_pause_without_a_timer_sleeps_one_poll_interval() {
        let started = Instant::now();
        pause(None);
        assert!(started.elapsed() >= Duration::from_micros(POLL_INTERVAL_US as u64));
    }

    #[test]
    fn sampling_reports_nothing_when_no_button_moved() {
        let clicks = Mutex::new(Clicks::default());
        let releases = sample_releases(
            &clicks,
            &Buttons::default(),
            &Keys::default(),
            Point { x: 1, y: 2 },
        );
        assert_eq!(releases, Some(Vec::new()));
    }

    #[test]
    fn a_poisoned_click_state_stops_sampling_and_answers_nothing() {
        let clicks = std::sync::Arc::new(Mutex::new(Clicks::default()));
        let poisoner = clicks.clone();
        let _ = std::thread::spawn(move || {
            let _guard = poisoner.lock().unwrap();
            panic!("poison the lock for the test");
        })
        .join();
        assert!(clicks.is_poisoned());
        assert_eq!(
            sample_releases(
                &clicks,
                &Buttons::default(),
                &Keys::default(),
                Point::default()
            ),
            None
        );
        assert_eq!(origin_reply(&clicks), None);
    }

    #[test]
    fn a_menu_entry_gets_the_remembered_desktop_point_once() {
        let clicks = Mutex::new(Clicks::default());
        assert_eq!(origin_reply(&clicks), None, "nothing remembered yet");
        let at = Point { x: 900, y: 400 };
        let desktop = |_: Point| Hit {
            place: Place::Desktop,
            root: 1,
        };
        clicks
            .lock()
            .unwrap()
            .on_edge(Edge::RightDown, at, &mut { desktop });
        assert_eq!(origin_reply(&clicks).as_deref(), Some("900 400"));
        assert_eq!(origin_reply(&clicks), None, "handed over once");
    }

    #[test]
    fn identity_is_closed_for_no_window_and_verified_for_a_live_owner() {
        let mut none = follow(0, 2, 0, 0, 1);
        assert_eq!(identity(&mut none), Identity::Closed);
        let mut gone = follow(5, 2, 0, 0, 1);
        gone.destroyed = true;
        assert_eq!(identity(&mut gone), Identity::Closed);

        // The taskbar always exists; follow it as its real owner, learning its thread.
        let class = win::wide("Shell_TrayWnd");
        let taskbar = unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::FindWindowW(
                class.as_ptr(),
                std::ptr::null(),
            )
        } as isize;
        let (thread, process) = win::window_owner(taskbar);
        let ticks = win::process_identity(process).expect("taskbar owner start time");
        let mut live = follow(taskbar, process, 0, 0, 1);
        live.started = ticks;
        assert_eq!(identity(&mut live), Identity::Verified);
        assert_eq!(live.thread, thread, "the owning thread is remembered");
    }

    #[test]
    fn a_poisoned_poll_stops_the_sampling_thread() {
        let clicks = std::sync::Arc::new(Mutex::new(Clicks::default()));
        let poisoner = clicks.clone();
        let _ = std::thread::spawn(move || {
            let _guard = poisoner.lock().unwrap();
            panic!("poison the lock for the test");
        })
        .join();
        // Returns at once instead of sampling forever.
        poll_loop(clicks, std::sync::Arc::new(AtomicBool::new(false)));
    }

    #[test]
    fn a_burst_of_changes_queues_one_refresh_through_the_hook_callback() {
        let hook = 8usize as HWINEVENTHOOK;
        let window = 5isize;
        let mut mine = follow(window, 2, 4, 1, 9);
        mine.hooks = [hook, null_mut()];
        FOLLOW.with(|f| *f.borrow_mut() = Some(mine));
        let at = |kind: u32| unsafe { on_window_event(hook, kind, window as _, 0, 0, 0, 0) };
        at(0x800B); // a move: queues the refresh
        assert!(FOLLOW.with(|f| f.borrow().as_ref().unwrap().pending));
        at(0x800B); // a second move while one is queued: nothing more to queue
        at(0x8000); // object create: ignored outright
        let other = 9isize;
        unsafe { on_window_event(hook, 0x800B, other as _, 0, 0, 0, 0) }; // not our window
        FOLLOW.with(|f| *f.borrow_mut() = None);
    }

    #[test]
    fn unknown_messages_go_to_windows_and_a_follow_request_without_a_command_does_nothing() {
        let follows = Mutex::new(None);
        let mut message: MSG = unsafe { std::mem::zeroed() };
        message.message = 0x0400; // WM_USER: not ours
        route(&message, &follows, Instant::now());
        message.message = WM_FOLLOW;
        route(&message, &follows, Instant::now());
        message.message = WM_REFRESH;
        message.wParam = 99;
        route(&message, &follows, Instant::now());
        assert!(follows.lock().unwrap().is_none());
    }

    #[test]
    fn a_release_is_reported_with_its_point() {
        assert_eq!(release_text((3, Point { x: 1, y: -2 })), "release 3 1 -2");
    }

    #[test]
    fn replies_and_releases_are_written_in_order_and_nothing_is_written_for_none() {
        emit_reply(None);
        emit_reply(Some("900 400".to_string()));
        emit_all(["release 3 1 2".to_string(), "release 4 5 6".to_string()]);
        emit_all(std::iter::empty());
    }

    #[test]
    fn messages_without_a_handler_are_dispatched_by_windows() {
        let message: MSG = unsafe { std::mem::zeroed() };
        dispatch(&message);
    }

    #[test]
    fn the_null_handle_falls_back_to_a_sleep() {
        let started = Instant::now();
        win::wait_on_timer(0, 1000);
        assert!(started.elapsed() >= Duration::from_micros(1000));
    }
}
