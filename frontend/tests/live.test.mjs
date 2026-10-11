import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { chromium } from 'playwright';

const baseUrl = process.env.TEST_URL || 'http://127.0.0.1:5173';

test('live registration, login, events, zones, and saved data work together', async t => {
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200, 'Start the API and frontend before running live tests.');
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const email = `qa-${randomUUID()}@college.edu`;
  const password = 'test-password-123';

  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Full name').fill('QA Test');
  await page.getByLabel('Work or institution email').fill(email);
  await page.getByLabel('Password', { exact: false }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  await page.getByText('100%', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Form input', exact: false }).click();
  await page.getByText('96%', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add protect zone' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('QA Interview');
  await dialog.getByLabel('Start date and time').fill('2099-01-01T10:00');
  await dialog.getByLabel('End date and time').fill('2099-01-01T11:00');
  await dialog.getByRole('button', { name: 'Save zone' }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByText('QA Interview', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Remove QA Interview', exact: true }).click();
  await page.getByText('No zones scheduled.', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Daily summary', exact: true }).click();
  await page.getByText('4 points used', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByLabel('Work or institution email').fill(email);
  await page.getByLabel('Password', { exact: false }).fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /Email or password/);
  await page.getByLabel('Password', { exact: false }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByText('96%', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('96%', { exact: true }).waitFor();

  const offPaletteElements = await page.evaluate(() => [...document.querySelectorAll('*')].flatMap(element => {
    const style = getComputedStyle(element);
    return ['color', 'backgroundColor', 'borderTopColor', 'outlineColor'].flatMap(property => {
      const value = style[property];
      const rgb = value.match(/^rgba?\((\d+), (\d+), (\d+)/);
      return rgb && (Number(rgb[1]) < Number(rgb[2]) || Number(rgb[2]) < Number(rgb[3])) ? [`${element.tagName}: ${property} ${value}`] : [];
    });
  }));
  assert.deepEqual(offPaletteElements, [], 'The UI must use neutral surfaces and peach text.');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgb(34, 34, 34)');
  assert.match(await page.locator('.app-header .brand').evaluate(element => getComputedStyle(element).backgroundImage), /linear-gradient/, 'AEGIS branding uses a shaded peach finish.');
  assert.deepEqual(errors, [], 'No uncaught browser errors.');
  await page.getByRole('button', { name: 'Sign out' }).click();
});
