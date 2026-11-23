// SPDX-License-Identifier: GPL-3.0-only
#pragma once
#include <windows.h>
#include <cstdint>

namespace capri {
inline constexpr GUID cameraClass{0xe8bb7233, 0x74f8, 0x4c77, {0x98,0x72,0x89,0xd5,0x43,0xb7,0x5e,0x84}};
inline constexpr wchar_t cameraName[] = L"Capri Camera";
inline constexpr wchar_t framesName[] = L"Local\\Capri.Camera.Frames.v1";
inline constexpr wchar_t producerName[] = L"Local\\Capri.Camera.Producer.v1";
inline constexpr int width = 640, height = 360, lumaSize = width * height;
inline constexpr int frameSize = lumaSize * 3 / 2;
inline constexpr int frameInterval = 333333; // 100 ns units

// Single producer, independently timed consumers. No reader can hold up the
// application or read a frame that straddles two writes.
struct Frames {
    volatile LONG sequence;
    LONG active;
    ULONGLONG updated;
    uint8_t pixels[frameSize];
};
}
