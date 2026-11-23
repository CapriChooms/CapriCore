// SPDX-License-Identifier: GPL-3.0-only
#include <dshow.h>
#include <ks.h>
#include <ksproxy.h>
#include <algorithm>
#include <atomic>
#include <cstring>
#include <iterator>
#include <memory>
#include <mutex>
#include <new>
#include <thread>
#include "camera-shared.hpp"

using namespace capri;
namespace {
std::atomic_ulong objects{};
constexpr GUID i420{MAKEFOURCC('I','4','2','0'), 0, 0x0010, {0x80,0,0,0xaa,0,0x38,0x9b,0x71}};
constexpr GUID nv12{MAKEFOURCC('N','V','1','2'), 0, 0x0010, {0x80,0,0,0xaa,0,0x38,0x9b,0x71}};
constexpr REFERENCE_TIME slowestInterval = 2000000;

template<class T> class ComPtr {
    T* ptr{};
public:
    ComPtr() = default;
    ComPtr(const ComPtr&) = delete;
    ComPtr& operator=(const ComPtr&) = delete;
    ~ComPtr() { reset(); }
    T* get() const { return ptr; }
    T* operator->() const { return ptr; }
    explicit operator bool() const { return ptr != nullptr; }
    T** put() { reset(); return &ptr; }
    void reset(T* value = nullptr) {
        if (value) value->AddRef();
        if (ptr) ptr->Release();
        ptr = value;
    }
};

struct VideoFormat { GUID subtype; DWORD compression; WORD bits; LONG bytes; };
const VideoFormat formats[] = {
    {i420, i420.Data1, 12, frameSize},
    {nv12, nv12.Data1, 12, frameSize},
    {MEDIASUBTYPE_YUY2, MAKEFOURCC('Y','U','Y','2'), 16, lumaSize * 2},
    {MEDIASUBTYPE_RGB24, BI_RGB, 24, lumaSize * 3},
};

AM_MEDIA_TYPE mediaType(unsigned index, VIDEOINFOHEADER& info, REFERENCE_TIME interval = frameInterval) {
    const auto& format = formats[index];
    info = {};
    info.AvgTimePerFrame = interval;
    info.dwBitRate = DWORD(format.bytes * 8LL * 10000000 / interval);
    info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth = width;
    info.bmiHeader.biHeight = height;
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = format.bits;
    info.bmiHeader.biCompression = format.compression;
    info.bmiHeader.biSizeImage = format.bytes;
    return {MEDIATYPE_Video, format.subtype, TRUE, FALSE, ULONG(format.bytes), FORMAT_VideoInfo,
        nullptr, sizeof(info), reinterpret_cast<BYTE*>(&info)};
}

HRESULT copyType(unsigned index, AM_MEDIA_TYPE* value, REFERENCE_TIME interval = frameInterval) {
    if (!value) return E_POINTER;
    auto info = static_cast<VIDEOINFOHEADER*>(CoTaskMemAlloc(sizeof(VIDEOINFOHEADER)));
    if (!info) return E_OUTOFMEMORY;
    *value = mediaType(index, *info, interval);
    return S_OK;
}

HRESULT allocateType(unsigned index, AM_MEDIA_TYPE** value, REFERENCE_TIME interval = frameInterval) {
    if (!value) return E_POINTER;
    *value = static_cast<AM_MEDIA_TYPE*>(CoTaskMemAlloc(sizeof(AM_MEDIA_TYPE)));
    if (!*value) return E_OUTOFMEMORY;
    const auto hr = copyType(index, *value, interval);
    if (FAILED(hr)) { CoTaskMemFree(*value); *value = nullptr; }
    return hr;
}

int findFormat(const AM_MEDIA_TYPE* value) {
    if (!value || value->majortype != MEDIATYPE_Video || value->formattype != FORMAT_VideoInfo ||
        !value->pbFormat || value->cbFormat < sizeof(VIDEOINFOHEADER)) return -1;
    const auto& info = *reinterpret_cast<const VIDEOINFOHEADER*>(value->pbFormat);
    if (info.bmiHeader.biWidth != width || info.bmiHeader.biHeight != height ||
        (info.AvgTimePerFrame && (info.AvgTimePerFrame < frameInterval - 1 ||
            info.AvgTimePerFrame > slowestInterval))) return -1;
    for (unsigned index = 0; index < std::size(formats); ++index)
        if (value->subtype == formats[index].subtype &&
            info.bmiHeader.biCompression == formats[index].compression &&
            info.bmiHeader.biBitCount == formats[index].bits) return index;
    return -1;
}

REFERENCE_TIME requestedInterval(const AM_MEDIA_TYPE* value) {
    if (!value) return frameInterval;
    const auto requested = reinterpret_cast<const VIDEOINFOHEADER*>(value->pbFormat)->AvgTimePerFrame;
    return requested ? std::max(requested, REFERENCE_TIME(frameInterval)) : frameInterval;
}

class FramesReader {
    HANDLE mapping{};
    const Frames* frames{};
    ULONGLONG nextOpen{};
public:
    ~FramesReader() {
        if (frames) UnmapViewOfFile(frames);
        if (mapping) CloseHandle(mapping);
    }
    bool read(uint8_t* data) {
        const auto now = GetTickCount64();
        if (!frames && now >= nextOpen) {
            nextOpen = now + 500;
            mapping = OpenFileMappingW(FILE_MAP_READ, FALSE, framesName);
            if (mapping) {
                frames = static_cast<const Frames*>(MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, sizeof(Frames)));
                if (!frames) { CloseHandle(mapping); mapping = nullptr; }
            }
        }
        if (!frames) return false;
        for (int retry = 0; retry < 3; ++retry) {
            const LONG begin = frames->sequence;
            MemoryBarrier();
            if (begin & 1) continue;
            if (!frames->active || now > frames->updated + 2500) return false;
            std::memcpy(data, frames->pixels, frameSize);
            MemoryBarrier();
            if (begin == frames->sequence) return true;
        }
        return false;
    }
};

