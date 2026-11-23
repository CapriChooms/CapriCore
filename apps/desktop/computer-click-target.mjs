// SPDX-License-Identifier: GPL-3.0-only
export function hasVisualEvidence(target) {
  return (
    target?.source === 'vision' ||
    target?.visualConfirmed === true ||
    target?.clickKind === 'visual-caption'
  );
}

export function canClickTarget(target, { exact = false, button = 'left', clickCount = 1 } = {}) {
  if (!target || target.browserDocumentAddress || target.duplicateCaption) return false;
  if (target.clickKind === 'text') return false;
  if (target.clickKind === 'candidate') return exact;
  if (target.clickKind === 'visual-caption') return button === 'left' && clickCount === 1;
  return true;
}
