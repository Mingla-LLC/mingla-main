// ORCH-1216 tester — Playwright drive of the explorer "Get the app" modal.
// Asserts the TestFlight hard-gate (contract 1) + platform branch (contract 2)
// in EVERY state. Intercepts the submit transport so success/error branches run
// without a deployed backend. Captures screenshots into the evidence dir.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:3216';
const EVID = process.env.EVID ||
  '/Users/sethogieva/Desktop/mingla-orchs/1216-explorer-app-lead-capture/Mingla_Artifacts/evidence/ORCH-1216';
fs.mkdirSync(EVID, { recursive: true });

const TESTFLIGHT = 'testflight.apple.com/join/1gvHNqkQ';
const ANDROID_MSG = 'only available for beta testing on iOS right now';

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

// Does the live DOM contain the TestFlight URL anywhere (href or text)?
async function testflightVisible(page) {
  return page.evaluate((tf) => {
    const html = document.documentElement.outerHTML;
    const inHtml = html.includes(tf);
    const anchor = !!document.querySelector(`a[href*="${tf}"]`);
    const label = Array.from(document.querySelectorAll('a,button'))
      .some((el) => /Open in TestFlight/i.test(el.textContent || ''));
    return { inHtml, anchor, label };
  }, TESTFLIGHT);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(EVID, name), fullPage: false });
}

function appDialog(page) {
  // The lead-capture modal uses aria-modal="true"; the cookie banner uses "false".
  return page.locator('div[role="dialog"][aria-modal="true"]');
}

async function dismissCookie(page) {
  // Cookie consent dialog can overlap; accept/dismiss it if present.
  const cookie = page.locator('div[role="dialog"][aria-label="Cookie consent"]');
  if (await cookie.count()) {
    const accept = cookie.getByRole('button').first();
    if (await accept.count()) { try { await accept.click({ timeout: 1500 }); } catch {} }
  }
}

async function openModal(page) {
  await dismissCookie(page);
  const btn = page.getByRole('button', { name: 'Get the app', exact: true }).first();
  await btn.waitFor({ state: 'visible', timeout: 10000 });
  await btn.click();
  await appDialog(page).waitFor({ state: 'visible', timeout: 5000 });
}

async function fillStep1(page) {
  const d = appDialog(page);
  const chip = d.getByRole('radio', { name: 'Events' });
  await chip.waitFor({ state: 'visible' });
  await chip.focus();
  await page.keyboard.press('Enter'); // keyboard select → no auto-advance
}

async function fillStep2(page) {
  const d = appDialog(page);
  await d.getByLabel('Your name').fill('Ada Test');
  await d.getByLabel('Email', { exact: true }).fill('ADA.Test+1216@Example.COM');
  await d.getByLabel('City', { exact: true }).fill('Lagos');
  await d.getByRole('checkbox').check();
}