void convert(const uint8_t* frame, uint8_t* output, unsigned format) {
    const auto* u = frame + lumaSize;
    const auto* v = u + lumaSize / 4;
    if (format < 2) {
        std::memcpy(output, frame, format == 0 ? frameSize : lumaSize);
        if (format == 1) {
            output += lumaSize;
            for (int i = 0; i < lumaSize / 4; ++i) { *output++ = u[i]; *output++ = v[i]; }
        }
        return;
    }
    for (int row = 0; row < height; ++row) {
        const int chromaRow = (row / 2) * (width / 2);
        const auto* y = frame + row * width;
        auto* out = output + (format == 2 ? row * width * 2 : (height - row - 1) * width * 3);
        for (int col = 0; col < width; col += 2) {
            const int index = chromaRow + col / 2;
            if (format == 2) {
                *out++ = y[col]; *out++ = u[index]; *out++ = y[col + 1]; *out++ = v[index];
            } else {
                const int d = u[index] - 128, e = v[index] - 128;
                for (int offset = 0; offset < 2; ++offset) {
                    const int c = 298 * std::max(0, y[col + offset] - 16);
                    *out++ = std::clamp((c + 516 * d + 128) >> 8, 0, 255);
                    *out++ = std::clamp((c - 100 * d - 208 * e + 128) >> 8, 0, 255);
                    *out++ = std::clamp((c + 409 * e + 128) >> 8, 0, 255);
                }
            }
        }
    }
}

