/**
 * PR #3416 / #3440 — INDEPENDENT runtime retest of head 034b86abe on a real
 * `expo export -p web` of mingla-business, driven in Chromium against a fully
 * local Supabase mock (mockBackend.ts). No production host is reachable: every
 * other origin is aborted and each test asserts that list stayed empty.
 *
 * Screenshots: $EVIDENCE_3416 (default ../evidence-3416 from mingla-business).
 */
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import { APP, BRAND_SLUG, createBackend, install, passFetchCalls, session, submitCalls, type Backend } from "./mockBackend";

const EVIDENCE = process.env.EVIDENCE_3416 ?? path.resolve(__dirname, "../../../evidence-3416");
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(EVIDENCE, `${name}.png`) });
const tid = (page: Page | Locator, id: string) => page.locator(`[data-testid="${id}"]`);
const SNAPSHOT_KEY = (eventId: string) => `mingla.rsvp.guest.v1:${eventId}`;
const EVENT_A_ID = "00000000-0000-4000-8000-00000000000a";

const inline = (page: Page) => tid(page, "orch-1157-rsvp-inline-momentum").first();
const floatingCard = (page: Page) => tid(page, "rsvp-floating-decision-card");
const qr = (page: Page) => page.locator('[aria-label^="RSVP QR code for"]');
const viewPass = (page: Page) => tid(page, "rsvp-view-pass");

const open = async (page: Page, slug: string, query = "") => {
  await page.goto(`${APP}/e/${BRAND_SLUG}/${slug}${query}`);
  await expect(page.getByText(slug === "night-b" ? "Different Night B" : "Neighbors Night A").first()).toBeVisible({ timeout: 30_000 });
  // Privacy-preserving choice on the local build's consent banner.
  const reject = page.getByText("Reject", { exact: true });
  if (await reject.isVisible().catch(() => false)) await reject.click();
  await expect(inline(page)).toBeAttached();
};
/** Scroll the RN-web ScrollView under the pointer. */
const wheel = async (page: Page, dy: number) => {
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width / 2, vp.height / 2);
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(700); // > VISIBILITY_POLL_MS (400)
};
const rect = (l: Locator) => l.evaluate((n) => { const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; });
const inlineOnScreen = async (page: Page) => {
  const r = await rect(inline(page));
  const vh = page.viewportSize()!.height;
  const overlap = Math.min(r.bottom, vh) - Math.max(r.top, 0);
  return overlap >= Math.min(r.height / 2, 48);
};
const fillContact = async (page: Page, name = "Retest Guest") => {
  await tid(page, "orch-1150-rsvp-name").fill(name);
  await tid(page, "orch-1150-rsvp-email").fill("retest.guest@example.test");
  await tid(page, "issue-1857-rsvp-primary-phone-input").fill("2015550123");
};
const replyGoing = async (page: Page) => {
  await tid(inline(page), "orch-1150-rsvp-going").click();
  await tid(page, "orch-1163-rsvp-going-confirm-cta").click();
  await expect(qr(page).first()).toBeVisible({ timeout: 15_000 });
};
const closePopup = async (page: Page) => {
  await tid(page, "orch-1163-rsvp-success-done").first().click();
  await expect(qr(page)).toHaveCount(0);
};
const goingLabel = (page: Page) => tid(inline(page), "orch-1150-rsvp-going").getAttribute("aria-label");

let backend: Backend;
test.beforeEach(async ({ context }) => {
  backend = createBackend();
  await install(context, backend);
});
test.afterEach(async () => {
  expect([...new Set(backend.blocked)].filter((o) => !o.includes("fonts.g"))).toEqual([]);
});

test("R1 countdown pill says 'Starts in 11 days', never 'Not on sale yet'", async ({ page }) => {
  await open(page, "night-a");
  await expect(tid(page, "rsvp-status-banner-label")).toHaveText("Starts in 11 days");
  await expect(page.getByText("Not on sale yet")).toHaveCount(0);
  await shot(page, "R1-countdown-pill-375");
});

