# Scoped file assistance

Capri's installation folder is shared with read/write access by default, including source code, configuration, its workspace and data. It appears in Settings → File access. You can make it read-only or revoke it; that choice survives restart. Existing installations gain this scope once during migration, without replacing existing folder grants. Re-select the exact installation folder in the picker to restore a revoked grant.

Additional personal folders use the Windows picker and start read-only. Enable “Allow file changes” separately for those folders; revoke a folder or all grants at any time. Permissions persist privately, separately from chat.

The desktop process owns file execution and the durable journal; the model plugin calls its authenticated local broker. It cannot acknowledge success before the owner process completes a confirmed action.

Ask naturally in chat. Qwen selects `filesystem_control` and its structured arguments; there is no command phrase matcher. The tool discovers current folder IDs and validates every relative path against the current policy. It is available to owner desktop turns, not Telegram or delegated agents. Capri’s private memory workspace remains a separate existing OpenClaw capability.

Currently supported:

- List a folder, search filenames with bounded traversal and read UTF-8 text up to 256 KiB.
- Create a new text file or an empty subfolder. Use a separate replacement action to update an existing UTF-8 file; creation never overwrites a name.
- Replace an existing text file using a recent read hash, native replacement and a private verified recovery copy. Installation files need no extra dialog; files in additional folders require confirmation.
- Move a regular file to the Windows Recycle Bin with a verified private recovery copy. Installation files need no extra dialog; files in additional folders require confirmation.
- Copy a regular file up to 20 MiB to an approved writable folder.
- Move or rename a regular file on the same drive, with exclusive destination creation and content verification.
- Undo supported completed operations using the actual operation ID. Undo refuses changed files, occupied original names and nonempty directories.

Directory copies/moves, cross-drive moves, permanent deletion and binary editing are unsupported. Application UI control has separate grants in Application access. The tool rejects drive roots, UNC/network paths, traversal, Windows device names, alternate streams, junctions, symlinks and preexisting hard-linked files. The exact installation scope is an exception to the application-data exclusion, including installations under AppData; it does not grant access to sibling applications or the rest of AppData. Protected system subtrees remain excluded from additional scopes. Unsupported and locked paths return an error, without an automatic more powerful fallback.

New files use exclusive creation. Move uses an exclusive same-drive hard link, verifies content and then removes the source; a cancelled or revoked action between those steps can leave both copies. That partial state is recorded as uncertain and never repeated automatically. These checks are not a security boundary against another malicious process already running as the same Windows user or racing filesystem objects.

The SQLite journal in `data/filesystem/operations.sqlite` retains operation identities across restarts, preventing a retry of the same completed tool call from repeating a mutation. Different arguments cannot reuse an ID. A crash or interrupted action is retained as uncertain and requires inspecting the files before any fresh attempt. Stop/Escape cancels the reply/action chain; a filesystem call already dispatched may finish, but later steps must still pass cancellation and live invocation checks. Never assume cancellation rolled back completed actions.

Undo of a created/copied file verifies its hash and saves a recovery copy before removing it from the approved folder. Recovery is private under `data/filesystem/recovery`; it is not Windows Recycle Bin integration. The journal is bounded to 10,000 mutations and recovery to 1 GiB; filling either pauses the relevant operation, preserving existing identities/files. Recycle Bin recovery is available in File access; replacement undo uses the actual operation ID returned by the file journal/status tool. Do not delete the journal while retrying old calls.

All file contents are returned as untrusted data, not instructions or authorization. The installation scope intentionally permits self-modification, including permission/configuration files. Edited application code can change behavior when it is next loaded; this scope is not a security boundary against self-modification. The file tool itself performs the listed filesystem operations and does not evaluate code or launch a shell. User intent remains interpreted by the model.

Verification uses generated fixtures only: `node --test tests/filesystem.test.mjs`, `npm run verify:files`, and `node tools/verify/verify-filesystem-model.mjs --test-root <existing-personal-scratch-folder>`. The last check starts an isolated Gateway and private scope/journal, uses real Qwen and preserves the normal conversation. It retains its generated fixture and report under ignored runtime/log locations.
