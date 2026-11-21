/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import {
  PRESENTER,
  completeAssessment,
  issueFreshCard,
  signInByTyping,
  trackConsoleErrors,
} from './helpers';

test.describe('student flow', () => {
  test('(a) presenter code → assessment → answer all → submit → done', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, 'desktop project');
    const errors = trackConsoleErrors(page);

    await signInByTyping(page, PRESENTER.freshPre);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Hi, S-');
    // The student sees a public code, never a UUID.
    await expect(page.locator('main')).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);

    // On a long-running dev server the presenter may already have submitted; then use a fresh card.
    let start = page.getByRole('link', { name: /^(Start|Keep going)$/ }).first();
    if ((await start.count()) === 0) {
      const card = await issueFreshCard(baseURL!);
      await page.getByRole('button', { name: 'Sign out' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Sign out' }).click();
      await signInByTyping(page, card.accessCode);
      start = page.getByRole('link', { name: /^(Start|Keep going)$/ }).first();
    }
    await start.click();
    await page.waitForURL('**/s/assess/**');

    const total = await completeAssessment(page);
    await expect(page.getByTestId('done-screen')).toContainText(
      `You answered ${total} of ${total} questions`,
    );
    // No score reveal on the completion screen.
    await expect(page.getByTestId('done-screen')).not.toContainText(/\d+\s?%/);

    await page.getByRole('link', { name: 'Back to my check-ins' }).click();
    await expect(page.getByText('All turned in. Nice work!').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('QR fragment signs in, is removed from the URL, and a draft survives a refresh', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, 'desktop project');
    const card = await issueFreshCard(baseURL!);
    await page.goto(card.accessUrl.replace(/^https?:\/\/[^/]+/, ''));
    await page.waitForURL('**/s/home');
    expect(page.url()).not.toContain('#');
    expect(page.url()).not.toContain(card.accessCode);
    const stored = await page.evaluate(
      () => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }),
    );
    expect(stored).not.toContain(card.accessCode);

    await page.getByRole('link', { name: 'Start', exact: true }).first().click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByTestId('question-position')).toContainText('Question 1 of');
    await page
      .locator('main label.option, main label.codeblock-line, main label.likert-cell')
      .first()
      .click();
    await expect(page.getByTestId('answered-count')).toContainText('1 of');

    page.once('dialog', (d) => void d.accept()); // beforeunload confirmation
    await page.reload();
    await expect(page.getByText('Welcome back')).toBeVisible();
    await expect(page.getByTestId('answered-count')).toContainText('1 of');
    // Only answers are stored — never the access code.
    const draft = await page.evaluate(() => JSON.stringify({ ...sessionStorage }));
    expect(draft).toContain('cic:draft:');
    expect(draft).not.toContain(card.accessCode);
  });

  test('bad codes get one friendly message', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop project');
    await page.goto('/s');
    await page.getByLabel('Access code').fill('ZZZZ-ZZZZ-ZZZZ-ZZZZ');
    await page.getByRole('button', { name: 'Let’s go' }).click();
    await expect(page.getByRole('alert')).toContainText('That code didn’t work');
  });

  test('a join link sends the student to the code screen and back to the assessment', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, 'desktop project');
    const card = await issueFreshCard(baseURL!);
    await page.goto(`/s/assess/${card.sessionId}`);
    await page.waitForURL('**/s');
    await page.getByLabel('Access code').fill(card.accessCode);
    await page.getByRole('button', { name: 'Let’s go' }).click();
    await page.waitForURL(`**/s/assess/${card.sessionId}`);
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  });

  test('(b) mobile viewport: full flow with touch-sized controls and no sideways scroll', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(!isMobile, 'mobile project');
    await signInByTyping(page, PRESENTER.readyForPost);
    let start = page.getByRole('link', { name: /^(Start|Keep going)$/ }).first();
    if ((await start.count()) === 0) {
      const card = await issueFreshCard(baseURL!);
      await page.getByRole('button', { name: 'Sign out' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Sign out' }).click();
      await signInByTyping(page, card.accessCode);
      start = page.getByRole('link', { name: /^(Start|Keep going)$/ }).first();
    }
    const noSidewaysScroll = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(await noSidewaysScroll()).toBe(true);

    const box = await start.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await start.click();
    await page.waitForURL('**/s/assess/**');
    expect(await noSidewaysScroll()).toBe(true);

    await completeAssessment(page);
    expect(await noSidewaysScroll()).toBe(true);
    await page.getByRole('button', { name: 'I’m finished — sign out' }).click();
    await page.waitForURL('**/s');
    await expect(page.getByLabel('Access code')).toBeVisible();
  });

  test('student pages fit a 360px-wide phone', async ({ page, baseURL, isMobile }) => {
    test.skip(!isMobile, 'mobile project');
    await page.setViewportSize({ width: 360, height: 740 });
    const card = await issueFreshCard(baseURL!);
    await signInByTyping(page, card.accessCode);
    const fits = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(await fits()).toBe(true);
    await page.getByRole('link', { name: 'Start', exact: true }).first().click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    const position = page.getByTestId('question-position');
    await expect(position).toContainText('Question 1 of');
    const total = Number(/of (\d+)/.exec((await position.textContent()) ?? '')?.[1]);
    for (let i = 1; i <= total; i++) {
      await expect(position).toContainText(`Question ${i} of`);
      expect(await fits(), `question ${i} fits 360px`).toBe(true);
      await page
        .getByRole('button', { name: i === total ? 'Review' : 'Next', exact: true })
        .click();
    }
    await expect(page.getByText(`${total} questions aren’t answered yet`)).toBeVisible();
    expect(await fits()).toBe(true);
  });
});