test("R2 Going with empty fields scrolls to and focuses the first missing field, marks it, shows the hint", async ({ page }) => {
  await open(page, "night-a");
  await inline(page).scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const nameBefore = await rect(tid(page, "orch-1150-rsvp-name"));
  await shot(page, "R2a-before-blocked-tap-375");
  await tid(inline(page), "orch-1150-rsvp-going").click();
  await page.waitForTimeout(1200); // smooth scroll
  const name = tid(page, "orch-1150-rsvp-name");
  await expect(name).toBeFocused();
  const r = await rect(name);
  const vh = page.viewportSize()!.height;
  expect(r.top).toBeGreaterThanOrEqual(0);
  expect(r.bottom).toBeLessThanOrEqual(vh);
  expect(nameBefore.top).not.toBe(r.top); // it actually scrolled
  await expect(page.getByText("Add your name").first()).toBeVisible();
  await expect(tid(page, "rsvp-decision-validation-hint").first()).toContainText("Add your name, email and phone number");
  expect(submitCalls(backend)).toHaveLength(0);
  // If the floating bar appeared for the hint, it must not cover the focused field.
  if (await floatingCard(page).isVisible()) {
    const bar = await rect(floatingCard(page));
    expect(bar.top).toBeGreaterThanOrEqual(r.bottom);
  }
  await shot(page, "R2b-after-blocked-tap-focus-375");
});

test("R3 phone: floating bar only after the inline row scrolls away, never both, never over the last content", async ({ page }) => {
  await open(page, "night-a");
  await page.waitForTimeout(1000);
  await expect(floatingCard(page)).toHaveCount(0);
  await shot(page, "R3a-first-load-no-bar-375");
  await page.getByText("Read more", { exact: true }).click(); // long About → page scrolls past the row
  await page.waitForTimeout(800);
  let sawBar = false;
  let sawInline = false;
  let sawBarShot = false;
  for (let i = 0; i < 40; i += 1) {
    const inlineVisible = await inlineOnScreen(page);
    const barVisible = await floatingCard(page).isVisible();
    sawBar ||= barVisible; sawInline ||= inlineVisible;
    expect({ step: i, both: inlineVisible && barVisible }).toEqual({ step: i, both: false });
    if (i === 3 || (barVisible && !sawBarShot)) { await shot(page, `R3b-step${i}-inline-${inlineVisible}-bar-${barVisible}-375`); sawBarShot ||= barVisible; }
    if (barVisible) {
      const bar = await rect(floatingCard(page));
      expect(bar.bottom).toBeLessThanOrEqual(page.viewportSize()!.height);
    }
    await wheel(page, 120);
  }
  expect(sawInline).toBe(true);
  expect(sawBar).toBe(true);
  // Bottom of the page: the last section must clear the bar.
  for (let i = 0; i < 12; i += 1) await wheel(page, 1500);
  await expect(floatingCard(page)).toBeVisible();
  const bar = await rect(floatingCard(page));
  const lastText = page.getByText("Full address shared once you're going").first();
  const last = await rect(lastText);
  expect(last.bottom).toBeLessThanOrEqual(bar.top);
  await shot(page, "R3c-bottom-bar-clears-last-section-375");
  // Scroll back up so the inline row returns: bar goes away.
  for (let i = 0; i < 80 && !(await inlineOnScreen(page)); i += 1) await wheel(page, -250);
  expect(await inlineOnScreen(page)).toBe(true);
  // Transient check: small quick scrolls across the row boundary, sampled 60 ms
  // after each wheel (well inside the 400 ms poll) — how long can both show?
  let doubledSamples = 0;
  let samples = 0;
  for (let pass = 0; pass < 3; pass += 1) {
    for (const dy of [...Array(14).fill(60), ...Array(14).fill(-60)]) {
      await page.mouse.wheel(0, dy);
      await page.waitForTimeout(60);
      samples += 1;
      if ((await inlineOnScreen(page)) && (await floatingCard(page).isVisible())) {
        doubledSamples += 1;
        if (doubledSamples === 1) await shot(page, "R3x-transient-both-visible-375");
      }
    }
  }
  console.log(JSON.stringify({ R3_transient: { samples, doubledSamples } }));
  await page.waitForTimeout(800);
  for (let i = 0; i < 20 && !(await inlineOnScreen(page)); i += 1) await wheel(page, -120);
  await expect(floatingCard(page)).toBeHidden();
  await shot(page, "R3d-back-to-inline-no-bar-375");
});

