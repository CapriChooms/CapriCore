import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WorkflowsPanel,
  WORKFLOW_ACTION_LABELS,
} from '../apps/desktop/renderer/workflows-panel.mjs';
import { INTERFACE_LOCALES, uiText } from '../apps/desktop/renderer/interface-translations.mjs';

class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
  }
  append(...items) {
    this.children.push(...items);
  }
  replaceChildren(...items) {
    this.children = items;
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  set textContent(value) {
    this.children = [String(value)];
  }
  get textContent() {
    return this.children
      .map((item) => (typeof item === 'string' ? item : item.textContent))
      .join('');
  }
}

test('applying edited workflow steps preserves the current unsaved workflow name', async () => {
  const previousDocument = globalThis.document;
  const fields = new Map();
  const field = (id) => {
    if (!fields.has(id)) fields.set(id, new Element());
    return fields.get(id);
  };
  globalThis.document = {
    createElement: (tag) => {
      const element = new Element(tag);
      element.querySelectorAll = () => [];
      element.querySelector = (selector) => field(selector.slice(1));
      return element;
    },
    getElementById: field,
  };
  try {
    let saved;
    const panel = new WorkflowsPanel({
      api: {
        workflowAction: async ({ action, workflow }) => {
          assert.equal(action, 'save');
          saved = structuredClone(workflow);
          return [];
        },
      },
      ui: { text: (text) => text },
      onError: (message) => assert.fail(message),
    });
    panel.edit({ name: 'Original workflow', steps: [{ action: 'keys', keys: ['HOME'] }] });
    field('workflow-name').value = 'New name typed before editing JSON';
    const edited = [{ action: 'keys', keys: ['CTRL', 'END'], delayMs: 100 }];
    field('workflow-json').value = JSON.stringify(edited);
    await field('workflow-edit').onclick();
    assert.equal(field('workflow-name').value, 'New name typed before editing JSON');
    await field('workflow-save').onclick();
    assert.deepEqual(saved, { name: 'New name typed before editing JSON', steps: edited });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('workflow rows localize owned action labels in every UI language without translating targets or protocol data', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const steps = [
      { action: 'click', selector: { role: 'ControlType.Button', label: 'Open' } },
      { action: 'drag', selector: { role: 'ControlType.Button', label: 'Settings' } },
      { action: 'keys', keys: ['CTRL', 'A'] },
      { action: 'scroll', amount: -120 },
      {
        action: 'text',
        selector: { role: 'ControlType.Edit', label: 'Menu' },
        text: '{{ownerText}}',
      },
    ];
    for (const { id } of INTERFACE_LOCALES) {
      const fields = new Map();
      const panel = Object.create(WorkflowsPanel.prototype);
      panel.$ = (name) => {
        if (!fields.has(name)) fields.set(name, new Element());
        return fields.get(name);
      };
      panel.ui = { text: (text) => uiText(text, id) };
      panel.draft = { steps: structuredClone(steps) };
      panel.render();
      const rows = fields.get('workflow-steps').children;
      assert.equal(rows.length, steps.length);
      for (const [index, row] of rows.entries()) {
        const title = row.children[0];
        const label = title.children[1];
        const detail = title.children[3];
        assert.equal(label.textContent, uiText(WORKFLOW_ACTION_LABELS[steps[index].action], id));
        assert.equal(Object.hasOwn(label.dataset, 'untranslated'), false);
        assert.equal(Object.hasOwn(detail.dataset, 'untranslated'), true);
        assert.equal(
          detail.textContent,
          String(
            steps[index].selector?.label ??
              steps[index].keys?.join(' + ') ??
              steps[index].amount ??
              '',
          ),
        );
      }
      assert.equal(rows[4].children[1].value, '{{ownerText}}');
      assert.deepEqual(JSON.parse(fields.get('workflow-json').value), steps);
      assert.deepEqual(panel.draft.steps, steps);
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
