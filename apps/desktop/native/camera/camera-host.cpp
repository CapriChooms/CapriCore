// SPDX-License-Identifier: GPL-3.0-only
#include <windows.h>
#include <objbase.h>
#include <cstdio>
#include <cstring>
#include <cwchar>
#include <string>
#include <iterator>
#include "camera-shared.hpp"

using namespace capri;
namespace {
constexpr wchar_t inputs[] = L"CLSID\\{860BB310-5D01-11D0-BD3B-00A0C911CE86}\\Instance\\";
constexpr REGSAM views[] = {KEY_WOW64_64KEY, KEY_WOW64_32KEY};

class Handle {
    HANDLE value;
public:
    explicit Handle(HANDLE handle) : value(handle) {}
    ~Handle() { if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value); }
    operator HANDLE() const { return value; }
};

LSTATUS writeString(HKEY parent, const std::wstring& key, const wchar_t* field, const std::wstring& value) {
    HKEY item;
    auto status = RegCreateKeyExW(parent, key.c_str(), 0, nullptr, REG_OPTION_VOLATILE,
        KEY_SET_VALUE, nullptr, &item, nullptr);
    if (status == ERROR_SUCCESS) {
        status = RegSetValueExW(item, field, 0, REG_SZ, reinterpret_cast<const BYTE*>(value.c_str()),
            DWORD((value.size() + 1) * sizeof(wchar_t)));
        RegCloseKey(item);
    }
    return status;
}

class Registration {
    wchar_t guid[39]{};
    std::wstring clsid;
    std::wstring device;
public:
    Registration() {
        StringFromGUID2(cameraClass, guid, std::size(guid));
        clsid = L"CLSID\\" + std::wstring(guid);
        device = inputs + std::wstring(guid);
    }
    ~Registration() { clear(); }
    void clear() {
        for (const auto view : views) {
            HKEY classes;
            if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Classes", 0, KEY_READ | KEY_WRITE | view, &classes) == ERROR_SUCCESS) {
                RegDeleteTreeW(classes, device.c_str());
                RegDeleteTreeW(classes, clsid.c_str());
                RegCloseKey(classes);
            }
        }
    }
    bool create(const std::wstring& directory) {
        for (const auto view : views) {
            const auto dll = directory + (view == KEY_WOW64_64KEY ? L"capri-camera-x64.dll" : L"capri-camera-x86.dll");
            const auto attributes = GetFileAttributesW(dll.c_str());
            if (attributes == INVALID_FILE_ATTRIBUTES || attributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) return false;
            HKEY classes;
            if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Classes", 0, KEY_READ | KEY_WRITE | view, &classes) != ERROR_SUCCESS) return false;
            const auto server = clsid + L"\\InprocServer32";
            const bool ok = writeString(classes, clsid, nullptr, cameraName) == ERROR_SUCCESS &&
                writeString(classes, server, nullptr, dll) == ERROR_SUCCESS &&
                writeString(classes, server, L"ThreadingModel", L"Both") == ERROR_SUCCESS &&
                writeString(classes, device, L"CLSID", guid) == ERROR_SUCCESS &&
                writeString(classes, device, L"FriendlyName", cameraName) == ERROR_SUCCESS;
            RegCloseKey(classes);
            if (!ok) return false;
        }
        return true;
    }
};

class Producer {
    Handle mapping{CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, 0, sizeof(Frames), framesName)};
    Frames* frames = mapping ? static_cast<Frames*>(MapViewOfFile(mapping, FILE_MAP_WRITE, 0, 0, sizeof(Frames))) : nullptr;
public:
    explicit operator bool() const { return frames != nullptr; }
    ~Producer() {
        if (frames) { publish(nullptr); UnmapViewOfFile(frames); }
    }
    void publish(const uint8_t* pixels) {
        // Recover if an older producer exited in the middle of a write.
        if (!(frames->sequence & 1)) InterlockedIncrement(&frames->sequence);
        frames->active = pixels != nullptr;
        frames->updated = GetTickCount64();
        if (pixels) std::memcpy(frames->pixels, pixels, frameSize);
        else std::memset(frames->pixels, 0, frameSize);
        InterlockedIncrement(&frames->sequence);
    }
};

int report(const char* status, int code) {
    std::puts(status);
    std::fflush(stdout);
    return code;
}
}

int wmain(int argc, wchar_t** argv) {
    const bool cleanup = argc == 2 && std::wcscmp(argv[1], L"--cleanup") == 0;
    if (!cleanup && argc != 1) return 1;
    Handle owner(CreateMutexW(nullptr, TRUE, producerName));
    if (!owner) return report("UNAVAILABLE", 2);
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        const auto wait = WaitForSingleObject(owner, 0);
        if (wait != WAIT_OBJECT_0 && wait != WAIT_ABANDONED) return report("IN_USE", 3);
    }
    Registration registration;
    registration.clear();
    if (cleanup) return 0;
    wchar_t executable[32768]{};
    const DWORD size = GetModuleFileNameW(nullptr, executable, std::size(executable));
    if (!size || size >= std::size(executable)) return report("UNAVAILABLE", 2);
    std::wstring directory(executable, size);
    directory.resize(directory.find_last_of(L'\\') + 1);
    Producer producer;
    if (!producer) return report("UNAVAILABLE", 2);
    producer.publish(nullptr);
    if (!registration.create(directory)) return report("REGISTRATION_FAILED", 4);
    report("READY", 0);
    uint8_t pixels[frameSize];
    DWORD filled = 0;
    while (true) {
        DWORD read = 0;
        if (!ReadFile(GetStdHandle(STD_INPUT_HANDLE), pixels + filled, frameSize - filled, &read, nullptr) || !read) break;
        filled += read;
        if (filled == frameSize) { producer.publish(pixels); filled = 0; }
    }
    return 0;
}
