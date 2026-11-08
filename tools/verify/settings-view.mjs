// SPDX-License-Identifier: GPL-3.0-only
/** Open the real settings window without relying on an OS-native menu. */
export async function settingsView(application, section) {
  const primary = application.windows().find((page) => page.url() === 'capri://desktop/index.html');
  if (!primary) throw new Error('Companion renderer unavailable');
  await primary.evaluate((section) => window.capri.openSettings(section), section);
  for (let i = 0; i < 100; i++) {
    const page = application
      .windows()
      .find((page) => page.url() === 'capri://desktop/settings.html');
    if (page) {
      await page.waitForSelector(
        section
          ? `[data-section="${section}"][aria-current="page"]`
          : '[data-section][aria-current="page"]',
        {
          timeout: 20000,
        },
      );
      // The renderer is populated before the lifecycle controller presents the
      // first native frame. DOM visibility alone also matches a hidden window.
      for (let shown = 0; shown < 200; shown++) {
        const visible = await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some(
            (window) =>
              window.webContents.getURL() === 'capri://desktop/settings.html' && window.isVisible(),
          ),
        );
        if (visible) return page;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Settings renderer loaded but its native window did not appear');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Settings renderer did not open');
}

/** Save drafts through the close prompt and leave Settings open. */
export async function saveSettings(page, { wait = true } = {}) {
  await page.locator('#settings-window-close').click();
  await page.locator('#settings-apply').click();
  if (!wait) return;
  await page.waitForFunction(() => document.getElementById('settings-draft-actions').hidden);
}