class Camera;
class Output final : public IPin, public IAMStreamConfig, public IKsPropertySet {
    Camera& owner;
    ComPtr<IPin> peer;
    ComPtr<IMemInputPin> input;
    ComPtr<IMemAllocator> allocator;
    unsigned format{};
    REFERENCE_TIME interval{frameInterval};
    VIDEOINFOHEADER negotiated{};
    HANDLE stopEvent{CreateEventW(nullptr, TRUE, FALSE, nullptr)};
    std::thread worker;
    HRESULT connect(IPin* receiver, unsigned index, REFERENCE_TIME requested);
    void stream();
public:
    explicit Output(Camera& filter) : owner(filter) {}
    ~Output() { stop(); if (stopEvent) CloseHandle(stopEvent); }
    HRESULT run();
    void stop();
    STDMETHODIMP QueryInterface(REFIID iid, void** value) override;
    STDMETHODIMP_(ULONG) AddRef() override;
    STDMETHODIMP_(ULONG) Release() override;
    STDMETHODIMP Connect(IPin* receiver, const AM_MEDIA_TYPE* value) override;
    STDMETHODIMP ReceiveConnection(IPin*, const AM_MEDIA_TYPE*) override { return VFW_E_INVALID_DIRECTION; }
    STDMETHODIMP Disconnect() override;
    STDMETHODIMP ConnectedTo(IPin** value) override;
    STDMETHODIMP ConnectionMediaType(AM_MEDIA_TYPE* value) override;
    STDMETHODIMP QueryPinInfo(PIN_INFO* info) override;
    STDMETHODIMP QueryDirection(PIN_DIRECTION* direction) override {
        if (!direction) return E_POINTER; *direction = PINDIR_OUTPUT; return S_OK;
    }
    STDMETHODIMP QueryId(LPWSTR* id) override;
    STDMETHODIMP QueryAccept(const AM_MEDIA_TYPE* value) override { return findFormat(value) >= 0 ? S_OK : S_FALSE; }
    STDMETHODIMP EnumMediaTypes(IEnumMediaTypes** value) override;
    STDMETHODIMP QueryInternalConnections(IPin**, ULONG*) override { return E_NOTIMPL; }
    STDMETHODIMP EndOfStream() override { return E_UNEXPECTED; }
    STDMETHODIMP BeginFlush() override { return E_UNEXPECTED; }
    STDMETHODIMP EndFlush() override { return E_UNEXPECTED; }
    STDMETHODIMP NewSegment(REFERENCE_TIME, REFERENCE_TIME, double) override { return E_UNEXPECTED; }
    STDMETHODIMP SetFormat(AM_MEDIA_TYPE* value) override;
    STDMETHODIMP GetFormat(AM_MEDIA_TYPE** value) override { return allocateType(format, value, interval); }
    STDMETHODIMP GetNumberOfCapabilities(int* count, int* size) override {
        if (!count || !size) return E_POINTER;
        *count = std::size(formats); *size = sizeof(VIDEO_STREAM_CONFIG_CAPS); return S_OK;
    }
    STDMETHODIMP GetStreamCaps(int index, AM_MEDIA_TYPE** value, BYTE* buffer) override;
    STDMETHODIMP Set(REFGUID, DWORD, LPVOID, DWORD, LPVOID, DWORD) override { return E_NOTIMPL; }
    STDMETHODIMP Get(REFGUID set, DWORD id, LPVOID, DWORD, LPVOID data, DWORD size, DWORD* used) override;
    STDMETHODIMP QuerySupported(REFGUID set, DWORD id, DWORD* support) override;
};

