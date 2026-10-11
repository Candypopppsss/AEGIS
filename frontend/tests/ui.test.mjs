import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { chromium } from 'playwright';

const baseUrl = process.env.TEST_URL || 'http://127.0.0.1:5173';
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

function dashboard(fullName = 'Test User') {
  return {
    user: { fullName, email: 'test@college.edu', timezone: 'Asia/Kolkata' },
    date: '2026-10-11', capacity: 100, events: [], zones: [], heldCount: 0,
    summary: { NOTIFICATION: 0, APP_SWITCH: 0, MESSAGE_REPLY: 0, FORM_INPUT: 0 },
  };
}

async function open(t, { authenticated = true, handler, viewport } = {}) {
  const context = await browser.newContext({ viewport: viewport || { width: 1280, height: 800 } });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'Uncaught browser errors'));
  if (authenticated) {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('test-initialized')) {
        sessionStorage.setItem('jf-token', 'test-token');
        sessionStorage.setItem('test-initialized', 'true');
      }
    });
  }
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (handler && await handler(route, path)) return;
    await route.fulfill({ json: path.startsWith('/api/auth/') ? { token: 'new-token' } : dashboard() });
  });
  await page.goto(baseUrl);
  if (!authenticated) await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: authenticated ? 'Overview' : 'Sign in', exact: true }).waitFor();
  return page;
}

async function login(page) {
  await page.getByLabel('Work or institution email').fill('test@college.edu');
  await page.getByLabel('Password', { exact: false }).fill('test-password-123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

// These exercise the browser with controlled API responses, not the Spring backend.
test('registration submits the correct fields and opens the dashboard', async t => {
  let submitted;
  const page = await open(t, { authenticated: false, handler: async (route, path) => {
    if (path !== '/api/auth/register') return false;
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: { token: 'registered-token' } });
    return true;
  }});
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Full name').fill('Test User');
  await page.getByLabel('Work or institution email').fill('test@college.edu');
  await page.getByLabel('Password', { exact: false }).fill('test-password-123');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  assert.equal(submitted.fullName, 'Test User');
  assert.equal(submitted.email, 'test@college.edu');
  assert.ok(submitted.timezone);
});

test('incorrect credentials display an error without leaving the form', async t => {
  const page = await open(t, { authenticated: false, handler: async (route, path) => {
    if (path !== '/api/auth/login') return false;
    await route.fulfill({ status: 401, json: { message: 'Email or password is incorrect.' } });
    return true;
  }});
  await login(page);
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /Email or password/);
  assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).isEnabled(), true);
});

test('a logged event updates the displayed battery and feed', async t => {
  const page = await open(t, { handler: async (route, path) => {
    if (path !== '/api/events') return false;
    assert.deepEqual(route.request().postDataJSON(), { eventType: 'FORM_INPUT' });
    const result = dashboard();
    result.capacity = 96;
    result.events = [{ id: 1, eventType: 'FORM_INPUT', chargedWeight: 4, occurredAt: new Date().toISOString(), status: 'APPLIED' }];
    await route.fulfill({ json: result });
    return true;
  }});
  await page.getByRole('button', { name: 'Form input', exact: false }).click();
  await page.getByText('96%', { exact: true }).waitFor();
  assert.equal(await page.locator('.event-feed li').count(), 1);
});

test('zone errors remain visible in the dialog and Escape restores focus', async t => {
  const page = await open(t, { handler: async (route, path) => {
    if (path !== '/api/zones') return false;
    await route.fulfill({ status: 409, json: { message: 'Leave at least 15 minutes between zones.' } });
    return true;
  }});
  const trigger = page.getByRole('button', { name: 'Add protect zone' });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('Interview');
  await dialog.getByLabel('Start date and time').fill('2099-01-01T10:00');
  await dialog.getByLabel('End date and time').fill('2099-01-01T11:00');
  await dialog.getByRole('button', { name: 'Save zone' }).click();
  await dialog.getByRole('alert').waitFor();
  assert.match(await dialog.getByRole('alert').innerText(), /15 minutes/);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
});

