# Local pre-alpha improvements

Target: the main installation on E:. The separate test installation on D: is outside this batch.
Order follows implementation complexity; related dependencies may be completed together.

| Order | Change                                                          | Status      |
| ----- | --------------------------------------------------------------- | ----------- |
| 1     | Compact language settings with readable language names          | Implemented |
| 2     | BETA labels for experimental capabilities                       | Implemented |
| 3     | Installer version, pre-alpha label and installation warning     | Implemented |
| 4     | New application icon from the supplied image                    | Implemented |
| 5     | Main function shortcuts and microphone button beside Send       | Implemented |
| 6     | Support author panel: Boosty, TikTok @overyx2 and GitHub        | Implemented |
| 7     | Bug reporting with a reviewable, privacy-conscious report       | Implemented |
| 8     | Speech animation using the approved mouth sprites               | Implemented |
| 9     | Editable private personality prompt                             | Implemented |
| 10    | Separate conversation and durable-memory reset controls         | Implemented |
| 11    | Configurable wake acknowledgement: tone, file or cached speech  | Implemented |
| 12    | Approved runtime sprite pack included in release exports        | Implemented |
| 13    | Silent shortcut startup, model preparation and loading progress | Implemented |
| 14    | Installer pause/resume with retained download progress          | Implemented |
| 15    | Bounded model-directed follow-up listening                      | Implemented |

Voice provenance must remain accurate. UI labels can be neutral; source recordings must not
be described as unused when they were used. Third-party asset notices remain separate from
the GPL license for Capri's own code. No guarantee of worldwide payment acceptance is made.

Verification uses temporary profiles and local fixtures rather than the owner's history.

Validation: core unit suite, approved asset checks, isolated native UI checks and resumable-download fixtures. See companion-controls.md for behavior and limits.
