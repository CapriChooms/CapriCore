# Computer control (BETA)

Individual application/folder grants remain the default. To allow supported
actions across local fixed drives, open **Settings → Computer control → Full
computer access**. Read the scope and wait three seconds before confirming.
Turn it off there to restore individual permissions; revocation also stops an
active control session. Windows permissions still apply. Network shares, path
traversal and linked filesystem paths are not granted by this option.

The **Computer control** settings panel now contains a task field and **Start**.
Enter the whole task there to run the dedicated executor directly, without relying
on the conversation model to select a tool. Ordinary chat can delegate the same
task with `desktop_control run_task`. The active companion and settings display
observation, action and result-checking status. **Esc** or **Stop computer control**
cancels the task, including a model request in progress.

You can also say **"Enable full computer access"** in chat (or **"Включи режим
полного управления компьютером"**). Capri opens the same timed confirmation; it
does not enable access just because the model says so. **"Disable full computer
access"** revokes the grant again.

For a complete task, say **"Use full computer control to open Chrome, search for
Capri and click Images"**. This explicit mode takes priority over separate music,
calculator and browser skills. If permission is missing, Capri requests it first,
then sends the entire original task to the executor without another prompt.
Already granted access needs no repeat confirmation. Closing the confirmation,
stopping the turn or letting it expire prevents deferred execution. General
capability questions do not automatically enable access.
The deterministic chat checks are in `tests/computer-chat.test.mjs`; the isolated
production confirmation flow can be checked with
`node tools/verify/verify-computer-chat.mjs` without starting models or operating
on personal applications.

The host keeps the original goal throughout the task. It reads Windows accessible
controls first, acts on current targets, and observes again after every input.
Visual interpretation is requested only when needed. A separate completion review
checks the original goal against actual results; completion evidence must match
the observed window/field/label. Repeated unchanged actions, invalid targets and
uncertain native mutations stop rather than silently replaying inputs. Only the
task and final reply enter conversation history; intermediate field values and
images remain transient. Planning uses the selected local model or the owner's
explicitly configured provider through the existing credential boundary.

The executor is bounded to 100 decisions, 80 input actions and ten minutes per
owner request. Early completed milestones remain available after the detailed
history rolls over. This permits longer workflows without unbounded execution.
These controls improve reliability but do not establish parity with any other
assistant: weak models, inaccessible controls and changing application UIs can
still require user help. Native and real-model qualification tools are
`tools/verify/verify-computer-agent.mjs` and
`tools/verify/verify-browser-input.mjs --agent-test`.
`tools/verify/verify-browser-search.mjs` additionally exercises a submitted Google
search with the selected local planner in a disposable Chrome profile. It checks
both results and the explicit human-verification outcome; it never solves a CAPTCHA.

For an owner-requested task, Capri can discover applications registered in Windows
App Paths, open a local `.exe` without command arguments, inspect accessible
controls, type into an inspected non-password field, press keys or combinations,
hold keys for up to two seconds, move/click the pointer and scroll. Applications
without a registered path can be selected in the existing app catalog. This does
not mean every Store application, game launcher or elevated window is supported.

For Chrome or Edge address/search-bar drafts, `desktop_control` offers
`browser_input` with `query` (for example, `Google Chrome`) and `text`. It opens or
focuses the requested browser, verifies its actual editable address field using
Windows UI Automation, writes the draft and verifies the resulting value. It does
not press Enter. Background screen observation is not required. Individual launch
and text grants still apply outside Full computer access, including confirmation.
Multiple windows can be selected by a unique `windowTitle`; Capri discovers
internal IDs itself rather than asking the owner to provide them.

The task executor also has `browser_search`: it enters a Google search URL,
checks the actual focused omnibox in the same window, and submits it once. It
waits for results before accepting a completion claim. A human-verification page
stops the task with an explanation. `browser_input` remains draft-only. Unused
model arguments (such as an Enter key attached to a draft action) are never
recorded as executed actions.

When you explicitly request a page search field, Capri opens the actual Google
home page if necessary, clicks and fills its search field, then submits it once.
It distinguishes this from Chrome's toolbar and a new-tab search proxy. The
executor handles localized search labels and Chrome's shortened address display.
Opening image results alone does not satisfy a request for fullscreen: the actual
window state must confirm fullscreen before completion can be accepted.

Pointer moves use a short eased path. `drag` takes a source and destination from
the latest observation in the same application, checks the foreground throughout
the motion and releases the held button on completion or cancellation. It can
hold Ctrl, Shift or Alt during the drag. Clicks support left/right/middle buttons
and double-clicks; context menus belonging to the observed application remain
usable without accepting a covering window from another application. Text entry
supports replacement and appending. Trusted
Explorer taskbar targets can be clicked to switch applications; keyboard input
still requires a fresh observation of the newly active application. The capture
and control indicator cover full monitor bounds, including the taskbar.

**Settings → Computer control → Control effects** provides Capri and Blackwall
procedural styles, an intensity slider, a separate cursor/trail switch and pointer
movement duration (zero means instant). Preview runs for three seconds without
granting control or starting a task. Effects draw at the edges; the center remains
transparent. Turning decorative effects off keeps the active-control indicator.
Windows reduced-motion preferences reduce animation. The normal Windows cursor
is preserved outside the session. Indicator loss stops active input.

Dense accessibility trees are compacted before planning, with visual targets
reserved first so they cannot disappear behind long UI lists. Legacy Qt text
fields can use their verified ValuePattern when the provider cannot reliably
report focus; browser text uses real input events. Buttons are never admitted as
text fields merely because a provider exposes a writable value.

Window titles supplied by the planner are used only when present in the owner's
goal. An explicit selection-only response can be resolved using its sole real
window or the currently observed matching window. Ambiguous selections require
owner input and are not counted as completed steps. Uncertain mutations are never
retried through this mechanism. Diagnostic reports include bounded action names,
outcomes and failure categories, without typed text, window titles or screenshots.

Application-name lookup also works for launch and inspection. Full-access
discovery returns usable temporary app IDs without changing individual grants;
revoking Full computer access removes those temporary capabilities. A verified
launch binds follow-up inspection to the same owner turn and window for up to
45 seconds. It cannot select an app implicitly in a different turn. A launch
receipt alone never replaces an explanation of an unfinished typing task.

The browser helper first selects a unique verified address field directly. When
needed it uses Chrome's documented [address-bar shortcut](https://support.google.com/chrome/answer/157179)
only to focus browser chrome. It rejects editable page content and uses
[ValuePattern](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.valuepattern.setvalue)
to enter and verify the text. If the provider or target cannot be verified, it
stops instead of typing into an arbitrary foreground control.

A general multi-step session must begin explicitly, show its border on every connected
display, and register **Escape** as an emergency stop before input is admitted.
The main window also shows **Stop computer control**. A session is limited to ten
minutes and 80 input steps. It ends on Escape, revocation, hiding Capri, locking or
suspending Windows, shutdown, or completion/cancellation of the owner turn. Escape
also cancels the current reply so the model cannot restart control in the same
turn. A new owner request is required to start again.

Each input requires a recent observation. Windows handle, process ID and process
start time must still match the foreground window; stale targets cannot be reused.
Observe again after input to verify the result. Only inspected UI fields permit
text entry. Vision provides bounded click targets, not executable instructions;
screen/app content is untrusted data. Injected keys/buttons are released during
cancellation and after each completed action. Mutations use the existing operation
journal and are not automatically replayed after an uncertain completion.

In games, scan-code input can work where the game accepts normal Windows input.
Raw-input-only, anti-cheat-protected and elevated games may reject it. Capri does
not bypass those protections or elevate itself. Exclusive fullscreen can prevent
the border being visible; use windowed/borderless mode for control. Do not rely on
the companion for timing-critical actions. Per-application automation remains more
predictable for a simple launch or browser address than general screen clicking.

With an external AI provider enabled, the provider-sharing notice still applies
to inspected content and selected images. Full-computer access does not enable a
remote provider, microphone or background screen observation automatically.

## DaVinci Resolve assembly (BETA)

When Resolve is the foreground application and its installed local scripting
interface is available, computer observation also includes the active project's
media-pool clips and actual timeline segments. Capri can create and save a new
timeline from ordered source-frame ranges using Blackmagic's own `fuscript`
interpreter. No extra Python package is needed for this integration.

Ranges exposed to the model are inclusive: frames 0 through 47 contain 48 frames.
The host checks explicitly requested ranges before editing, then verifies source
IDs, source offsets, durations and adjacency against Resolve's actual timeline.
An existing timeline with the requested name is preserved and the operation
fails. A failed operation may leave a partial new timeline; it is never silently
deleted or retried. Stop cancels subsequent actions, and does not undo an edit
that Resolve has already committed.

This path does not enable external scripting, network access or change Resolve's
preferences. If the installed interface is unavailable, Capri retains the normal
UI path; advanced editing and inaccessible canvases can still need help. Basic
assembly qualification uses matching source/project frame rates; mixed-rate
projects are not yet qualified. Mouse-only instructions retain the UI path.

Open a disposable project containing a synthetic video of at least 120 frames,
set `CAPRI_VERIFY_RESOLVE_PROJECT` to its exact name and `CAPRI_VERIFY_MODEL` to
the local model, then run `node tools/verify/verify-resolve-assembly.mjs`.
It creates a uniquely named new montage and checks two adjacent 48-frame ranges.
The complete native input check is `node tools/verify/verify-input-workflow.mjs`;
it covers copying/pasting, double/right/middle clicks, an owned context menu,
Ctrl-drag and smooth pointer motion, restoring the clipboard afterward.
