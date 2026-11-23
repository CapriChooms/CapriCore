// SPDX-License-Identifier: GPL-3.0-only
const attachmentId = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const kinds = new Set(['image', 'document', 'video', 'animation']);
const iconPaths = {
  image: 'M3 3h14v14H3zM3 13l4-4 4 4 3-3 3 3M13 6h1',
  file: 'M5 2h7l4 4v12H5zM12 2v5h4M8 11h5M8 14h5',
};

function icon(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', iconPaths[kind]);
  svg.append(path);
  return svg;
}

function fileSize(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return '';
  const unit = bytes >= 1_000_000 ? 'MB' : bytes >= 1000 ? 'KB' : 'B';
  const divisor = { MB: 1_000_000, KB: 1000, B: 1 }[unit];
  return `${new Intl.NumberFormat(document.documentElement.lang || 'en', {
    maximumFractionDigits: unit === 'B' ? 0 : 1,
  }).format(bytes / divisor)} ${unit}`;
}

/** Render bounded, local display records. No paths, original files or remote URLs. */
export class HistoryAttachments {
  constructor({ openImage, text }) {
    Object.assign(this, { openImage, text });
  }

  render(container, value) {
    const files = Array.isArray(value)
      ? value
          .slice(0, 4)
          .filter(
            (file) =>
              file &&
              typeof file.id === 'string' &&
              attachmentId.test(file.id) &&
              typeof file.name === 'string' &&
              file.name.trim() &&
              file.name.length <= 160 &&
              kinds.has(file.kind),
          )
      : [];
    const signature = `${document.documentElement.lang}:${JSON.stringify(files)}`;
    // Stream updates must not reload thumbnails or replace a focused preview button.
    if (container.attachmentSignature === signature) return;
    container.attachmentSignature = signature;
    container.hidden = files.length === 0;
    container.replaceChildren(...files.map((file) => this.card(file)));
  }

  card(file) {
    const card = document.createElement('li');
    card.className = 'message-attachment';
    card.dataset.attachmentId = file.id;
    const hasPreview = file.preview === true && file.kind !== 'document';
    const content = document.createElement(hasPreview ? 'button' : 'div');
    content.className = hasPreview ? 'message-attachment-image' : 'message-attachment-file';
    content.dataset.attachmentId = file.id;
    if (hasPreview) {
      content.type = 'button';
      content.title = `${this.text('Preview')}: ${file.name}`;
      content.setAttribute('aria-label', content.title);
      const image = document.createElement('img');
      image.loading = 'lazy';
      image.decoding = 'async';
      image.alt = file.name;
      image.src = `capri://desktop/attachments/${file.id.toLowerCase()}/thumb.png`;
      image.addEventListener('error', () => {
        image.hidden = true;
        this.unavailable(content);
      });
      const thumbnail = document.createElement('span');
      thumbnail.className = 'message-attachment-thumbnail';
      thumbnail.append(image);
      const expand = document.createElement('span');
      expand.className = 'message-attachment-expand';
      expand.setAttribute('aria-hidden', 'true');
      expand.append(icon('image'));
      content.append(thumbnail, expand);
      content.addEventListener('click', async () => {
        try {
          const result = await this.openImage(file.id);
          if (result === false || result?.ok === false) this.unavailable(content, false);
          else {
            delete content.dataset.unavailable;
            content.querySelector('.message-attachment-unavailable')?.remove();
            content.title = `${this.text('Preview')}: ${file.name}`;
          }
        } catch {
          this.unavailable(content, false);
        }
      });
    } else {
      content.append(icon('file'));
    }
    const details = document.createElement('span');
    details.className = 'message-attachment-details';
    const name = document.createElement('bdi');
    name.className = 'message-attachment-name';
    name.textContent = file.name;
    name.title = file.name;
    const information = document.createElement('span');
    information.className = 'message-attachment-info';
    information.textContent = [
      /\.([a-z\d]{1,8})$/i.exec(file.name)?.[1].toUpperCase(),
      fileSize(file.bytes),
    ]
      .filter(Boolean)
      .join(' · ');
    details.append(name, information);
    content.append(details);
    if (!hasPreview && file.kind !== 'document') {
      const unavailable = document.createElement('span');
      unavailable.className = 'message-attachment-unavailable';
      unavailable.textContent = this.text('Image preview unavailable');
      content.append(unavailable);
    }
    card.append(content);
    return card;
  }

  unavailable(button, disable = true) {
    // A cancelled/failed viewer launch may be retried. Only a missing thumbnail
    // establishes that the stored preview is unavailable for this card.
    if (disable) button.disabled = true;
    button.dataset.unavailable = 'true';
    button.title = this.text('Image preview unavailable');
    let label = button.querySelector('.message-attachment-unavailable');
    if (!label) {
      label = document.createElement('span');
      label.className = 'message-attachment-unavailable';
      button.append(label);
    }
    label.textContent = button.title;
  }
}
