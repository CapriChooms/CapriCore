// SPDX-License-Identifier: GPL-3.0-only
// The event stream feeds the progress window. Transaction journals remain mandatory.
export function progressReporter(write) {
  let warned = false;
  return (event) => {
    try {
      write(event);
    } catch {
      if (!warned) {
        warned = true;
        process.emitWarning('Capri update progress could not be recorded.');
      }
    }
  };
}
