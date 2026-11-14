# Character and romantic role-play

Capri's default character combines curiosity, mischief, warmth and a willingness
to join an owner-invited romantic scene. Affection, requested pet names, imagined
dates, kisses and quiet companionship are welcome. Intimate scenes stay
non-graphic and can fade to black. The romantic relationship is a project
adaptation, rather than an assertion about anime canon.

Communication style shapes that same character. Neutral is observant and dry,
Romantic is warmer and playfully attentive, Business gives the decision or
result first, and Wild turns a detail from the conversation into a sharper joke
or image. The setting takes effect on the next reply.

## One editable source

The active prompt is data/workspace/PERSONALITY.md. Settings edits this exact
file; Show Personality file reveals it for an external editor. Saved edits are
read on the next request. There is no separate SOUL override or second character
layer. The editor accepts Unicode text without a topic or keyword filter, with
a technical limit of 24,000 characters and no NUL bytes. Model behavior still
depends on the selected model; saving instructions does not guarantee compliance.

The only shipped prompt template is config/workspace/PERSONALITY.md. First-run
setup copies it into the owner's private workspace. Restore original character,
or saving an empty field, writes this template into the same active file and
updates the editor. Updates can refresh an exact copy of a known factory
profile. Capri backs up that copy first and preserves user edits. Use Clear
context separately when you want a fresh scene.

Tool definitions, active interface state and language delivery are supplied by
code. They describe actual permissions and protocol, not an additional editable
character. Screen, microphone, file and application permissions remain enforced
by the application. USER.md, MEMORY.md and memory/ contain owner information,
not alternative personality prompts.

## Migration from older layouts

On startup an existing nonempty PERSONALITY.md takes priority. If it is absent,
a previous custom personality.json is imported first,
then SOUL.md, then the shipped template. An explicitly empty Markdown file means
restore the template; it never resurrects a legacy override.

SOUL.md, AGENTS.md, IDENTITY.md, TOOLS.md and personality.json are copied into a
unique data/config-backups/persona directory before being removed from the active
workspace. An existing PERSONALITY.md is backed up alongside them. Memory,
conversations and unrelated user files are preserved. Repeating startup does not
create another backup or bring back legacy files.

The managed OpenClaw configuration disables bootstrap template creation. Its
reviewed prompt adapter recognizes Capri's PERSONALITY header and excludes old
character bootstrap entries, including cached entries or a second Personality
copy. USER.md and MEMORY.md remain available. Desktop, command-line and future
Telegram ingress use the same current file and explicit shared session.
