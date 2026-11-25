export const INITIATIVE_DEFAULTS = {
  level: 'off',
  hourlyLimit: null,
  quietStart: 23,
  quietEnd: 9,
  quietHoursEnabled: false,
  spontaneous: true,
  returnReactions: true,
  appReactions: false,
  screenComments: false,
  watchTogether: false,
  appExclusionsEnabled: false,
  excludedApps: ['discord', 'ms-teams', 'teams', 'zoom', 'powerpnt', 'obs64'],
};
export function validateInitiative(value) {
  value = value && {
    ...value,
    hourlyLimit: value.hourlyLimit ?? null,
    quietHoursEnabled: value.quietHoursEnabled ?? false,
    spontaneous: value.spontaneous ?? true,
    screenComments: value.screenComments ?? false,
    watchTogether: value.watchTogether ?? false,
    appExclusionsEnabled: value.appExclusionsEnabled ?? false,
  };
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== Object.keys(INITIATIVE_DEFAULTS).length ||
    Object.keys(value).some((k) => !Object.hasOwn(INITIATIVE_DEFAULTS, k)) ||
    !['off', 'occasional', 'conversational'].includes(value.level) ||
    (value.hourlyLimit !== null &&
      (!Number.isInteger(value.hourlyLimit) || value.hourlyLimit < 1 || value.hourlyLimit > 120)) ||
    ![value.quietStart, value.quietEnd].every((n) => Number.isInteger(n) && n >= 0 && n < 24) ||
    typeof value.returnReactions !== 'boolean' ||
    typeof value.quietHoursEnabled !== 'boolean' ||
    typeof value.spontaneous !== 'boolean' ||
    typeof value.appReactions !== 'boolean' ||
    typeof value.screenComments !== 'boolean' ||
    typeof value.watchTogether !== 'boolean' ||
    typeof value.appExclusionsEnabled !== 'boolean' ||
    !Array.isArray(value.excludedApps) ||
    value.excludedApps.length > 30 ||
    !value.excludedApps.every((n) => typeof n === 'string' && /^[a-z0-9_.-]{1,60}$/i.test(n))
  )
    throw new Error('Invalid initiative settings');
  return {
    level: value.level,
    hourlyLimit: value.hourlyLimit,
    quietStart: value.quietStart,
    quietEnd: value.quietEnd,
    quietHoursEnabled: value.quietHoursEnabled,
    spontaneous: value.spontaneous,
    returnReactions: value.returnReactions,
    appReactions: value.appReactions,
    screenComments: value.screenComments,
    watchTogether: value.watchTogether,
    appExclusionsEnabled: value.appExclusionsEnabled,
    excludedApps: [...new Set(value.excludedApps.map(processName))],
  };
}
export function quietHour(settings, hour) {
  if (settings.quietHoursEnabled !== true) return false;
  const start = settings.quietStart,
    end = settings.quietEnd;
  return start === end
    ? false
    : start < end
      ? hour >= start && hour < end
      : hour >= start || hour < end;
}

function processName(name) {
  return name.toLowerCase().replace(/(.+)\.exe$/u, '$1');
}

export function initiativeAppExcluded(settings, foregroundName) {
  return Boolean(
    settings.appExclusionsEnabled &&
      foregroundName &&
      settings.excludedApps.includes(processName(foregroundName)),
  );
}

export function initiativeLimit(settings) {
  return settings.hourlyLimit ?? (settings.level === 'occasional' ? 10 : 30);
}
