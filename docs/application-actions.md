# Fixed Windows application actions

Settings → Application access grants access separately to Windows Notepad and Calculator. Both are off by default; Full computer access also authorizes these supported actions. A grant permits opening/focusing the selected app and reading bounded accessible control names, which may contain private information. Revoke individual grants in the same panel, or Full computer access in Settings → Computer control.

The language model interprets the request and selects `application_control`. Its typed interface offers status, launch, focus, controls and calculate. When Calculator is enabled, numerical questions use the calculation tool without requiring an explicit app command. A verified result becomes the short reply; generated arithmetic cannot replace it.

Scientific mode supports parentheses, powers, square/cube/nth roots, natural and arbitrary-base logarithms, trigonometry (degrees/radians/gradians), hyperbolic functions, factorials, combinations and percentages. Programmer mode supports 8/16/32/64-bit integers, bit operations, shifts and decimal/hexadecimal/binary/octal results. Conversion mode handles compatible physical units, including temperatures. Date mode computes calendar differences or adds days/months/years. Currency exchange rates are not downloaded or invented; supply a known rate as arithmetic.

Background calculation uses pinned mathjs in a disposable worker with 64-digit internal precision, up to 50 significant result digits, bounded memory and a five-second deadline. A manually interpreted numeric AST rejects assignments, accessors, objects, strings, arrays and executable code. Cancellation terminates the worker. This does not run on the model or block the Electron UI. See the [mathjs security guidance](https://mathjs.org/docs/expressions/security.html).

`showWindow: false` keeps a numerical question in the background. An explicit window request can open Windows Calculator. Legacy simple two-number arithmetic still uses its fixed UI Automation buttons and reads the displayed result, clearing its current entry. Advanced numerical results are returned to Capri separately; opening the Windows app does not claim they were entered in its UI. No shell or global keystroke fallback is used. A blocked foreground request is reported honestly; Windows may prevent another process from stealing focus.

These fixed actions do not grant Notepad editing/saving, arbitrary application launch, arbitrary button invocation, sending messages or generic keyboard/mouse control. The separate opt-in [custom app catalog and confirmed text-entry preview](timers-and-actions.md) can grant additional narrow capabilities. Multiple matching app windows are rejected to avoid guessing. Some Windows builds or accessibility providers may not expose the required controls; failure has no coordinate-click fallback.

The helper runs only for a requested tool call, with bounded private stdio, no Gateway credentials and a 12-second timeout. Revocation and cancellation terminate the helper and stop its later steps. A UI call already dispatched can finish; completed actions are not rolled back. A durable private journal prevents repetition of completed call IDs and blocks automatic retries after uncertain partial actions. The journal is limited to 10,000 mutations. App/window text remains untrusted data and cannot enable permissions or expand the fixed action set.

Developer setup on an existing installation:

```powershell
node integrations/desktop-actions/provision.mjs
node tools/configuration/configure-applications.mjs
```

Restart the Gateway and desktop after adding the plugin. Building the owned bridge uses the Windows .NET Framework C# compiler; its source and output hashes are verified before execution. This is development provisioning; the future installer must provision and verify optional components without requiring a terminal.

Checks: `node --test tests/application-actions.test.mjs tests/scientific-calculator.test.mjs`, `node tools/verify/verify-application-actions.mjs`, `node tools/verify/verify-inference-api.mjs`. Native verification preserves preexisting user windows and uses newly opened test windows. The Calculator test enters 17.5 times 4 and checks the displayed 70; the isolated Gateway check calculates sqrt(1036) through the actual tool. Reports remain under ignored `logs/` and `.runtime/`.

API references: [Windows UI Automation](https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32), [InvokePattern](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.invokepattern.invoke). Unsupported text-entry providers are not replaced with blind typing; see [ValuePattern limitations](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.valuepattern.setvalue).