test.describe("desktop 1440x900", () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });
  test("R3-desktop no floating bar at any scroll position; Going blocked tap focuses first field", async ({ page }) => {
    await open(page, "night-a");
    for (let i = 0; i < 8; i += 1) {
      await expect(floatingCard(page)).toHaveCount(0);
      if (i === 0) await shot(page, "R3e-desktop-top-1440");
      await wheel(page, 400);
    }
    await shot(page, "R3f-desktop-scrolled-1440");
    const going = page.locator('[data-testid="orch-1150-rsvp-going"]:visible').first();
    await going.click();
    await page.waitForTimeout(1200);
    await expect(tid(page, "orch-1150-rsvp-name")).toBeFocused();
    await shot(page, "R3g-desktop-blocked-tap-1440");
  });
});

test("R4 Going → chip-in redirect (fake hosted checkout) → return restores 'You're going' + pass, verified with the service", async ({ page }) => {
  await open(page, "night-a");
  await fillContact(page);
  await replyGoing(page);
  await shot(page, "R4a-accepted-pass-popup-375");
  const stored = await page.evaluate((k) => sessionStorage.getItem(k), SNAPSHOT_KEY(EVENT_A_ID));
  expect(stored).toContain(backend.nextQr);
  expect(stored).toContain('"owner":"null"');
  const chip = tid(tid(page, "orch-1291-rsvp-chipin-panel-popup"), "orch-1291-rsvp-chipin-submit").first();
  await chip.scrollIntoViewIfNeeded();
  await expect(chip).toBeVisible();
  const navigations: string[] = [];
  page.on("request", (r) => { if (r.isNavigationRequest()) navigations.push(r.url()); });
  await page.evaluate(() => { (window as unknown as { __beforeCheckout: boolean }).__beforeCheckout = true; });
  await Promise.all([page.waitForURL(/contribution=paid/, { timeout: 30_000 }), chip.click()]);
  await expect(page.getByText("Neighbors Night A").first()).toBeVisible({ timeout: 30_000 });
  await expect(viewPass(page)).toBeVisible({ timeout: 15_000 });
  expect(await goingLabel(page)).toBe("You're going");
  await expect.poll(() => passFetchCalls(backend).length).toBeGreaterThan(0);
  expect(passFetchCalls(backend)[0].body).toContain("token-rsvp-retest-qr-1");
  expect(page.url()).not.toContain("token");
  expect(navigations.some((u) => u.includes("/__fake-stripe"))).toBe(true); // really left the page
  expect(await page.evaluate(() => (window as unknown as { __beforeCheckout?: boolean }).__beforeCheckout)).toBeUndefined(); // full reload
  await shot(page, "R4b-returned-from-checkout-restored-375");
  await viewPass(page).click();
  await expect(qr(page).first()).toBeVisible();
  await shot(page, "R4c-returned-view-pass-375");
});

