import { INTERFACE_LOCALES } from './interface-translations.mjs';
export {
  INTERFACE_LOCALES,
  InterfaceLanguage,
  uiText,
  displayLanguage,
} from './interface-translations.mjs';
import catalog from '../../shared/languages.json' with { type: 'json' };

export const LANGUAGE_DEFAULTS = Object.freeze({
  interface: 'en',
  conversation: 'en',
  customConversation: '',
  recognition: 'follow',
  speech: 'follow',
  autoDetect: false,
});
export const LANGUAGE_PACKS = Object.freeze(
  catalog.map((item) =>
    Object.freeze({
      ...item,
      interfaceReady: INTERFACE_LOCALES.some((locale) => locale.id === item.id),
      conversationReady: true,
      recognitionReady: true,
      speechReady: item.speech,
    }),
  ),
);
export const languageName = (id) =>
  LANGUAGE_PACKS.find((item) => item.id === id)?.name ??
  (id === 'auto' ? 'automatically detected language' : id);
export function resolveLanguages(value) {
  const recognition =
    value.autoDetect || value.recognition === 'auto'
      ? 'auto'
      : value.recognition === 'follow'
        ? value.conversation === 'custom'
          ? 'auto'
          : value.conversation
        : value.recognition;
  const speech =
    value.speech === 'follow'
      ? LANGUAGE_PACKS.find((p) => p.id === value.conversation)?.speechReady
        ? value.conversation
        : 'off'
      : value.speech;
  return { ...value, recognition, speech };
}
export function validateLanguages(value) {
  if (
    !value ||
    !INTERFACE_LOCALES.some((p) => p.id === value.interface) ||
    typeof value.autoDetect !== 'boolean'
  )
    throw new Error('Invalid interface language');
  const customConversation = value.customConversation ?? '';
  if (
    typeof customConversation !== 'string' ||
    customConversation.length > 60 ||
    (customConversation && !/^[\p{L}\p{M} ()'-]+$/u.test(customConversation))
  )
    throw new Error('Enter a language name, without instructions or formatting.');
  if (value.conversation !== 'custom' && !LANGUAGE_PACKS.some((p) => p.id === value.conversation))
    throw new Error('Unknown conversation language');
  if (value.conversation === 'custom' && !customConversation.trim())
    throw new Error('Enter the conversation language name.');
  if (
    !['follow', 'auto', 'auto-europe', 'off', ...LANGUAGE_PACKS.map((p) => p.id)].includes(
      value.recognition,
    )
  )
    throw new Error('Unknown recognition language');
  if (
    !['follow', 'off', ...LANGUAGE_PACKS.filter((p) => p.speechReady).map((p) => p.id)].includes(
      value.speech,
    )
  )
    throw new Error('No voice model for this language.');
  const spoken = resolveLanguages(value).speech;
  if (spoken !== 'off' && spoken !== value.conversation)
    throw new Error(
      'Choose a voice matching the conversation language, or Use conversation language.',
    );
  const recognition = value.autoDetect ? 'auto' : value.recognition;
  return {
    interface: value.interface,
    conversation: value.conversation,
    customConversation: customConversation.trim(),
    recognition,
    speech: value.speech,
    autoDetect: recognition === 'auto',
  };
}

/** UI-only changes do not alter any model, capture or dialogue preference. */
export function languageBehaviorChanged(previous, next) {
  return ['conversation', 'customConversation', 'recognition', 'speech', 'autoDetect'].some(
    (key) => (previous[key] ?? LANGUAGE_DEFAULTS[key]) !== (next[key] ?? LANGUAGE_DEFAULTS[key]),
  );
}