// Mock the edge-fn POST. mode: 'created' | 'already' | 'server' | 'rate' | 'validation' | 'network'
async function mockSubmit(page, mode) {
  await page.route('**/explorer-app-lead-submit', async (route) => {
    if (mode === 'network') return route.abort('failed');
    const map = {
      created: [200, { ok: true, status: 'created' }],
      already: [200, { ok: true, status: 'already_on_list' }],
      server: [500, { ok: false, error: 'server' }],
      rate: [429, { ok: false, error: 'rate_limited' }],
      validation: [400, { ok: false, error: 'validation' }],
    };
    const [status, body] = map[mode];
    return route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

async function newCtx(browser, ua) {
  const ctx = await browser.newContext({
    userAgent: ua,
    viewport: { width: 430, height: 900 },
  });
  return ctx;
}

async function scenario(browser, { label, ua, mode, expectLink, screenshotPrefix, overridePlatform }) {
  const ctx = await newCtx(browser, ua);
  const page = await ctx.newPage();
  // optionally override navigator.platform + maxTouchPoints (iPadOS / touch Mac edge)
  if (overridePlatform) {
    await ctx.addInitScript(({ platform, maxTouchPoints }) => {
      Object.defineProperty(navigator, 'platform', { get: () => platform });
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => maxTouchPoints });
    }, overridePlatform);
  }
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // STATE: idle (modal not open) — TestFlight must be absent.
  let tf = await testflightVisible(page);
  record(`${label}: idle (modal closed) — no TestFlight`, !tf.inHtml && !tf.anchor && !tf.label, JSON.stringify(tf));

  await openModal(page);

  // STATE: step 1 — absent.
  tf = await testflightVisible(page);
  record(`${label}: step1 open — no TestFlight`, !tf.inHtml && !tf.anchor && !tf.label, JSON.stringify(tf));
  if (screenshotPrefix) await shot(page, `${screenshotPrefix}-step1.png`);

  await fillStep1(page);
  const d = appDialog(page);
  // advance via Next
  await d.getByRole('button', { name: 'Next' }).click();
  await d.getByLabel('Your name').waitFor({ state: 'visible' });

  // STATE: step 2 — absent.
  tf = await testflightVisible(page);
  record(`${label}: step2 open — no TestFlight`, !tf.inHtml && !tf.anchor && !tf.label, JSON.stringify(tf));
  if (screenshotPrefix) await shot(page, `${screenshotPrefix}-step2.png`);

  await fillStep2(page);
  await mockSubmit(page, mode);
  await d.getByRole('button', { name: 'Get the app' }).click();

  // settle
  await page.waitForTimeout(700);
  tf = await testflightVisible(page);

  if (expectLink) {
    record(`${label}: success(${mode}) — TestFlight link PRESENT`, tf.anchor && tf.label, JSON.stringify(tf));
    // verify exact href
    const href = await page.evaluate(() => {
      const a = document.querySelector('a[href*="testflight.apple.com"]');
      return a ? a.getAttribute('href') : null;
    });
    record(`${label}: success(${mode}) — exact TestFlight href`,
      href === 'https://testflight.apple.com/join/1gvHNqkQ', String(href));
  } else if (mode === 'created' || mode === 'already') {
    // success but non-iOS: link absent, Seth message present
    const msg = await page.evaluate((m) => document.body.innerText.includes(m), ANDROID_MSG);
    record(`${label}: success(${mode}) — NO TestFlight link`, !tf.inHtml && !tf.anchor && !tf.label, JSON.stringify(tf));
    record(`${label}: success(${mode}) — Seth Android message present`, msg, '');
  } else {
    // error path: no success, no link, modal still open, error banner present
    const hasErr = await appDialog(page).locator('[role="alert"]').count();
    const stillStep2 = await appDialog(page).getByLabel('Your name').count();
    record(`${label}: error(${mode}) — NO TestFlight link`, !tf.inHtml && !tf.anchor && !tf.label, JSON.stringify(tf));
    record(`${label}: error(${mode}) — error banner shown + form preserved`, hasErr > 0 && stillStep2 > 0, `alerts=${hasErr} nameField=${stillStep2}`);
  }
  if (screenshotPrefix) await shot(page, `${screenshotPrefix}-final.png`);

  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();

  // 1. iOS happy → link present
  await scenario(browser, { label: 'iOS', ua: IOS_UA, mode: 'created', expectLink: true, screenshotPrefix: 'ios-created' });
  // 2. Android happy → no link, Seth message
  await scenario(browser, { label: 'Android', ua: ANDROID_UA, mode: 'created', expectLink: false, screenshotPrefix: 'android-created' });
  // 3. Desktop (non-touch Mac) happy → no link
  await scenario(browser, { label: 'DesktopMac', ua: DESKTOP_UA, mode: 'created', expectLink: false, overridePlatform: { platform: 'MacIntel', maxTouchPoints: 0 }, screenshotPrefix: 'desktop-created' });
  // 4. iPadOS-13 desktop-UA edge: MacIntel + touch → should resolve iOS → link present
  await scenario(browser, { label: 'iPadOS13-MacIntel-touch', ua: DESKTOP_UA, mode: 'created', expectLink: true, overridePlatform: { platform: 'MacIntel', maxTouchPoints: 5 }, screenshotPrefix: 'ipados-created' });
  // 5. iOS server error → NO link
  await scenario(browser, { label: 'iOS', ua: IOS_UA, mode: 'server', expectLink: false, screenshotPrefix: 'ios-server-err' });
  // 6. iOS network error → NO link
  await scenario(browser, { label: 'iOS', ua: IOS_UA, mode: 'network', expectLink: false, screenshotPrefix: 'ios-network-err' });
  // 7. iOS rate-limited → NO link
  await scenario(browser, { label: 'iOS', ua: IOS_UA, mode: 'rate', expectLink: false });
  // 8. iOS validation error → NO link
  await scenario(browser, { label: 'iOS', ua: IOS_UA, mode: 'validation', expectLink: false });
  // 9. iOS idempotent already_on_list → still link present
  await scenario(browser, { label: 'iOS', ua: IOS_UA, mode: 'already', expectLink: true });
  // 10. Android server error → NO link
  await scenario(browser, { label: 'Android', ua: ANDROID_UA, mode: 'server', expectLink: false });

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== SUMMARY: ${results.length - failed.length}/${results.length} PASS =====`);
  if (failed.length) {
    console.log('FAILURES:');
    failed.forEach((f) => console.log(`  - ${f.name} :: ${f.detail}`));
    process.exit(1);
  }
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
