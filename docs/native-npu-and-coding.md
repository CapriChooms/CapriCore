# Native NPU, coding mode and desktop task progress

These features are available in Capri 1.1.0.

## Run a language model on an NPU

In **Settings → Language model → Model devices**, select the detected AMD or Intel NPU and click **Set up NPU and restart**. Capri prepares Qwen 2.5 1.5B for that device, verifies the download, and runs a short generation. The selection takes effect after the test passes. Voice uses its own device setting.

AMD requires Windows 11 24H2 or later, an NPU driver, and AMD Ryzen AI Software 1.9 or later in its default installation folder. Intel requires Windows 11 22H2 or later and an NPU driver. Capri installs the private Intel OpenVINO runtime as needed. The device selector shows installation guidance when a prerequisite is missing.

Use **Advanced NPU setup** for a different model, a custom vendor runtime, or a compatible Qualcomm QNN setup. The model folder must contain only local model data. Capri exchanges requests and replies with the NPU worker over private process pipes.

Hardware and OS support depends on each vendor’s runtime and driver. An Intel SDK and its hardware enumeration were checked on a PC without an NPU; actual NPU generation and AMD/Qualcomm hardware remain to be qualified. Native NPU is experimental.

## Work on a project without screen control

Open **Settings → Coding mode**, choose one project folder, and save access. Use **Find editors** or choose an installed executable. Use the Coding mode button in the main composer, or enable it in Settings. Capri can list, search, read, and edit project text files, and open a specific file/line in the selected editor. Its scope stays within the approved project and excludes common credential files, links and the Capri installation. For remote models, relevant source text is sent to the chosen provider.

The editor adapters use native commands for VS Code, Cursor, Windsurf, VSCodium, JetBrains IDEs, Visual Studio, Sublime Text, Notepad++, Neovim GUI and Emacs client. For VS Code-compatible editors, you can also enable and install the optional bridge to use live document versions and diagnostics. Open the exact approved folder as a trusted workspace. The bridge rejects unsaved edits and stale document versions. For CLI-only editors, save editor buffers before asking Capri to change files on disk.

In **Approved build and test tasks**, enter a name, choose the exact executable and enter its argument array (for example `node.exe` with `["--test"]`). A task runs with your Windows account; only approve commands from a project you trust. The model selects only the saved task ID, not a command line or shell. **Revoke project access** ends the grant.

## Follow a desktop task

During full computer control, verified task checkpoints appear in a centered chain at the top of the frame. Verified steps turn green and disappear; pending steps slide into position after a revision. These labels are temporary, do not grant any permission, and are excluded from diagnostics. Escape still stops control. Capri can stop and ask for help if it cannot verify the requested result.

## Earlier versions of Windows 10

The 1.1.0 installer allows x64 Windows 10 1809 / LTSC 2019 (build 17763) through 21H2 as an experimental configuration. 22H2 and Windows 11 remain recommended. The local inference runtime, NPU software, GPU drivers and optional speech packs have their own requirements. Some features may be unavailable. Compatibility with individual older Windows builds still needs clean-install verification.
