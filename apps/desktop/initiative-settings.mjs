export const INITIATIVE_DEFAULTS = {
  level: 'off',
  hourlyLimit: null,
  quietStart: 23,
  quietEnd: 9,
  quietHoursEnabled: true,
  spontaneous: true,
  returnReactions: true,
  appReactions: false,
  excludedApps: ['discord', 'ms-teams', 'teams', 'zoom', 'powerpnt', 'obs64'],
};
export function validateInitiative(value) {
  value = value && {
    ...value,
    hourlyLimit: value.hourlyLimit ?? null,
    quietHoursEnabled: value.quietHoursEnabled ?? value.quietStart !== value.quietEnd,
    spontaneous: value.spontaneous ?? true,
  };
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 9 ||
    Object.keys(value).some((k) => !Object.hasOwn(INITIATIVE_DEFAULTS, k)) ||
    !['off', 'occasional', 'conversational'].includes(value.level) ||
    (value.hourlyLimit !== null &&
      (!Number.isInteger(value.hourlyLimit) || value.hourlyLimit < 1 || value.hourlyLimit > 30)) ||
    ![value.quietStart, value.quietEnd].every((n) => Number.isInteger(n) && n >= 0 && n < 24) ||
    typeof value.returnReactions !== 'boolean' ||
    typeof value.quietHoursEnabled !== 'boolean' ||
    typeof value.spontaneous !== 'boolean' ||
    typeof value.appReactions !== 'boolean' ||
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
    excludedApps: [...new Set(value.excludedApps.map((n) => n.toLowerCase()))],
  };
}
export function quietHour(settings, hour) {
  if (settings.quietHoursEnabled === false) return false;
  const start = settings.quietStart,
    end = settings.quietEnd;
  return start === end
    ? false
    : start < end
      ? hour >= start && hour < end
      : hour >= start || hour < end;
}

export function initiativeLimit(settings) {
  return settings.hourlyLimit ?? (settings.level === 'occasional' ? 10 : 30);
}
