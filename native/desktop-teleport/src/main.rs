// SPDX-License-Identifier: GPL-3.0-only
#![windows_subsystem = "windows"]

// Returning from `main` (rather than calling `process::exit`) lets the
// instrumented binary write its coverage profile on the way out.
fn main() -> std::process::ExitCode {
    #[cfg(windows)]
    {
        let code = capri_desktop_teleport::watch::run(std::env::args().skip(1).collect());
        std::process::ExitCode::from(u8::try_from(code & 0xff).unwrap_or(1))
    }
    #[cfg(not(windows))]
    std::process::ExitCode::from(1)
}
