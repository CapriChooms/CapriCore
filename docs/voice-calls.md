# Voice calls

On Windows, **Settings → Audio** lets you choose independent endpoints for microphone input, Capri’s local playback, music detection, and listening to system audio in calls. A recording input receives its own signal. A playback device listed under **Playback devices (loopback)** captures the sound Windows sends to that device. For example, route your player to a dedicated Virtual Cable in Windows and select that cable’s playback endpoint for music detection. Changes are saved on this PC and leave Windows defaults alone. [How Windows playback loopback works](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording)

Enable the **Voice calls** skill to use your preferred call output. Capri preselects it under **Voice calls → Advanced: choose a cable manually**. Click **Enable call output** there to connect it. To let Capri hear your call, start her microphone and click **Include system audio**. Selecting a device alone does not start either connection.

Open **Settings → Voice calls → Set up automatically**. Capri finds an existing virtual audio cable and mixes your selected physical microphone with her voice. Speech recognition does not need to be enabled for this.

If no cable is installed, choose **Install VB-CABLE and connect** after reviewing its license. Approve the Windows administrator prompt. Capri downloads the original, verified driver from VB-Audio and preserves your usual Windows audio devices. Restart Windows if requested, then click **Set up automatically** again. Capri never restarts Windows automatically.

In Discord, Zoom, or your call application, select the exact **Microphone to select in your call app** shown by Capri, usually **CABLE Output (VB-Audio Virtual Cable)**. Keep that application's speakers on your real headphones or speakers. This final selection belongs to the call application; Capri does not change every application's microphone or join calls automatically.

Your microphone stays live until **Stop call output**. After you connect the call output, **Send replies to call** is enabled for that session: Capri’s ordinary spoken replies are also shared with the call. Turn it off to keep ordinary replies local; you can still explicitly choose **Speak in call**, **Speak last reply in call**, or approved **Ask Capri in call**. Voice previews always stay local. Disconnecting stops reply sharing; it is never enabled merely by reopening Settings. No microphone recordings are saved by the mixer. Disconnecting a cable or microphone stops the call route. Hiding Capri fully in the tray or locking Windows also stops it; hiding just the home interface while Capri remains on the desktop preserves the active route.

To let Capri hear people in the call too, enable her microphone, then choose **Include system audio**. Use headphones to avoid feedback. This optional listening step is separate from sharing the microphone.

VB-CABLE is donationware by [VB-Audio](https://vb-audio.com/Cable/). If you find it useful, support its author or purchase a license. Its [licensing and distribution terms](https://vb-audio.com/Services/licensing.htm) apply independently of Capri's code license. Capri downloads only the public VB-CABLE package; additional paid cables are not bundled.

## Capri Camera on Windows

Enable **Voice calls**, then turn on **Camera** in that settings panel. Select **Capri Camera** as the camera in Discord or Zoom, or add it as a **Video Capture Device** in OBS. Reopen your call app if its camera list was already cached. [OBS video capture sources](https://obsproject.com/kb/video-capture-sources/)

If Zoom still omits Capri Camera, choose **Direct Show** under **Video & effects → Advanced → Video Capturing Method**. [Zoom advanced video settings](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0066515)

Capri Camera sends a 640 × 360 video of Capri’s sprite for your current Windows user session. Choose your microphone separately in the call app. Turning Camera off, locking Windows, or exiting Capri removes the virtual device. Turn it on again for your next session.

In the Camera settings, choose a **Background color** or open **Background image…** to select a PNG or JPEG. Capri crops the image to fill the frame and saves the background for next time. Changes appear in the active camera feed. **Remove image** returns to your chosen color, and **Reset** restores the original dark background.

Capri Setup includes the 32-bit and 64-bit camera components. For a source checkout on Windows x64, run `node tools/release/build-camera.mjs` before using Camera. The Windows integration test is `node tools/verify/verify-call-camera.mjs`.
