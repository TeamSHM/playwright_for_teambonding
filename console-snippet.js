(() => {
  const WPM = 100;                         // target speed (1 word = 5 keystrokes)
  const CHAR_DELAY = 60000 / (WPM * 5);    // ms per keystroke
  const START_DELAY = 3000;                // time to click back into the page

  const input = document.querySelector('[data-testid="Typing-box-input"]');
  const box = document.querySelector('[data-testid="word-box-words"]');
  if (!input || !box) return console.error('Typing box not found, selectors changed?');

  // Keep the page thinking it still has focus while DevTools is active
  ['blur', 'focusout', 'visibilitychange'].forEach((type) => {
    window.addEventListener(type, (e) => e.stopImmediatePropagation(), true);
    document.addEventListener(type, (e) => e.stopImmediatePropagation(), true);
  });
  Object.defineProperty(document, 'hidden', { get: () => false });
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
  document.hasFocus = () => true;

  // React tracks textarea values internally, so use the native setter
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;

  const keyInfo = (ch) => ch === ' '
    ? { key: ' ', code: 'Space', keyCode: 32, which: 32 }
    : { key: ch, code: `Key${ch.toUpperCase()}`, keyCode: ch.toUpperCase().charCodeAt(0), which: ch.toUpperCase().charCodeAt(0) };

  const typeChar = (ch) => {
    const info = { ...keyInfo(ch), bubbles: true, cancelable: true };
    input.dispatchEvent(new KeyboardEvent('keydown', info));
    input.dispatchEvent(new KeyboardEvent('keypress', info));
    setValue.call(input, input.value + ch);
    input.dispatchEvent(new InputEvent('input', { data: ch, inputType: 'insertText', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', info));
  };

  // The active word is split across spans whose class ends in "-aw"
  const activeWord = () => [...box.querySelectorAll('span')]
    .filter((s) => /-aw\b/.test(s.className))
    .map((s) => s.textContent)
    .join('')
    .trim();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const run = async () => {
    input.focus();
    for (;;) {
      const word = activeWord();
      if (!word) return console.log('Done (no active word found)');
      for (const ch of word + ' ') {
        typeChar(ch);
        await sleep(CHAR_DELAY);
      }
    }
  };

  console.log(`Starting in ${START_DELAY / 1000}s, click the word box now`);
  setTimeout(run, START_DELAY);
})();
