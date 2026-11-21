/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
import { issueFreshCard } from './helpers';

type Target = { text: string } | { answerControl: true };

/** Presses Tab until the focused element is the named button/link, or the first answer control. */
async function tabTo(page: Page, target: Target, max = 40) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate((t) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      if ('text' in t)
        return (
          (el.tagName === 'BUTTON' || el.tagName === 'A') &&
          (el.textContent ?? '').trim() === t.text
        );
      if (el.tagName === 'INPUT') return true;
      const name = el.getAttribute('aria-label') ?? el.textContent ?? '';
      return (
        el.tagName === 'BUTTON' &&
        /^(Move|This order)/.test(name) &&
        !(el as HTMLButtonElement).disabled
      );
    }, target);
    if (hit) return;
  }
  throw new Error(`Could not reach ${JSON.stringify(target)} with the Tab key`);
}

test('(f) keyboard-only pass through the student flow', async ({ page, baseURL, isMobile }) => {
  test.skip(isMobile, 'desktop project');
  const card = await issueFreshCard(baseURL!);

  await page.goto('/s');
  // The code field is focused on arrival: type and press Enter.
  await expect(page.getByLabel('Access code')).toBeFocused();
  await page.keyboard.type(card.accessCode.toLowerCase());
  await page.keyboard.press('Enter');
  await page.waitForURL('**/s/home');
  // Wait for the list to load so Tab has something to land on.
  await expect(page.getByRole('link', { name: 'Start', exact: true })).toBeVisible();

  await tabTo(page, { text: 'Start' });
  await page.keyboard.press('Enter');
  await page.waitForURL('**/s/assess/**');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();

  await tabTo(page, { text: 'Start' });
  await page.keyboard.press('Enter');

  const position = page.getByTestId('question-position');
  await expect(position).toContainText('Question 1 of');
  const total = Number(/of (\d+)/.exec((await position.textContent()) ?? '')?.[1]);

  for (let i = 1; i <= total; i++) {
    await expect(position).toContainText(`Question ${i} of ${total}`);
    // Focus lands on the question heading; every focused element must show a focus ring target.
    await expect(page.locator('main h1')).toBeFocused();
    await tabTo(page, { answerControl: true });
    const kind = await page.evaluate(() => {
      const el = document.activeElement as HTMLInputElement;
      return el.tagName === 'BUTTON' ? 'button' : el.type;
    });
    if (kind === 'radio' || kind === 'checkbox') await page.keyboard.press('Space');
    else if (kind === 'button') await page.keyboard.press('Enter');
    else await page.keyboard.type('4');
    await expect(page.getByTestId('answered-count')).toContainText(`${i} of ${total} answered`);

    await tabTo(page, { text: i === total ? 'Review' : 'Next' });
    await page.keyboard.press('Enter');
  }

  await expect(page.getByRole('heading', { name: 'Check your answers' })).toBeFocused();
  await tabTo(page, { text: 'Turn in my answers' });
  await page.keyboard.press('Enter');

  // Dialog: focus is trapped inside; Esc closes and returns focus to the opener.
  const dialog = page.getByRole('dialog', { name: 'Turn in your answers?' });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(
    true,
  );
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(
      true,
    );
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Turn in my answers' })).toBeFocused();

  await page.keyboard.press('Enter');
  await tabTo(page, { text: 'Yes, turn it in' });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('done-screen')).toBeVisible();

  await tabTo(page, { text: 'I’m finished — sign out' });
  await page.keyboard.press('Enter');
  await page.waitForURL('**/s');
});
