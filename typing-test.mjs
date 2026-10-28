import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const URL = 'https://10fastfingers.com/typing-test/english';
const WPM = Number(process.env.WPM ?? 150);      // 1 word = 5 keystrokes
const KEY_DELAY_MS = 60000 / (WPM * 5);
const TEST_DURATION_MS = 62_000;                  // 1-minute test plus a little slack
const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE_DIR = resolve(process.env.CHROME_PROFILE_DIR ?? './.chrome-profile');
const DEBUG_PORT = Number(process.env.DEBUG_PORT ?? 9222);
const CDP_URL = `http://127.0.0.1:${DEBUG_PORT}`;
const CHROME_STARTUP_TIMEOUT_MS = 15_000;

const WORDS = '[data-testid="word-box-words"]';
const INPUT = '[data-testid="Typing-box-input"]';

// Runs in the page before the site's own scripts. Real and Playwright keystrokes
// are both "trusted" events, so the bot hands the guard a one-shot token for each
// key it is about to press; every other key, paste, drop or IME input is blocked.
const installKeyGuard = () => {
  let isActive = false;
  let allowedKey = null;   // token for the next bot keydown
  let passingKey = null;   // key currently going through (keydown -> keypress -> keyup)

  window.__typingBot = {
    allow: (key) => { allowedKey = key; },
    setActive: (value) => { isActive = value; allowedKey = null; passingKey = null; },
  };

  const block = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  window.addEventListener('keydown', (e) => {
    if (!isActive) return;
    if (allowedKey !== null && e.key === allowedKey) {
      passingKey = allowedKey;
      allowedKey = null;
      return;
    }
    block(e);
  }, true);

  window.addEventListener('keypress', (e) => {
    if (isActive && e.key !== passingKey) block(e);
  }, true);

  window.addEventListener('keyup', (e) => {
    if (!isActive) return;
    if (e.key === passingKey) {
      passingKey = null;
      return;
    }
    block(e);
  }, true);

  window.addEventListener('beforeinput', (e) => {
    if (isActive && passingKey === null) block(e);
  }, true);

  ['paste', 'drop', 'compositionstart', 'compositionupdate', 'compositionend'].forEach((type) => {
    window.addEventListener(type, (e) => { if (isActive) block(e); }, true);
  });
};

// Text from the active character onward. Classes are hashed, so match the
// "-ac" (active char) suffix seen in the markup, e.g. "wb-e7d0519749fd-ac".
const readRemainingText = (page) =>
  page.$eval(WORDS, (box) => {
    const spans = [...box.querySelectorAll('span')];
    const start = spans.findIndex((s) => /-ac\b/.test(s.className));
    return spans.slice(Math.max(start, 0)).map((s) => s.textContent).join('');
  });

const dismissCookieBanner = async (page) => {
  const button = page.getByRole('button', { name: /accept|agree|consent|allow all/i }).first();
  if (await button.isVisible({ timeout: 3000 }).catch(() => false)) {
    await button.click();
  }
};

const setGuard = (page, isActive) =>
  page.evaluate((value) => window.__typingBot?.setActive(value), isActive);

const pressGuarded = async (page, ch) => {
  const startedAt = Date.now();
  await page.evaluate((key) => window.__typingBot.allow(key), ch);
  await page.keyboard.press(ch === ' ' ? 'Space' : ch);
  const remainingDelay = KEY_DELAY_MS - (Date.now() - startedAt);
  if (remainingDelay > 0) await page.waitForTimeout(remainingDelay);
};

const isChromeListening = () =>
  fetch(`${CDP_URL}/json/version`).then((res) => res.ok, () => false);

// Start a plain Chrome (no Playwright flags, so extensions load normally) with
// remote debugging on, or reuse one already running on DEBUG_PORT.
const ensureChrome = async () => {
  if (await isChromeListening()) return;

  const chrome = spawn(CHROME_PATH, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
  ], { detached: true, stdio: 'ignore' });
  chrome.unref();                          // Chrome keeps running after this script exits

  const deadline = Date.now() + CHROME_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isChromeListening()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Chrome did not open debugging port ${DEBUG_PORT} within ${CHROME_STARTUP_TIMEOUT_MS / 1000}s`);
};

const main = async () => {
  await ensureChrome();
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  await context.addInitScript(installKeyGuard);

  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await dismissCookieBanner(page);

  await page.waitForSelector(WORDS);
  await page.click(WORDS);                 // focuses the hidden textarea
  await page.focus(INPUT).catch(() => {});

  await setGuard(page, true);
  console.log(`Typing at ~${WPM} WPM (${KEY_DELAY_MS.toFixed(0)} ms/key), your keyboard is blocked on the page`);

  const deadline = Date.now() + TEST_DURATION_MS;
  let typedWords = 0;

  try {
    while (Date.now() < deadline) {
      const remaining = await readRemainingText(page).catch(() => '');
      const word = remaining.trimStart().split(/\s+/)[0];
      if (!word) break;

      for (const ch of `${word} `) {
        await pressGuarded(page, ch);
      }
      typedWords += 1;
    }
  } finally {
    await setGuard(page, false).catch(() => {});
  }

  console.log(`Finished, typed ${typedWords} words. Keyboard unblocked; Chrome stays open.`);
  await browser.close();                   // only disconnects; the Chrome window keeps running
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
