// SPDX-License-Identifier: GPL-3.0-only
const messages = {
  CAPRI_VISUAL_TRUNCATED:
    'The model reached its reply limit. Ask for a shorter answer or try another model.',
  CAPRI_VISUAL_INCOMPLETE: 'The model did not finish its reply. Please try again.',
  CAPRI_VISUAL_HTTP:
    'The API could not process the attachments. Check the connection in External AI provider settings.',
  CAPRI_VISUAL_PROVIDER:
    'The model could not finish its reply. Check the API connection and try again.',
  CAPRI_VISUAL_TIMEOUT:
    'Reading the attachments took too long. Try again or choose a faster model.',
};

/** Fixed user messages and technical codes only: never retain a provider body or prompt. */
export function visualReplyFailure(error, { timedOut = false, attachments = false } = {}) {
  const code =
    timedOut || error?.name === 'TimeoutError'
      ? 'CAPRI_VISUAL_TIMEOUT'
      : Object.hasOwn(messages, error?.code)
        ? error.code
        : 'CAPRI_VISUAL_FAILED';
  const providerStatus =
    Number.isInteger(error?.providerStatus) &&
    error.providerStatus >= 400 &&
    error.providerStatus <= 599
      ? error.providerStatus
      : undefined;
  return {
    code,
    message:
      messages[code] ??
      (attachments
        ? 'Capri could not finish reading the attachments. Try again with fewer or smaller files.'
        : 'The snapshot response could not be completed. Take a new snapshot or try text chat.'),
    ...(providerStatus && { providerStatus }),
  };
}
