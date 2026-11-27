// SPDX-License-Identifier: GPL-3.0-only
//! Thin Windows calls. Nothing here installs an input hook.

use crate::anchor::{Identity, Rect, filetime_to_ticks};
use crate::clicks::{Button, Buttons, Hit, Keys, Place, Point};
use std::ffi::c_void;
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_PIPE_CONNECTED, FILETIME, GetLastError, HANDLE, HWND, INVALID_HANDLE_VALUE,
    LocalFree, POINT, RECT,
};
use windows_sys::Win32::Graphics::Dwm::{DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute};
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
};
use windows_sys::Win32::Security::{
    GetTokenInformation, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
    TokenUser,
};
use windows_sys::Win32::Storage::FileSystem::{CreateFileW, OPEN_EXISTING, PIPE_ACCESS_INBOUND};
use windows_sys::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, PIPE_REJECT_REMOTE_CLIENTS,
    PIPE_TYPE_BYTE, PIPE_WAIT, WaitNamedPipeW,
};
use windows_sys::Win32::System::Threading::{
    CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, CreateWaitableTimerExW, GetCurrentProcess,
    GetExitCodeProcess, GetProcessTimes, INFINITE, OpenProcess, OpenProcessToken,
    PROCESS_QUERY_LIMITED_INFORMATION, SetWaitableTimer, TIMER_ALL_ACCESS, WaitForSingleObject,
};
use windows_sys::Win32::UI::HiDpi::{
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetProcessDpiAwarenessContext,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_APPS, VK_ESCAPE, VK_F10, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON, VK_SHIFT,
    VK_XBUTTON1, VK_XBUTTON2,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GA_ROOT, GetAncestor, GetClassNameW, GetCursorPos, GetShellWindow, GetWindowRect,
    GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, IsZoomed,
    WindowFromPhysicalPoint,
};

const FILE_FLAG_FIRST_PIPE_INSTANCE: u32 = 0x0008_0000;
const GENERIC_WRITE: u32 = 0x4000_0000;
const STILL_ACTIVE: u32 = 259;
const ERROR_INVALID_PARAMETER: u32 = 87;

pub fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

pub fn hwnd(value: isize) -> HWND {
    value as HWND
}

/// Physical pixels everywhere, like the hook's MSLLHOOKSTRUCT point was.
pub fn per_monitor_dpi() {
    unsafe {
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
}

fn button(key: u16) -> Button {
    // High bit: held now. Low bit: pressed since the previous call.
    let state = unsafe { GetAsyncKeyState(key as i32) } as u16;
    Button {
        down: state & 0x8000 != 0,
        since: state & 1 != 0,
    }
}

pub fn read_buttons() -> Buttons {
    Buttons {
        left: button(VK_LBUTTON),
        right: button(VK_RBUTTON),
        middle: button(VK_MBUTTON),
        x1: button(VK_XBUTTON1),
        x2: button(VK_XBUTTON2),
    }
}

pub fn read_keys() -> Keys {
    Keys {
        escape: button(VK_ESCAPE),
        apps: button(VK_APPS),
        f10: button(VK_F10),
        shift: button(VK_SHIFT).down,
    }
}

pub fn cursor() -> Point {
    let mut point = POINT { x: 0, y: 0 };
    unsafe { GetCursorPos(&mut point) };
    Point {
        x: point.x,
        y: point.y,
    }
}

pub fn class_name(window: isize) -> String {
    let mut buffer = [0u16; 128];
    let length = unsafe { GetClassNameW(hwnd(window), buffer.as_mut_ptr(), buffer.len() as i32) };
    String::from_utf16_lossy(&buffer[..length.max(0) as usize])
}

fn window_process(window: HWND) -> u32 {
    let mut process = 0;
    unsafe { GetWindowThreadProcessId(window, &mut process) };
    process
}

/// Where a click landed, given whether it belongs to Explorer and the window classes
/// of the hit window and its top-level ancestor. Pure, so every branch is testable.
pub fn decide_place(explorer: bool, root_class: &str, hit_class: &str) -> Place {
    if !explorer {
        return Place::Other;
    }
    let desktop = matches!(root_class, "Progman" | "WorkerW")
        && matches!(
            hit_class,
            "SysListView32" | "SHELLDLL_DefView" | "Progman" | "WorkerW"
        );
    let folder_or_taskbar = matches!(
        root_class,
        "CabinetWClass" | "ExploreWClass" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
    );
    if desktop {
        Place::Desktop
    } else if folder_or_taskbar {
        Place::Other
    } else {
        Place::ShellMenu
    }
}

/// Explorer's desktop and its menus, decided the same way the C# helper did.
pub fn classify(point: Point) -> Hit {
    let window = unsafe {
        WindowFromPhysicalPoint(POINT {
            x: point.x,
            y: point.y,
        })
    };
    let root = unsafe { GetAncestor(window, GA_ROOT) };
    let process = window_process(window);
    let explorer = process != 0 && process == window_process(unsafe { GetShellWindow() });
    let place = decide_place(
        explorer,
        &class_name(root as isize),
        &class_name(window as isize),
    );
    Hit {
        place,
        root: root as isize,
    }
}

/// A timer that can wait well under the default 15.6 ms Windows tick.
pub struct Ticker(HANDLE);

impl Ticker {
    pub fn new() -> Option<Ticker> {
        let handle = unsafe {
            CreateWaitableTimerExW(
                null(),
                null(),
                CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
                TIMER_ALL_ACCESS,
            )
        };
        (!handle.is_null()).then_some(Ticker(handle))
    }

    pub fn wait_micros(&self, micros: i64) {
        wait_on_timer(self.0 as isize, micros);
    }
}

/// Waits on a waitable timer handle; falls back to a plain sleep if the timer cannot be armed.
pub fn wait_on_timer(handle: isize, micros: i64) {
    let handle = handle as HANDLE;
    let due = -(micros * 10); // relative, in 100 ns units
    unsafe {
        if SetWaitableTimer(handle, &due, 0, None, null(), 0) != 0 {
            WaitForSingleObject(handle, INFINITE);
        } else {
            std::thread::sleep(std::time::Duration::from_micros(micros as u64));
        }
    }
}

impl Drop for Ticker {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

// The timer handle is only used by the thread that owns the Ticker.
unsafe impl Send for Ticker {}

fn current_user_sid() -> Option<String> {
    unsafe {
        let mut token: HANDLE = null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return None;
        }
        let mut buffer = vec![0u8; 256];
        let mut length = 0;
        let ok = GetTokenInformation(
            token,
            TokenUser,
            buffer.as_mut_ptr().cast(),
            buffer.len() as u32,
            &mut length,
        );
        CloseHandle(token);
        if ok == 0 {
            return None;
        }
        let user = &*(buffer.as_ptr() as *const TOKEN_USER);
        let mut text: *mut u16 = null_mut();
        if ConvertSidToStringSidW(user.User.Sid, &mut text) == 0 {
            return None;
        }
        let mut end = 0;
        while *text.add(end) != 0 {
            end += 1;
        }
        let sid = String::from_utf16_lossy(std::slice::from_raw_parts(text, end));
        LocalFree(text as *mut c_void);
        Some(sid)
    }
}

/// The private pipe: inbound only, local only, and only this user may open it.
pub struct PipeServer(HANDLE);

unsafe impl Send for PipeServer {}

impl PipeServer {
    pub fn create(name: &str) -> Option<PipeServer> {
        let sid = current_user_sid()?;
        let sddl = wide(&format!("D:P(A;;GA;;;{sid})"));
        unsafe {
            let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
            if ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                1,
                &mut descriptor,
                null_mut(),
            ) == 0
            {
                return None;
            }
            let attributes = SECURITY_ATTRIBUTES {
                nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: descriptor,
                bInheritHandle: 0,
            };
            let handle = CreateNamedPipeW(
                wide(name).as_ptr(),
                PIPE_ACCESS_INBOUND | FILE_FLAG_FIRST_PIPE_INSTANCE,
                PIPE_TYPE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                1,
                64,
                0,
                0,
                &attributes,
            );
            LocalFree(descriptor);
            (handle != INVALID_HANDLE_VALUE).then_some(PipeServer(handle))
        }
    }

    /// Blocks until a client connects. A connection is the whole command.
    pub fn accept(&self) -> bool {
        unsafe {
            ConnectNamedPipe(self.0, null_mut()) != 0 || GetLastError() == ERROR_PIPE_CONNECTED
        }
    }

    pub fn disconnect(&self) {
        unsafe { DisconnectNamedPipe(self.0) };
    }
}