class Camera final : public IBaseFilter, public IAMFilterMiscFlags {
    std::atomic_ulong references{1};
    std::atomic<FILTER_STATE> state{State_Stopped};
    std::mutex transitions;
    // Filter graphs own their filters. Holding a graph reference here would make a cycle.
    IFilterGraph* graph{};
    ComPtr<IReferenceClock> clock;
    wchar_t name[128]{};
public:
    Output pin{*this};
    Camera() { ++objects; std::wmemcpy(name, cameraName, std::size(cameraName)); }
    ~Camera() { pin.stop(); --objects; }
    bool stopped() const { return state == State_Stopped; }
    STDMETHODIMP QueryInterface(REFIID iid, void** value) override {
        if (!value) return E_POINTER; *value = nullptr;
        if (iid == IID_IUnknown || iid == IID_IPersist || iid == IID_IMediaFilter || iid == IID_IBaseFilter)
            *value = static_cast<IBaseFilter*>(this);
        else if (iid == IID_IAMFilterMiscFlags) *value = static_cast<IAMFilterMiscFlags*>(this);
        else return E_NOINTERFACE;
        AddRef(); return S_OK;
    }
    STDMETHODIMP_(ULONG) AddRef() override { return ++references; }
    STDMETHODIMP_(ULONG) Release() override {
        const auto count = --references; if (!count) delete this; return count;
    }
    STDMETHODIMP GetClassID(CLSID* id) override {
        if (!id) return E_POINTER; *id = cameraClass; return S_OK;
    }
    STDMETHODIMP Stop() override {
        const std::lock_guard lock(transitions);
        state = State_Stopped; pin.stop(); return S_OK;
    }
    STDMETHODIMP Pause() override {
        const std::lock_guard lock(transitions);
        state = State_Paused; pin.stop(); return S_OK;
    }
    STDMETHODIMP Run(REFERENCE_TIME) override {
        const std::lock_guard lock(transitions);
        if (state == State_Running) return S_OK;
        const auto hr = pin.run(); if (SUCCEEDED(hr)) state = State_Running; return hr;
    }
    STDMETHODIMP GetState(DWORD, FILTER_STATE* value) override {
        if (!value) return E_POINTER;
        *value = state; return *value == State_Paused ? VFW_S_CANT_CUE : S_OK;
    }
    STDMETHODIMP SetSyncSource(IReferenceClock* value) override { clock.reset(value); return S_OK; }
    STDMETHODIMP GetSyncSource(IReferenceClock** value) override {
        if (!value) return E_POINTER; *value = clock.get(); if (*value) (*value)->AddRef(); return S_OK;
    }
    STDMETHODIMP EnumPins(IEnumPins** value) override;
    STDMETHODIMP FindPin(LPCWSTR id, IPin** value) override {
        if (!id || !value) return E_POINTER; *value = nullptr;
        if (std::wcscmp(id, L"Capture")) return VFW_E_NOT_FOUND;
        *value = &pin; pin.AddRef(); return S_OK;
    }
    STDMETHODIMP QueryFilterInfo(FILTER_INFO* info) override {
        if (!info) return E_POINTER;
        std::wmemcpy(info->achName, name, std::size(name));
        info->pGraph = graph; if (graph) graph->AddRef(); return S_OK;
    }
    STDMETHODIMP JoinFilterGraph(IFilterGraph* value, LPCWSTR label) override {
        graph = value;
        const auto* next = label ? label : cameraName;
        const auto count = std::min(std::wcslen(next), std::size(name) - 1);
        std::wmemcpy(name, next, count); name[count] = 0;
        return S_OK;
    }
    STDMETHODIMP QueryVendorInfo(LPWSTR* value) override {
        if (value) *value = nullptr; return E_NOTIMPL;
    }
    STDMETHODIMP_(ULONG) GetMiscFlags() override { return AM_FILTER_MISC_FLAGS_IS_SOURCE; }
};

template<class Interface, class Item>
class Enumerator final : public Interface {
    std::atomic_ulong references{1};
    ComPtr<IPin> pin;
    unsigned position{};
    bool pins() const { return std::is_same_v<Interface, IEnumPins>; }
    unsigned size() const { return pins() ? 1 : std::size(formats); }
public:
    explicit Enumerator(IPin* value, unsigned offset = 0) : position(offset) { pin.reset(value); ++objects; }
    ~Enumerator() { --objects; }
    STDMETHODIMP QueryInterface(REFIID iid, void** value) override {
        if (!value) return E_POINTER; *value = nullptr;
        if (iid != IID_IUnknown && iid != (pins() ? IID_IEnumPins : IID_IEnumMediaTypes)) return E_NOINTERFACE;
        *value = static_cast<Interface*>(this); AddRef(); return S_OK;
    }
    STDMETHODIMP_(ULONG) AddRef() override { return ++references; }
    STDMETHODIMP_(ULONG) Release() override {
        const auto count = --references; if (!count) delete this; return count;
    }
    STDMETHODIMP Next(ULONG count, Item** values, ULONG* fetched) override {
        if (!values || (!fetched && count != 1)) return E_POINTER;
        ULONG done = 0;
        for (; done < count && position < size(); ++done, ++position) {
            if constexpr (std::is_same_v<Item, IPin>) {
                values[done] = pin.get(); pin->AddRef();
            } else {
                if (FAILED(allocateType(position, &values[done]))) break;
            }
        }
        if (fetched) *fetched = done;
        return done == count ? S_OK : S_FALSE;
    }
    STDMETHODIMP Skip(ULONG count) override {
        const auto remaining = size() - position;
        position += std::min(ULONG(remaining), count); return count <= remaining ? S_OK : S_FALSE;
    }
    STDMETHODIMP Reset() override { position = 0; return S_OK; }
    STDMETHODIMP Clone(Interface** value) override {
        if (!value) return E_POINTER;
        *value = new (std::nothrow) Enumerator(pin.get(), position); return *value ? S_OK : E_OUTOFMEMORY;
    }
};

