// SPDX-License-Identifier: GPL-3.0-only
// Reviewed exact IDs, used only when the account catalog omits capability data.
// Unknown models stay unknown; a name containing "GPT" never proves vision.
const reviewed = new Map([
  ['gpt-6.1-terra', { vision: true, tools: true, fastEffort: 'none' }],
  ['gpt-6.1-sol', { vision: true, tools: true, fastEffort: 'low' }],
  ['gpt-6-astra', { vision: true, tools: true, fastEffort: 'low' }],
  ['gpt-6-luna', { vision: true, tools: true, fastEffort: 'none' }],
]);

export function chatGPTModelCapabilities(id, metadata = {}) {
  const capabilities = { ...reviewed.get(id) };
  const modalities = metadata.input_modalities;
  if (
    Array.isArray(modalities) &&
    modalities.length &&
    modalities.every((item) => typeof item === 'string')
  )
    capabilities.vision = modalities.includes('image');
  if (typeof metadata.supports_images === 'boolean') capabilities.vision = metadata.supports_images;
  if (typeof metadata.supports_function_calling === 'boolean')
    capabilities.tools = metadata.supports_function_calling;
  return capabilities;
}

export function chatGPTFastEffort(id) {
  return reviewed.get(id)?.fastEffort ?? 'low';
}
