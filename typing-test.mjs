import { chromium } from 'playwright';

const URL = 'https://10fastfingers.com/typing-test/english';
const WPM = Number(process.env.WPM ?? 400);      // 1 word = 5 keystrokes
const KEY_DELAY_MS = 60000 / (WPM * 5);
const TEST_DURATION_MS = 62_000;                  // 1-minute test plus a little slack
const PROFILE_DIR = './.browser-profile';          // keeps your login between runs

const WORDS = '[data-testid="word-box-words"]';
const INPUT = '[data-testid="Typing-box-input"]';

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

const main = async () => {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
  });
  const page = context.pages()[0] ?? (await context.newPage());

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await dismissCookieBanner(page);

  await page.waitForSelector(WORDS);
  await page.click(WORDS);                 // focuses the hidden textarea
  await page.focus(INPUT).catch(() => {});

  console.log(`Typing at ~${WPM} WPM (${KEY_DELAY_MS.toFixed(0)} ms/key)`);
  const deadline = Date.now() + TEST_DURATION_MS;
  let typedWords = 0;

  while (Date.now() < deadline) {
    const remaining = await readRemainingText(page).catch(() => '');
    const word = remaining.trimStart().split(/\s+/)[0];
    if (!word) break;

    await page.keyboard.type(`${word} `, { delay: KEY_DELAY_MS });
    typedWords += 1;
  }

  console.log(`Finished, typed ${typedWords} words. Browser stays open to show the result; press Ctrl+C to quit.`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
