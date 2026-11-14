import { expect, type Page, test } from '@playwright/test';

/**
 * End-to-end: the GitHub Pages demo. Everything runs in the browser — PGlite with the real
 * migrations, the real slot engine and services — so this exercises the whole product path.
 */

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('navbat-lang', 'en');
    } catch {
      /* ignore */
    }
  });
});

test.afterEach(() => {
  expect(errors, errors.join('\n')).toEqual([]);
});

async function openApp(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('demo-badge')).toContainText('Demo mode');
  await expect(page.getByTestId('mini-app')).toBeVisible({ timeout: 60_000 });
}

/** Books the first free slot with "any master"; returns the booking code and date. */
async function bookFirstSlot(page: Page, opts: { laterDay?: boolean } = {}) {
  await page.locator('[data-testid^="service-"]').first().click();
  await page.getByTestId('main-button').click();
  await page.getByTestId('master-any').click();
  await expect(page.locator('[data-testid^="slot-"]').first()).toBeVisible();
  if (opts.laterDay) {
    // Not today: the free-cancellation window (2 h) must still be open.
    const enabled = page.locator('.heat-day:not([disabled])');
    if ((await enabled.count()) < 2) await page.getByRole('button', { name: 'Next month' }).click();
    const next = page.locator('.heat-day:not([disabled]):not([aria-pressed="true"])').first();
    const id = await next.getAttribute('data-testid');
    await next.click();
    await expect(page.getByTestId(id!)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.slot-skeleton')).toHaveCount(0);
  }
  const firstSlot = page.locator('[data-testid^="slot-"]').first();
  await expect(firstSlot).toBeVisible();
  const day = await page.locator('.heat-day[aria-pressed="true"]').getAttribute('data-testid');
  const time = (await firstSlot.textContent())!.trim();
  await firstSlot.click();
  await page.locator('input[name="name"]').fill('Playwright Tester');
  await page.locator('input[name="phone"]').fill('90 555 44 33');
  await page.getByTestId('main-button').click();
  // The demo takes a 20% deposit through the sandbox provider.
  await page.getByTestId('sandbox-pay').click();
  const ticket = page.getByTestId('ticket');
  await expect(ticket).toBeVisible();
  await expect(page.getByRole('heading', { name: 'You are booked' })).toBeVisible();
  const code = (await page.getByTestId('ticket-code').textContent())!.trim();
  expect(code).toMatch(/^N-[2-9A-Z]{4}$/);
  return { code, date: day!.replace('day-', ''), time };
}

test('customer books a visit and it appears in the admin calendar', async ({ page }) => {
  await openApp(page);
  const { code, date, time } = await bookFirstSlot(page);

  // The bot chat shows the confirmation rendered by the real message templates.
  if (await page.getByTestId('tab-chat').isVisible()) await page.getByTestId('tab-chat').click();
  const confirmation = page.locator('[data-testid="bot-message"][data-kind="booking_confirmed"]');
  await expect(confirmation).toContainText(code);
  // …and the front desk got a "new booking" alert in their own chat.
  await page.getByRole('combobox', { name: 'Chat' }).selectOption('2001');
  await expect(
    page.locator('[data-testid="bot-message"][data-kind="admin_new_booking"]').last(),
  ).toContainText(code);

  await page.goto(`./#/admin/calendar/${date}`);
  const block = page.locator(`[data-testid="cal-booking"][data-code="${code}"]`);
  await expect(block).toBeVisible();
  await expect(block).toContainText('Playwright Tester');
  await expect(block).toContainText(time);

  await block.click();
  const drawer = page.getByTestId('booking-drawer');
  await expect(drawer).toContainText(code);
  await expect(drawer).toContainText('+998 90 555 44 33');
});

test('admin drags a booking to a new time and the customer is notified', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'drag-and-drop is a desktop interaction');
  await openApp(page);
  const { code, date } = await bookFirstSlot(page);
  await page.goto(`./#/admin/calendar/${date}`);
  const block = page.locator(`[data-testid="cal-booking"][data-code="${code}"]`);
  await expect(block).toBeVisible();
  await block.scrollIntoViewIfNeeded();
  const before = (await block.locator('.cal-bk-time').textContent())!.trim();

  let moved = false;
  // Try a few offsets: some target times may already be taken by seeded bookings.
  for (const minutes of [120, 180, 240, 60, 300]) {
    const box = (await block.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + 8;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 20, { steps: 4 });
    await page.mouse.move(x, y + minutes * 1.15, { steps: 12 });
    await page.mouse.up();
    const toast = page.locator('.toast').last();
    await expect(toast).toBeVisible();
    if ((await toast.textContent())?.includes('Booking moved')) {
      moved = true;
      break;
    }
    await page.waitForTimeout(600);
  }
  expect(moved).toBe(true);
  await expect(block.locator('.cal-bk-time')).not.toHaveText(before);

  await page.getByTestId('nav-customer').click();
  if (await page.getByTestId('tab-chat').isVisible()) await page.getByTestId('tab-chat').click();
  await expect(page.locator('[data-testid="bot-message"][data-kind="booking_rescheduled"]')).toContainText(
    'Booking moved',
  );
});

test('customer cancels a booking and rates a past visit', async ({ page }) => {
  await openApp(page);
  const { code } = await bookFirstSlot(page, { laterDay: true });
  await page.getByTestId('main-button').click(); // "My bookings"
  const rows = page.getByTestId('my-booking');
  await expect(rows.first()).toBeVisible();
  await rows.first().click();
  await expect(page.getByTestId('ticket-code')).toHaveText(code);
  await page.getByTestId('cancel-booking').click();
  await page.getByTestId('confirm-cancel').click();
  await expect(page.locator('.toast').last()).toContainText('Booking cancelled');

  // Back to the list and open the seeded completed visit (N-DEMO) to rate it.
  await page.getByTestId('back-button').click();
  await page.getByTestId('my-booking').filter({ hasText: 'Completed' }).first().click();
  await expect(page.getByTestId('ticket-code')).toHaveText('N-DEMO');
  await page.getByTestId('rate-5').click();
  await page.getByTestId('main-button').click();
  await expect(page.locator('.toast').last()).toContainText('Thanks!');
});

test('roles: a master sees only their own calendar', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('nav-admin').click();
  await expect(page.getByTestId('admin')).toBeVisible();
  await page.getByTestId('role-select').selectOption('master');
  await expect(page.getByTestId('admin-nav-calendar')).toBeVisible();
  await expect(page.getByTestId('admin-nav-analytics')).toHaveCount(0);
  await expect(page.getByTestId('admin-nav-clients')).toHaveCount(0);
  await page.getByTestId('role-select').selectOption('owner');
  await page.getByTestId('admin-nav-analytics').click();
  await expect(page.getByTestId('kpis')).toContainText('Revenue');
  const download = page.waitForEvent('download');
  await page.getByTestId('export-csv').click();
  expect((await download).suggestedFilename()).toMatch(/^navbat-.*\.csv$/);
  await page.getByTestId('admin-nav-clients').click();
  await expect(page.getByTestId('clients-table')).toContainText('Akmal Demo');
});