HRESULT Camera::EnumPins(IEnumPins** value) {
    if (!value) return E_POINTER;
    *value = new (std::nothrow) Enumerator<IEnumPins, IPin>(&pin);
    return *value ? S_OK : E_OUTOFMEMORY;
}
ULONG Output::AddRef() { return owner.AddRef(); }
ULONG Output::Release() { return owner.Release(); }
HRESULT Output::QueryInterface(REFIID iid, void** value) {
    if (!value) return E_POINTER; *value = nullptr;
    if (iid == IID_IUnknown || iid == IID_IPin) *value = static_cast<IPin*>(this);
    else if (iid == IID_IAMStreamConfig) *value = static_cast<IAMStreamConfig*>(this);
    else if (iid == IID_IKsPropertySet) *value = static_cast<IKsPropertySet*>(this);
    else return E_NOINTERFACE;
    AddRef(); return S_OK;
}
HRESULT Output::Connect(IPin* receiver, const AM_MEDIA_TYPE* value) {
    if (!receiver) return E_POINTER;
    if (!owner.stopped()) return VFW_E_NOT_STOPPED;
    if (peer) return VFW_E_ALREADY_CONNECTED;
    if (value && value->formattype != GUID_NULL) {
        const int index = findFormat(value);
        return index < 0 ? VFW_E_TYPE_NOT_ACCEPTED : connect(receiver, index, requestedInterval(value));
    }
    const unsigned preferred = format;
    for (unsigned offset = 0; offset < std::size(formats); ++offset) {
        const unsigned index = (preferred + offset) % std::size(formats);
        if (value && value->subtype != GUID_NULL && value->subtype != formats[index].subtype) continue;
        if (SUCCEEDED(connect(receiver, index, interval))) return S_OK;
    }
    return VFW_E_NO_ACCEPTABLE_TYPES;
}
HRESULT Output::connect(IPin* receiver, unsigned index, REFERENCE_TIME requested) {
    const auto type = mediaType(index, negotiated, requested);
    auto hr = receiver->QueryInterface(IID_IMemInputPin, reinterpret_cast<void**>(input.put()));
    if (FAILED(hr)) return hr;
    hr = receiver->ReceiveConnection(this, &type);
    if (FAILED(hr)) { input.reset(); return hr; }
    hr = input->GetAllocator(allocator.put());
    if (FAILED(hr) || !allocator) hr = CoCreateInstance(CLSID_MemoryAllocator, nullptr,
        CLSCTX_INPROC_SERVER, IID_IMemAllocator, reinterpret_cast<void**>(allocator.put()));
    if (SUCCEEDED(hr)) {
        ALLOCATOR_PROPERTIES wanted{}, actual{};
        input->GetAllocatorRequirements(&wanted);
        wanted.cBuffers = std::max<LONG>(wanted.cBuffers, 3);
        wanted.cbBuffer = std::max(wanted.cbBuffer, formats[index].bytes);
        wanted.cbAlign = std::max<LONG>(wanted.cbAlign, 1);
        hr = allocator->SetProperties(&wanted, &actual);
        if (SUCCEEDED(hr) && actual.cbBuffer < formats[index].bytes) hr = VFW_E_BUFFER_OVERFLOW;
        if (SUCCEEDED(hr)) hr = input->NotifyAllocator(allocator.get(), FALSE);
    }
    if (FAILED(hr)) { receiver->Disconnect(); input.reset(); allocator.reset(); return hr; }
    peer.reset(receiver);
    format = index;
    interval = requested;
    return S_OK;
}
HRESULT Output::Disconnect() {
    if (!owner.stopped()) return VFW_E_NOT_STOPPED;
    if (!peer) return S_FALSE;
    allocator.reset(); input.reset(); peer.reset(); return S_OK;
}
HRESULT Output::ConnectedTo(IPin** value) {
    if (!value) return E_POINTER; *value = peer.get();
    if (!*value) return VFW_E_NOT_CONNECTED; (*value)->AddRef(); return S_OK;
}
HRESULT Output::ConnectionMediaType(AM_MEDIA_TYPE* value) {
    if (!value) return E_POINTER; *value = {}; return peer ? copyType(format, value, interval) : VFW_E_NOT_CONNECTED;
}
HRESULT Output::QueryPinInfo(PIN_INFO* info) {
    if (!info) return E_POINTER;
    info->pFilter = &owner; owner.AddRef(); info->dir = PINDIR_OUTPUT;
    std::wmemcpy(info->achName, L"Capture", 8); return S_OK;
}
HRESULT Output::QueryId(LPWSTR* id) {
    if (!id) return E_POINTER;
    *id = static_cast<LPWSTR>(CoTaskMemAlloc(8 * sizeof(wchar_t)));
    if (!*id) return E_OUTOFMEMORY; std::wmemcpy(*id, L"Capture", 8); return S_OK;
}
HRESULT Output::EnumMediaTypes(IEnumMediaTypes** value) {
    if (!value) return E_POINTER;
    *value = new (std::nothrow) Enumerator<IEnumMediaTypes, AM_MEDIA_TYPE>(this);
    return *value ? S_OK : E_OUTOFMEMORY;
}
HRESULT Output::SetFormat(AM_MEDIA_TYPE* value) {
    if (!owner.stopped()) return VFW_E_NOT_STOPPED;
    const int index = value ? findFormat(value) : 0;
    if (index < 0) return VFW_E_TYPE_NOT_ACCEPTED;
    const auto nextInterval = requestedInterval(value);
    if (peer && (unsigned(index) != format || nextInterval != interval)) return VFW_E_ALREADY_CONNECTED;
    format = index;
    interval = nextInterval;
    return S_OK;
}
HRESULT Output::GetStreamCaps(int index, AM_MEDIA_TYPE** value, BYTE* buffer) {
    if (!value || !buffer) return E_POINTER;
    if (index < 0 || unsigned(index) >= std::size(formats)) return S_FALSE;
    VIDEO_STREAM_CONFIG_CAPS caps{};
    caps.guid = FORMAT_VideoInfo;
    caps.InputSize = caps.MinCroppingSize = caps.MaxCroppingSize = caps.MinOutputSize = caps.MaxOutputSize = {width, height};
    caps.CropGranularityX = caps.CropGranularityY = caps.OutputGranularityX = caps.OutputGranularityY = 1;
    caps.MinFrameInterval = frameInterval;
    caps.MaxFrameInterval = slowestInterval;
    caps.MinBitsPerSecond = formats[index].bytes * 5 * 8;
    caps.MaxBitsPerSecond = formats[index].bytes * 30 * 8;
    std::memcpy(buffer, &caps, sizeof(caps)); return allocateType(index, value);
}
HRESULT Output::QuerySupported(REFGUID set, DWORD id, DWORD* support) {
    if (set != AMPROPSETID_Pin) return E_PROP_SET_UNSUPPORTED;
    if (id != AMPROPERTY_PIN_CATEGORY) return E_PROP_ID_UNSUPPORTED;
    if (support) *support = KSPROPERTY_SUPPORT_GET; return S_OK;
}
HRESULT Output::Get(REFGUID set, DWORD id, LPVOID, DWORD, LPVOID data, DWORD size, DWORD* used) {
    const auto hr = QuerySupported(set, id, nullptr);
    if (FAILED(hr)) return hr;
    if (used) *used = sizeof(GUID);
    if (!data) return used ? S_OK : E_POINTER;
    if (size < sizeof(GUID)) return HRESULT_FROM_WIN32(ERROR_MORE_DATA);
    std::memcpy(data, &PIN_CATEGORY_CAPTURE, sizeof(GUID)); return S_OK;
}
HRESULT Output::run() {
    if (!peer || worker.joinable()) return S_OK;
    if (!stopEvent) return E_OUTOFMEMORY;
    auto hr = allocator->Commit();
    if (FAILED(hr)) return hr;
    ResetEvent(stopEvent);
    try { worker = std::thread([this] { stream(); }); }
    catch (...) { allocator->Decommit(); return E_OUTOFMEMORY; }
    return S_OK;
}
void Output::stop() {
    if (!worker.joinable()) return;
    SetEvent(stopEvent);
    peer->BeginFlush(); allocator->Decommit();
    worker.join(); peer->EndFlush();
}
void Output::stream() {
    const auto com = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    auto frame = std::unique_ptr<uint8_t[]>(new (std::nothrow) uint8_t[frameSize]);
    if (frame) {
        FramesReader reader;
        const auto started = GetTickCount64();
        REFERENCE_TIME previous = -interval;
        bool first = true;
        while (WaitForSingleObject(stopEvent, 0) == WAIT_TIMEOUT) {
            ComPtr<IMediaSample> sample;
            if (FAILED(allocator->GetBuffer(sample.put(), nullptr, nullptr, 0))) break;
            BYTE* data{};
            if (FAILED(sample->GetPointer(&data)) || sample->GetSize() < formats[format].bytes) break;
            if (!reader.read(frame.get())) {
                std::memset(frame.get(), 16, lumaSize);
                std::memset(frame.get() + lumaSize, 128, lumaSize / 2);
            }
            convert(frame.get(), data, format);
            REFERENCE_TIME time = std::max(previous + interval, REFERENCE_TIME(GetTickCount64() - started) * 10000);
            REFERENCE_TIME end = time + interval;
            previous = time;
            sample->SetTime(&time, &end);
            sample->SetActualDataLength(formats[format].bytes);
            sample->SetSyncPoint(TRUE);
            sample->SetDiscontinuity(first);
            first = false;
            if (input->Receive(sample.get()) != S_OK) break;
            const auto elapsed = GetTickCount64() - started;
            const auto next = ULONGLONG(end / 10000);
            if (next > elapsed && WaitForSingleObject(stopEvent, DWORD(next - elapsed)) != WAIT_TIMEOUT) break;
        }
    }
    if (SUCCEEDED(com)) CoUninitialize();
}

