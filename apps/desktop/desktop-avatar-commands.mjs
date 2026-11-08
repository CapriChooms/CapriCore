// SPDX-License-Identifier: GPL-3.0-only

export function isSettingsWindowTitle(title, localizedTitles = []) {
  if (typeof title !== 'string' || !title.trim()) return false;
  const normalized = (value) => value.normalize('NFKC').trim().toLowerCase();
  const value = normalized(title);
  return (
    localizedTitles.some((label) => normalized(label) === value) ||
    /^(?:(?:the|your|her|capri(?:['’]s)?)\s+)?settings(?:\s+capri)?$/u.test(value) ||
    /^(?:(?:твои|твоих|свои|своих)\s+)?настро(?:йки|ек)(?:\s+(?:capri|капри))?$/u.test(value)
  );
}

/** The avatar's own movement commands run before desktop tools or inference. */
export function desktopAvatarCommand(text) {
  const command = text
    .normalize('NFKC')
    .trim()
    .replace(/[.!?…]+$/u, '')
    .replace(/^(?:capri|капри)[\s,:!]+/iu, '')
    .replace(/^(?:please\s+|пожалуйста[,\s]+)/iu, '')
    .replace(/(?:,?\s+please|,?\s+пожалуйста)$/iu, '')
    .trim();
  if (
    /^(?:return|go back|come back|teleport back) (?:(?:to|into) (?:your|the) (?:frame|window)|home)$/iu.test(
      command,
    ) ||
    /^(?:вернись|возвращайся|телепортируйся обратно)(?: (?:обратно )?(?:в (?:сво[еёю] )?(?:окно|окошко|рамку)|к себе|домой|на место))?$/iu.test(
      command,
    )
  )
    return { action: 'return' };
  const perch = command.match(
    /^(?:(?:sit|perch) on (?:top of )?(?:the )?(?:(?:active|current) )?window|(?:сядь|присядь|посиди) на (?:(?:край|верх) )?(?:(?:активное|активном|текущее|текущем) )?окн[ое])(?:\s+(.*))?$/iu,
  );
  if (perch) {
    const title = (perch[1] ?? '').replace(/^[«"']|[»"']$/gu, '').slice(0, 160);
    const aliases = [
      [/^(?:гугл )?хрома?$/iu, 'chrome'],
      [/^блокнота?$/iu, 'notepad'],
      [/^дискорда?$/iu, 'discord'],
      [/^проводника?$/iu, 'explorer'],
    ];
    return { action: 'perch', title: aliases.find(([name]) => name.test(title))?.[1] ?? title };
  }
  const named = command.match(/^(?:sit|perch) on (?:top of )?(?:the )?(.+?) window$/iu);
  if (named) return { action: 'perch', title: named[1].slice(0, 160) };
  return null;
}

export function randomAvatarDestination(area, owner, previous, random = Math.random) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const point = {
      x: Math.round(area.x + area.width * (0.13 + random() * 0.74)),
      y: Math.round(area.y + area.height * (0.34 + random() * 0.55)),
    };
    if (
      (point.x < owner.x - 40 ||
        point.x >= owner.x + owner.width + 40 ||
        point.y < owner.y ||
        point.y >= owner.y + owner.height + 40) &&
      (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 140)
    )
      return point;
  }
  return null;
}