test("R5 PENDING DEVIATION: while the pass check is in flight, 'View your pass' renders a scannable QR the service then denies (409)", async ({ page }) => {
  await open(page, "night-a");
  await fillContact(page);
  await replyGoing(page);
  await closePopup(page);
  // Host revokes; the verifier answers 409 — slowly (8 s).
  backend.passMode = { kind: "status", status: 409, delayMs: 8000 };
  await page.reload();
  await open(page, "night-a").catch(async () => undefined);
  await expect(viewPass(page)).toBeVisible({ timeout: 15_000 });
  expect(passFetchCalls(backend).length).toBeGreaterThan(0);
  await viewPass(page).click();
  const svgWhilePending = qr(page).first().locator("svg");
  await expect(svgWhilePending).toBeVisible({ timeout: 5_000 });
  const pendingQrPixels = await svgWhilePending.evaluate((n) => [...n.querySelectorAll("path")].reduce((sum, p) => sum + (p.getAttribute("d") ?? "").length, 0));
  await shot(page, "R5a-PENDING-scannable-qr-before-409-375");
  const shotAt = Date.now();
  expect(backend.passAnsweredAt).toHaveLength(0); // the 409 had NOT been answered when the QR was on screen
  console.log(JSON.stringify({ R5: { passRequestedAt: passFetchCalls(backend).at(-1)?.at, qrScreenshotAt: shotAt } }));
  // …then the 409 lands and the page withdraws it.
  await expect(qr(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText("This saved pass is no longer available").first()).toBeVisible();
  await shot(page, "R5b-after-409-withdrawn-375");
  expect(backend.passAnsweredAt[0]).toBeGreaterThan(shotAt);
  expect(pendingQrPixels).toBeGreaterThan(500); // a real QR module matrix was painted
});

test("R6 denied (403) is not restored, on this load or the next", async ({ page }) => {
  await open(page, "night-a");
  await fillContact(page);
  await replyGoing(page);
  await closePopup(page);
  backend.passMode = { kind: "status", status: 403 };
  await page.reload();
  await open(page, "night-a");
  await expect(page.getByText("This saved pass is no longer available").first()).toBeVisible({ timeout: 15_000 });
  await expect(viewPass(page)).toHaveCount(0);
  expect(await goingLabel(page)).not.toBe("You're going");
  expect(await page.evaluate((k) => sessionStorage.getItem(k), SNAPSHOT_KEY(EVENT_A_ID))).toBeNull();
  await shot(page, "R6a-denied-not-restored-375");
  backend.passMode = { kind: "ok" };
  await page.reload();
  await open(page, "night-a");
  await page.waitForTimeout(1500);
  await expect(viewPass(page)).toHaveCount(0);
});

test("R7 in-app event switch A→B while A's check is pending: no A reply/pass on B; B stays an invite after A's late denial", async ({ page }) => {
  await open(page, "night-a");
  await fillContact(page);
  await replyGoing(page);
  await closePopup(page);
  backend.passMode = { kind: "status", status: 403, delayMs: 4000 };
  await page.reload();
  await open(page, "night-a");
  await expect(viewPass(page)).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __noReload: boolean }).__noReload = true; });
  await page.evaluate(() => { window.history.pushState({}, "", "/e/lantern/night-b"); window.dispatchEvent(new PopStateEvent("popstate", { state: {} })); });
  await expect(page.getByText("Different Night B").first()).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true); // same JS runtime
  await expect(viewPass(page)).toHaveCount(0);
  expect(await goingLabel(page)).toBe("Going");
  await shot(page, "R7a-event-b-no-bleed-375");
  await page.waitForTimeout(5000); // A's delayed 403 lands while B is mounted
  await expect(viewPass(page)).toHaveCount(0);
  expect(await goingLabel(page)).toBe("Going");
  await expect(page.getByText("This saved pass is no longer available")).toHaveCount(0);
  await shot(page, "R7b-event-b-after-late-A-denial-375");
});

const seedSignedIn = async (context: BrowserContext, userId: string) => {
  await context.addInitScript(({ s }) => {
    if (localStorage.getItem("__retest_seeded") !== null) return;
    localStorage.setItem("__retest_seeded", "1");
    localStorage.setItem("sb-127-auth-token", JSON.stringify(s));
    localStorage.setItem("sb-gqnoajqerqhnvulmnyvv-auth-token", JSON.stringify(s));
  }, { s: session(userId) });
};
const broadcastFromOtherTab = async (context: BrowserContext, message: unknown, clear: boolean) => {
  const other = await context.newPage();
  await other.goto(`${APP}/__blank`);
  await other.evaluate(({ m, c }) => {
    if (c) { localStorage.removeItem("sb-127-auth-token"); localStorage.removeItem("sb-gqnoajqerqhnvulmnyvv-auth-token"); }
    new BroadcastChannel("sb-127-auth-token").postMessage(m);
  }, { m: message, c: clear });
  await other.close();
};

test("R8 signed-in A replies Going, signs out in another tab, B signs in: A's pass never shows (mounted or after reload)", async ({ context, page }) => {
  backend.signedIn = true;
  backend.nextQr = "mingla:v1:rsvp:account-a-qr";
  await seedSignedIn(context, "account-a");
  await open(page, "night-a");
  const going = tid(inline(page), "orch-1150-rsvp-going");
  await going.click();
  // Signed-in guests may still be asked for contact details; fill if shown.
  if (await tid(page, "orch-1163-rsvp-going-confirm-cta").isHidden()) {
    await fillContact(page, "Account A");
    await going.click();
  }
  await tid(page, "orch-1163-rsvp-going-confirm-cta").click();
  await expect(qr(page).first()).toBeVisible({ timeout: 15_000 });
  const stored = await page.evaluate((k) => sessionStorage.getItem(k), SNAPSHOT_KEY(EVENT_A_ID));
  expect(stored).toContain('"owner":"\\"account-a\\""');
  await closePopup(page);
  await expect(viewPass(page)).toBeVisible();
  await shot(page, "R8a-account-a-going-375");

  await broadcastFromOtherTab(context, { event: "SIGNED_OUT", session: null }, true);
  await expect(viewPass(page)).toHaveCount(0, { timeout: 10_000 });
  expect(await goingLabel(page)).toBe("Going");
  expect(await page.evaluate((k) => sessionStorage.getItem(k), SNAPSHOT_KEY(EVENT_A_ID))).toBeNull();
  await shot(page, "R8b-after-logout-nothing-375");

  await broadcastFromOtherTab(context, { event: "SIGNED_IN", session: session("account-b") }, false);
  await page.waitForTimeout(2000);
  await expect(viewPass(page)).toHaveCount(0);
  await page.reload();
  await open(page, "night-a");
  await page.waitForTimeout(1500);
  await expect(viewPass(page)).toHaveCount(0);
  await expect(page.getByText("account-a-qr")).toHaveCount(0);
  await shot(page, "R8c-after-reload-anonymous-nothing-375");
});