impl Drop for PipeServer {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

/// `--teleport`: what the Explorer menu entry runs. Connect, close, done.
pub fn connect_pipe(name: &str) {
    let name = wide(name);
    unsafe {
        if WaitNamedPipeW(name.as_ptr(), 750) == 0 {
            return;
        }
        let handle = CreateFileW(
            name.as_ptr(),
            GENERIC_WRITE,
            0,
            null(),
            OPEN_EXISTING,
            0,
            null_mut(),
        );
        if handle != INVALID_HANDLE_VALUE {
            CloseHandle(handle);
        }
    }
}

/// Window thread id and owning process id.
pub fn window_owner(window: isize) -> (u32, u32) {
    let mut process = 0;
    let thread = unsafe { GetWindowThreadProcessId(hwnd(window), &mut process) };
    (thread, process)
}

pub fn is_window(window: isize) -> bool {
    unsafe { IsWindow(hwnd(window)) != 0 }
}

/// Process start time as .NET ticks, if it is still running.
pub fn process_identity(process: u32) -> Result<i64, Identity> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process);
        if handle.is_null() {
            // Access denied is not evidence that the owner exited.
            return Err(if GetLastError() == ERROR_INVALID_PARAMETER {
                Identity::Closed
            } else {
                Identity::Unavailable
            });
        }
        let zero = FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        };
        let (mut created, mut exited, mut kernel, mut user) = (zero, zero, zero, zero);
        let mut code = 0;
        let ok = GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user) != 0
            && GetExitCodeProcess(handle, &mut code) != 0;
        CloseHandle(handle);
        if !ok {
            return Err(Identity::Unavailable);
        }
        if code != STILL_ACTIVE {
            return Err(Identity::Closed);
        }
        let filetime = ((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64;
        filetime_to_ticks(filetime).ok_or(Identity::Unavailable)
    }
}

pub struct WindowState {
    pub visible: bool,
    pub iconic: bool,
    pub zoomed: bool,
    pub dwm: Option<Rect>,
    pub outer: Option<Rect>,
}

fn rect(value: RECT) -> Rect {
    Rect {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
    }
}

pub fn window_state(window: isize) -> WindowState {
    let handle = hwnd(window);
    unsafe {
        let mut frame = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        let dwm = (DwmGetWindowAttribute(
            handle,
            DWMWA_EXTENDED_FRAME_BOUNDS as u32,
            (&mut frame as *mut RECT).cast(),
            size_of::<RECT>() as u32,
        ) == 0)
            .then(|| rect(frame));
        let mut outer_rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        let outer = (GetWindowRect(handle, &mut outer_rect) != 0).then(|| rect(outer_rect));
        WindowState {
            visible: IsWindowVisible(handle) != 0,
            iconic: IsIconic(handle) != 0,
            zoomed: IsZoomed(handle) != 0,
            dwm,
            outer,
        }
    }
}
