/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { authFile, createScratchSession, demoLogin, trackConsoleErrors } from './helpers';

test.describe('staff', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'desktop project');
  });

  test('(c) demo instructor → session progress visible → close and reopen', async ({
    page,
    baseURL,
  }) => {
    const errors = trackConsoleErrors(page);
    const scratch = await createScratchSession(baseURL!);
    await demoLogin(page, 'Instructor');

    await expect(page.getByRole('heading', { name: 'Sessions & cohorts' })).toBeVisible();
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    // Instructors don't get admin navigation.
    await expect(
      page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('link', { name: 'Impact dashboard' }),
    ).toHaveCount(0);

    // Live progress on a real open session from the demo data.
    const table = page.getByRole('table', { name: 'Recent assessment sessions' });
    await table
      .getByRole('row')
      .filter({ hasText: 'Open' })
      .filter({ hasNotText: 'E2E practice' })
      .first()
      .getByRole('link')
      .click();
    await expect(page.getByRole('heading', { name: 'Live progress' })).toBeVisible();
    const stats = page.getByTestId('session-stats');
    await expect(stats.getByText('Enrolled', { exact: true })).toBeVisible();
    await expect(stats.getByText('Submitted', { exact: true })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Completion rate' })).toBeVisible();
    await expect(
      page
        .getByRole('table', { name: /Roster status/ })
        .getByRole('row')
        .nth(1),
    ).toBeVisible();
    await expect(page.getByLabel('Join link')).toHaveValue(/\/s\/assess\//);

    // Open/close on a scratch practice session (so students in other tests are never interrupted).
    await page.goto(`/instructor/sessions/${scratch.id}`);
    await expect(page.getByRole('heading', { name: scratch.title })).toBeVisible();
    await page.getByRole('button', { name: 'Close session' }).click();
    await page
      .getByRole('dialog', { name: 'Close this session?' })
      .getByRole('button', { name: 'Close session' })
      .click();
    await expect(page.getByRole('button', { name: 'Reopen session' })).toBeVisible();
    await expect(page.locator('header').getByText('Closed')).toBeVisible();

    await page.getByRole('button', { name: 'Reopen session' }).click();
    await page
      .getByRole('dialog', { name: 'Open this session?' })
      .getByRole('button', { name: 'Open session' })
      .click();
    await expect(page.getByRole('button', { name: 'Close session' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Live progress' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('instructor generates access cards with QR codes; codes vanish on refresh', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: authFile('instructor') });
    const page = await context.newPage();
    await page.goto('/instructor');
    await page
      .locator('a[href^="/instructor/cohorts/"]')
      .filter({ hasText: 'Fall 2026: CS Fundamentals' })
      .click();
    await page.getByRole('button', { name: 'Generate access cards' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Generate access cards' });
    await expect(dialog.getByRole('radio', { name: 'Under 13' })).toBeDisabled();
    await dialog.getByLabel('How many cards?').fill('2');
    await dialog.getByRole('button', { name: /Generate 2 cards/ }).click();
    await page.waitForURL('**/instructor/cards');
    await expect(page.getByTestId('access-card')).toHaveCount(2);
    await expect(page.getByTestId('card-code').first()).toHaveText(
      /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/,
    );
    await expect(page.getByRole('img', { name: /QR code for seat/ }).first()).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'can’t be shown again' })).toBeVisible();

    page.once('dialog', (d) => void d.accept());
    await page.reload();
    await expect(page.getByRole('heading', { name: 'No cards to print' })).toBeVisible();
    await context.close();
  });

  test('(d) demo admin → KPIs show n, filters update values, AI summary falls back, CSV downloads', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page);
    await demoLogin(page, 'Administrator');

    const gains = page.getByTestId('kpi-gains');
    await expect(gains).toBeVisible();
    const matched = page.getByTestId('matched-n');
    await expect(matched).toHaveText(/n = \d+ matched students?/);
    // Every pre/post tile carries its matched n.
    expect(await gains.getByTestId('stat-n').count()).toBeGreaterThanOrEqual(7);
    await expect(gains.getByTestId('stat-n').first()).toHaveText(/n = \d+ matched/);
    // Percentage points vs percent.
    const change = gains.getByTestId('stat-tile').filter({ hasText: 'Average change' });
    await expect(change.getByTestId('stat-unit')).toHaveText('pts');
    const improved = gains.getByTestId('stat-tile').filter({ hasText: 'Improved' });
    await expect(improved.getByTestId('stat-unit')).toHaveText('%');
    await expect(page.getByTestId('limitations')).toBeVisible();
    await expect(page.getByTestId('confidence-panel')).toContainText('Not a skill measure');
    await expect(page.getByTestId('context-bar')).toContainText('Synthetic demo data');

    // Filters: program, then cohort. Values update together and the URL is shareable.
    const allN = await matched.textContent();
    const enrolledTile = page
      .getByTestId('kpi-participation')
      .getByTestId('stat-tile')
      .filter({ hasText: /^Enrolled/ })
      .getByTestId('stat-value');
    const allEnrolled = await enrolledTile.textContent();
    await page.getByLabel('Program', { exact: true }).selectOption({ index: 1 });
    await expect(page).toHaveURL(/programId=/);
    await expect(matched).not.toHaveText(allN!);
    await expect(enrolledTile).not.toHaveText(allEnrolled!);
    const programN = await matched.textContent();

    await page.getByLabel('Cohort', { exact: true }).selectOption({ index: 1 });
    await expect(page).toHaveURL(/cohortId=/);
    await expect(matched).not.toHaveText(programN!);
    await expect(
      page.getByRole('table', { name: /Cohort comparison/ }).getByRole('row'),
    ).toHaveCount(2);

    // Shareable: reloading the URL restores the filtered view.
    const cohortN = await matched.textContent();
    await page.reload();
    await expect(page.getByTestId('matched-n')).toHaveText(cohortN!);

    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(page).not.toHaveURL(/programId=/);
    await expect(matched).toHaveText(allN!);

    // Chart has an accessible data-table alternative.
    const skillCard = page.getByRole('region', { name: 'Baseline vs. final by skill' });
    await skillCard.getByRole('button', { name: 'View as table' }).click();
    await expect(skillCard.getByRole('table')).toContainText('Matched (n)');

    // CSV export downloads.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Impact CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const [skills] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Skills CSV' }).click(),
    ]);
    expect(skills.suggestedFilename()).toMatch(/\.csv$/);

    // AI reporting lives on its own page; the overview links to it and carries the filters along.
    await page.getByLabel('Program', { exact: true }).selectOption({ index: 1 });
    await expect(page).toHaveURL(/programId=/);
    await page.getByRole('link', { name: 'Draft a report from these filters' }).click();
    await expect(page).toHaveURL(/\/admin\/reports\?.*programId=/);
    await expect(page.getByRole('heading', { name: 'AI reporting', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Verified source metrics' })).toBeVisible();
    // Workers AI is not available in local dev, so the template fallback is expected.
    await page.getByRole('button', { name: 'Generate AI Impact Summary' }).click();
    const report = page.getByTestId('ai-report');
    await expect(report).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('generation-mode')).toContainText('Template narrative (no AI)');
    await expect(report.getByRole('heading', { name: 'Limitations' })).toBeVisible();
    await report.getByText('Show data sent to AI').click();
    await expect(report.locator('pre')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Regenerate' })).toBeVisible();
    await page.getByRole('button', { name: 'Save report' }).click();
    await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test('printable report uses the suppressed external view', async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile('admin') });
    const page = await context.newPage();
    await page.goto('/admin');
    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/admin/dashboard') && r.url().includes('view=external'),
      ),
      page.getByRole('link', { name: 'Printable report' }).click(),
    ]);
    expect(res.ok()).toBeTruthy();
    const report = page.getByTestId('print-report');
    await expect(report).toBeVisible();
    await expect(report).toContainText('matched');
    await expect(report.getByRole('heading', { name: 'Limitations' })).toBeVisible();
    await expect(page.getByTestId('suppression-footnote')).toContainText('fewer than');
    await expect(page.getByRole('button', { name: 'Print / Save as PDF' })).toBeEnabled();
    await context.close();
  });

  test('(e) analyst has no Students nav and gets the 403 page on /admin/students', async ({
    page,
  }) => {
    await demoLogin(page, 'Analyst');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Impact dashboard' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Students' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Staff' })).toHaveCount(0);

    await page.goto('/admin/students');
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'This page isn’t part of your role' }),
    ).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('admin can open a pseudonymous student history', async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile('admin') });
    const page = await context.newPage();
    await page.goto('/admin');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Students' })
      .click();
    const table = page.getByRole('table', { name: 'Student records' });
    await table.getByRole('link').first().click();
    await expect(page.getByText('Pseudonymous student record')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Access card' })).toBeVisible();
    // Strong confirmation: delete stays disabled until the public code is typed.
    await page.getByRole('button', { name: 'Delete data' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await context.close();
  });
});
