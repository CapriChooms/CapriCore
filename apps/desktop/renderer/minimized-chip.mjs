const button = document.querySelector('button');
const api = window.capriChip;
let gesture = null;
let generation = 0;
const restore = () => {
  generation++;
  void api.restore().catch(() => {});
};

function release(press) {
  cancelAnimationFrame(press.frame);
  delete button.dataset.dragging;
  if (button.hasPointerCapture(press.id)) button.releasePointerCapture(press.id);
}

function cancel() {
  const press = gesture;
  if (!press) return;
  const cancelledGeneration = ++generation;
  gesture = null;
  release(press);
  void press.started
    .then(() => (generation === cancelledGeneration ? api.drag('cancel') : null))
    .catch(() => {});
}

function scheduleMove(press) {
  if (press.frame || press.pending || gesture !== press) return;
  press.frame = requestAnimationFrame(() => {
    press.frame = 0;
    if (gesture !== press) return;
    press.dirty = false;
    press.pending = true;
    void press.started
      .then(() => (gesture === press ? api.drag('move') : null))
      .then((state) => {
        if (gesture !== press) return;
        if (state?.cancelled) cancel();
        else if (state?.moved) {
          press.moved = true;
          button.dataset.dragging = 'true';
        }
      })
      .catch(() => {
        if (gesture === press) cancel();
      })
      .finally(() => {
        press.pending = false;
        if (press.dirty) scheduleMove(press);
      });
  });
}

button.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !event.isPrimary || gesture) return;
  event.preventDefault();
  const press = {
    id: event.pointerId,
    generation: ++generation,
    x: event.screenX,
    y: event.screenY,
    moved: false,
    frame: 0,
    pending: false,
    dirty: false,
    started: api.drag('start'),
  };
  gesture = press;
  button.setPointerCapture(press.id);
  void press.started
    .then((state) => {
      if (gesture === press && state?.cancelled) cancel();
    })
    .catch(() => {
      if (gesture === press) cancel();
    });
});
button.addEventListener('pointermove', (event) => {
  const press = gesture;
  if (!press || event.pointerId !== press.id) return;
  if (Math.hypot(event.screenX - press.x, event.screenY - press.y) >= 4) {
    press.moved = true;
    button.dataset.dragging = 'true';
  }
  if (!press.moved) return;
  press.dirty = true;
  scheduleMove(press);
});
button.addEventListener('pointerup', (event) => {
  const press = gesture;
  if (!press || event.pointerId !== press.id || event.button !== 0) return;
  event.preventDefault();
  gesture = null;
  release(press);
  void press.started
    .then(() =>
      generation === press.generation ? api.drag('end') : { moved: false, cancelled: true },
    )
    .then((state) => {
      if (generation === press.generation && !press.moved && !state?.moved && !state?.cancelled)
        restore();
    })
    .catch(() => {});
});
button.addEventListener('pointercancel', cancel);
button.addEventListener('lostpointercapture', cancel);
button.addEventListener('click', (event) => {
  // Pointer activation is decided after native drag completion; keyboard stays immediate.
  event.preventDefault();
  if (event.detail === 0 && !gesture) restore();
});
window.addEventListener('blur', cancel);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancel();
});
window.addEventListener('beforeunload', cancel);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && gesture) {
    event.preventDefault();
    cancel();
  }
});
window.capriChip.onLabels((value) => {
  button.title = value.title;
  button.setAttribute('aria-label', value.title);
  document.documentElement.lang = value.language;
  document.documentElement.style.setProperty('--chip-accent', value.accent);
  document.documentElement.style.setProperty('--chip-background', value.background);
});
