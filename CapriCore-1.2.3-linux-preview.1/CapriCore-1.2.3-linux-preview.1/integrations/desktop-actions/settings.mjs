export const APPLICATION_DEFAULTS = { notepad: false, calculator: false };
export function validateApplications(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    Object.keys(value).some((k) => !Object.hasOwn(APPLICATION_DEFAULTS, k)) ||
    typeof value.notepad !== 'boolean' ||
    typeof value.calculator !== 'boolean'
  )
    throw new Error('Invalid application permissions');
  return { notepad: value.notepad, calculator: value.calculator };
}
