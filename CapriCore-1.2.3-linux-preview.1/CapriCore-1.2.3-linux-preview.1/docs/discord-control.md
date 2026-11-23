# Discord desktop control

Capri can use your already open, signed-in **Discord desktop app** through Computer control. No bot, Discord token or extra account connection is needed. Enable full computer access in Settings → Computer control. Press **Esc** to stop an active task.

Give Capri the server and channel names. Quoted names make exact commands faster and avoid confusion between similarly named channels:

- `Join Discord voice channel "Lounge" on server "Friends".`
- `Leave the Discord voice channel.`
- `Open Discord channel "general" on server "Friends".`
- `List channels on Discord server "Friends".`
- `Read Discord channel "general" on server "Friends".`
- `Send "Hello everyone!" in Discord channel "general" on server "Friends".`

Russian examples: `Подключись к голосовому каналу «Общий» на сервере «Друзья» в Discord.` and `Выйди из голосового канала Discord.` Other request languages use Capri's configured model to interpret the task, then the same guarded desktop executor. The observed Discord controls currently support English and Russian labels. Unrecognized layouts ask for clarification instead of guessing.

Capri verifies the actual voice connection and its server/channel. It reads only visible channel information, preserves existing message drafts and submits an explicitly requested message once. A submitted message is not proof of delivery. Duplicate channel/server names, missing permissions and unverified results require your help; uncertain actions are never automatically replayed. Lists and summaries cover visible content, not the entire server history.

Joining uses your Discord account's current audio settings. To let callers hear Capri's generated voice, configure **Settings → Voice calls → Speak in a call** using the existing audio setup. Joining a channel does not change microphone, camera or screen-sharing settings.

The executor uses visible accessibility controls and Discord's [Quick Switcher](https://support.discord.com/hc/en-us/articles/115000070311-Quick-Switcher). It does not read account credentials, modify Discord, or call private account APIs. Discord task planning receives structural controls instead of unrelated chat messages or unsent drafts; channel content is provided only for an explicit read request. Raw observations are excluded from diagnostic logs, and task traces contain action/status metadata only.

For a local test without contacting Discord users, run `node tools/verify/verify-discord-control.mjs`. It opens a disposable native fixture, fences every input to that fixture's process, and checks channel joining/leaving, one-time message submission, Unicode text verification and bounded observations.