test('expired sessions explain why the user was signed out', async t => {
  let expired = false;
  const page = await open(t, { handler: async (route, path) => {
    if (!expired || path !== '/api/events') return false;
    await route.fulfill({ status: 401, body: '' });
    return true;
  }});
  expired = true;
  await page.getByRole('button', { name: 'Notification', exact: false }).click();
  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
  await page.getByText('Your session expired. Please sign in again.', { exact: true }).waitFor({ timeout: 3000 });
});

test('network failures use a readable error and allow another attempt', async t => {
  const page = await open(t, { authenticated: false, handler: async (route, path) => {
    if (path !== '/api/auth/login') return false;
    await route.abort('connectionfailed');
    return true;
  }});
  await login(page);
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /Cannot reach the server/);
  assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).isEnabled(), true);
});

for (const status of [200, 401]) test(`a late ${status} response cannot affect the next account`, async t => {
  let release;
  let eventStarted;
  const started = new Promise(resolve => { eventStarted = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const page = await open(t, { handler: async (route, path) => {
    if (path === '/api/dashboard' && route.request().headers().authorization === 'Bearer new-token') {
      await route.fulfill({ json: dashboard('Second User') });
      return true;
    }
    if (path !== '/api/events') return false;
    eventStarted();
    await pending;
    await route.fulfill(status === 200 ? { json: dashboard('Old User') } : { status: 401, body: '' });
    return true;
  }});
  await page.getByRole('button', { name: 'Notification', exact: false }).click();
  await started;
  await page.getByRole('button', { name: 'Sign out' }).click();
  await login(page);
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  await page.getByText('Second User', { exact: true }).waitFor();
  release();
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole('heading', { name: 'Overview', exact: true }).count(), 1);
  assert.equal(await page.getByText('Second User', { exact: true }).count(), 1);
});

test('mobile layout handles long names and treats markup as plain text', async t => {
  const title = '<img src=x onerror="alert(1)">' + 'A'.repeat(70);
  const page = await open(t, { viewport: { width: 360, height: 800 }, handler: async (route, path) => {
    if (path !== '/api/dashboard') return false;
    const result = dashboard('A'.repeat(100));
    result.zones = [{ id: 1, title, startsAt: '2099-01-01T10:00:00Z', endsAt: '2099-01-01T11:00:00Z' }];
    await route.fulfill({ json: result });
    return true;
  }});
  assert.equal(await page.getByText(title, { exact: true }).count(), 1);
  assert.equal(await page.locator('main img').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('valid zones submit ISO times and close the dialog after saving', async t => {
  const page = await open(t, { handler: async (route, path) => {
    if (path !== '/api/zones') return false;
    const body = route.request().postDataJSON();
    assert.equal(body.title, 'Interview');
    assert.ok(Date.parse(body.endsAt) > Date.parse(body.startsAt));
    assert.ok(body.startsAt.endsWith('Z'));
    const result = dashboard();
    result.zones = [{ id: 1, ...body }];
    await route.fulfill({ json: result });
    return true;
  }});
  await page.getByRole('button', { name: 'Add protect zone' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('Interview');
  await dialog.getByLabel('Start date and time').fill('2099-01-01T10:00');
  await dialog.getByLabel('End date and time').fill('2099-01-01T11:00');
  await dialog.getByRole('button', { name: 'Save zone' }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByText('Interview', { exact: true }).waitFor();
});

test('invalid time windows stay in the form without sending a request', async t => {
  let sent = false;
  const page = await open(t, { handler: async (route, path) => {
    if (path !== '/api/zones') return false;
    sent = true;
    await route.fulfill({ json: dashboard() });
    return true;
  }});
  await page.getByRole('button', { name: 'Add protect zone' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('Interview');
  await dialog.getByLabel('Start date and time').fill('2099-01-01T11:00');
  await dialog.getByLabel('End date and time').fill('2099-01-01T10:00');
  await dialog.getByRole('button', { name: 'Save zone' }).click();
  await dialog.getByRole('alert').waitFor();
  assert.equal(sent, false);
});

test('mobile pages have no horizontal overflow and keep navigation available', async t => {
  const page = await open(t, { viewport: { width: 360, height: 800 } });
  for (const name of ['Overview', 'Protect zones', 'Daily summary']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('heading', { name, exact: true, level: 1 }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
});