class Factory final : public IClassFactory {
    std::atomic_ulong references{1};
public:
    Factory() { ++objects; }
    ~Factory() { --objects; }
    STDMETHODIMP QueryInterface(REFIID iid, void** value) override {
        if (!value) return E_POINTER; *value = nullptr;
        if (iid != IID_IUnknown && iid != IID_IClassFactory) return E_NOINTERFACE;
        *value = static_cast<IClassFactory*>(this); AddRef(); return S_OK;
    }
    STDMETHODIMP_(ULONG) AddRef() override { return ++references; }
    STDMETHODIMP_(ULONG) Release() override {
        const auto count = --references; if (!count) delete this; return count;
    }
    STDMETHODIMP CreateInstance(IUnknown* outer, REFIID iid, void** value) override {
        if (!value) return E_POINTER; *value = nullptr;
        if (outer) return CLASS_E_NOAGGREGATION;
        auto* camera = new (std::nothrow) Camera();
        if (!camera) return E_OUTOFMEMORY;
        const auto hr = camera->QueryInterface(iid, value); camera->Release(); return hr;
    }
    STDMETHODIMP LockServer(BOOL lock) override { if (lock) ++objects; else --objects; return S_OK; }
};
}

STDAPI DllGetClassObject(REFCLSID clsid, REFIID iid, void** value) {
    if (!value) return E_POINTER;
    *value = nullptr;
    if (clsid != cameraClass) return CLASS_E_CLASSNOTAVAILABLE;
    auto* factory = new (std::nothrow) Factory();
    if (!factory) return E_OUTOFMEMORY;
    const auto hr = factory->QueryInterface(iid, value); factory->Release(); return hr;
}

STDAPI DllCanUnloadNow() { return objects ? S_FALSE : S_OK; }
