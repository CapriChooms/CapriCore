// SPDX-License-Identifier: GPL-3.0-only
/** Translate app-owned native dialog labels; chosen paths remain user data. */
export function localizedDialog(dialog, text) {
  return new Proxy(dialog, {
    get(target, key) {
      if (!['showOpenDialog', 'showSaveDialog', 'showMessageBox'].includes(key))
        return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
      return (...args) => {
        const index = args.length - 1,
          options = { ...args[index] };
        for (const field of ['title', 'message', 'detail', 'buttonLabel', 'checkboxLabel'])
          if (typeof options[field] === 'string') options[field] = text(options[field]);
        if (options.filters)
          options.filters = options.filters.map((f) => ({ ...f, name: text(f.name) }));
        if (options.buttons) options.buttons = options.buttons.map(text);
        args[index] = options;
        return target[key](...args);
      };
    },
  });
}