test("R9 spoofed ?contribution=paid on a fresh tab restores no reply and no pass", async ({ page }) => {
  await open(page, "night-a", "?contribution=paid&rsvp=going&pass=forged");
  await page.waitForTimeout(1500);
  await expect(viewPass(page)).toHaveCount(0);
  expect(await goingLabel(page)).toBe("Going");
  expect(passFetchCalls(backend)).toHaveLength(0);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("mingla.rsvp.guest")))).toEqual([]);
  await shot(page, "R9-spoofed-contribution-paid-375");
});

test("R10 DEFECT-C runtime: a signed-in reply restores after reload with NO pass-service check, even though the service would deny it", async ({ context, page }) => {
  backend.signedIn = true;
  backend.nextQr = "mingla:v1:rsvp:signed-in-qr";
  await seedSignedIn(context, "account-a");
  await open(page, "night-a");
  const going = tid(inline(page), "orch-1150-rsvp-going");
  await going.click();
  if (await tid(page, "orch-1163-rsvp-going-confirm-cta").isHidden()) {
    await fillContact(page, "Account A");
    await going.click();
  }
  await tid(page, "orch-1163-rsvp-going-confirm-cta").click();
  await expect(qr(page).first()).toBeVisible({ timeout: 15_000 });
  await closePopup(page);
  backend.passMode = { kind: "status", status: 409 }; // host revoked A
  await page.reload();
  await open(page, "night-a");
  await page.waitForTimeout(3000);
  const restored = await viewPass(page).isVisible();
  let qrShown = false;
  if (restored) {
    await viewPass(page).click();
    qrShown = await qr(page).first().locator("svg").waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false);
    await page.waitForTimeout(800); // let the popup finish fading in
    await shot(page, "R10-signed-in-restored-qr-never-verified-375");
  }
  const checks = passFetchCalls(backend).length;
  console.log(JSON.stringify({ restored, qrShown, passFetchCalls: checks }));
  expect(checks > 0 || !qrShown).toBe(true);
});

test("R11 verify network failure keeps the reply AND the openable QR indefinitely (stated design; evidence for the pending finding)", async ({ page }) => {
  await open(page, "night-a");
  await fillContact(page);
  await replyGoing(page);
  await closePopup(page);
  backend.passMode = { kind: "network" };
  await page.reload();
  await open(page, "night-a");
  await expect(page.getByText("We couldn't check your RSVP right now").first()).toBeVisible({ timeout: 15_000 });
  await viewPass(page).click();
  await expect(qr(page).first().locator("svg")).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(800);
  await shot(page, "R11-offline-verify-qr-still-shown-375");
});

test("R12 a second, separately opened tab never sees the first tab's reply", async ({ context, page }) => {
  await open(page, "night-a");
  await fillContact(page);
  await replyGoing(page);
  await closePopup(page);
  const second = await context.newPage();
  await open(second, "night-a");
  await second.waitForTimeout(1500);
  await expect(viewPass(second)).toHaveCount(0);
  expect(await second.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("mingla.rsvp.guest")))).toEqual([]);
  expect(await goingLabel(second)).toBe("Going");
  await second.screenshot({ path: path.join(EVIDENCE, "R12-second-tab-no-reply-375.png") });
  await expect(viewPass(page)).toBeVisible(); // first tab unaffected
});
