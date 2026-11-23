document.querySelector('button').onclick = () => window.capriRecording.stop().catch(() => {});
window.capriRecording.onLabels((value) => {
  document.querySelector('span').textContent = value.text;
  document.querySelector('button').setAttribute('aria-label', value.title);
  document.documentElement.lang = value.language;
  document.documentElement.dir = value.direction;
});
