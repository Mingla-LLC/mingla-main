/**
 * PR #3416 / #3440 — INDEPENDENT runtime retest (round 2: head fdcb1f307) on a real
 * `expo export -p web` of mingla-business, driven in Chromium against a fully
 * local Supabase mock (mockBackend.ts). No production host is reachable: every
 * other origin is aborted and each test asserts that list stayed empty.
 *
 * Screenshots: $EVIDENCE_3416 (default ../evidence-3416 from mingla-business).
 */
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import { APP, BRAND_SLUG, createBackend, install, passFetchCalls, session, submitCalls, type Backend } from "./mockBackend";

const EVIDENCE = process.env.EVIDENCE_3416 ?? path.resolve(__dirname, "../../../evidence-3416-r2");
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(EVIDENCE, `${name}.png`) });
/** Round 2: bring the decision box (reply label, notice, pass/retry action) on screen before the shot. */
const shotDecision = async (page: Page, name: string) => {
  const box = page.locator('[data-testid="orch-1157-rsvp-inline-momentum"]').first();
  await box.evaluate((n) => n.scrollIntoView({ block: "center" })).catch(() => undefined);
  await page.waitForTimeout(700);
  await shot(page, name);
};
const tid = (page: Page | Locator, id: string) => page.locator(`[data-testid="${id}"]`);
const SNAPSHOT_KEY = (eventId: string) => `mingla.rsvp.guest.v1:${eventId}`;
const EVENT_A_ID = "00000000-0000-4000-8000-00000000000a";

const inline = (page: Page) => tid(page, "orch-1157-rsvp-inline-momentum").first();
const floatingCard = (page: Page) => tid(page, "rsvp-floating-decision-card");
const qr = (page: Page) => page.locator('[aria-label^="RSVP QR code for"]');
const viewPass = (page: Page) => tid(page, "rsvp-view-pass");
const retry = (page: Page) => tid(page, "rsvp-recovery-retry");
const OFFLINE = "We couldn't confirm your pass — try again.";
const DENIED = "This saved pass is no longer available";
/** Returns to the page after a Going reply with a fresh JS runtime (same tab storage). */
const reloadReplied = async (page: Page) => { await page.reload(); await open(page, "night-a"); };
/** Samples for `ms`: "View your pass" or a QR must never be on screen. */
const neverPassFor = async (page: Page, ms: number) => {
  const until = Date.now() + ms;
  let samples = 0;
  while (Date.now() < until) {
    expect(await viewPass(page).count()).toBe(0);
    expect(await qr(page).count()).toBe(0);
    samples += 1;
    await page.waitForTimeout(150);
  }
  return samples;
};

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
  backend.servedName = "Served Name"; // D4: the rendered pass is the service's answer, not the stored copy
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
  await shotDecision(page, "R4b-returned-from-checkout-restored-375");
  await viewPass(page).click();
  await expect(qr(page).first()).toBeVisible();
  await expect(page.locator('[aria-label="RSVP QR code for Served Name"]').first()).toBeVisible();
  await expect(page.locator('[aria-label="RSVP QR code for Retest Guest"]')).toHaveCount(0);
  await shot(page, "R4c-returned-view-pass-375");
});

test("R5 D1: while a slow check (then 409) is in flight: 'You're going' only — no 'View your pass', no QR, no retry; then the 409 withdraws the reply", async ({ page }) => {
  await open(page, "night-a");
  await fillContact(page);
  await replyGoing(page);
  await closePopup(page);
  backend.passMode = { kind: "status", status: 409, delayMs: 8000 };
  await reloadReplied(page);
  await expect.poll(() => passFetchCalls(backend).length).toBeGreaterThan(0);
  await expect.poll(() => goingLabel(page)).toBe("You're going");
  await shotDecision(page, "R5a-pending-going-no-pass-375");
  const samples = await neverPassFor(page, 5000);
  expect(await retry(page).count()).toBe(0);
  expect(backend.passAnsweredAt).toHaveLength(0); // still pending for every sample
  console.log(JSON.stringify({ R5: { pendingSamplesWithoutPass: samples } }));
  await expect(page.getByText(DENIED).first()).toBeVisible({ timeout: 15_000 });
  await expect(viewPass(page)).toHaveCount(0);
  await expect(qr(page)).toHaveCount(0);
  expect(await goingLabel(page)).toBe("Going");
  await shotDecision(page, "R5b-after-409-withdrawn-375");
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
  await expect.poll(() => goingLabel(page)).toBe("You're going");
  await expect(viewPass(page)).toHaveCount(0); // D1: pending
  await expect.poll(() => passFetchCalls(backend).length).toBeGreaterThan(0);
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
  // D3: back to A in the same runtime — the late denial still blocks those bytes (no reply, no re-check).
  expect(backend.passAnsweredAt.length).toBeGreaterThan(0);
  const checksBefore = passFetchCalls(backend).length;
  backend.passMode = { kind: "ok" };
  await page.evaluate(() => { window.history.pushState({}, "", "/e/lantern/night-a"); window.dispatchEvent(new PopStateEvent("popstate", { state: {} })); });
  await expect(page.getByText("Neighbors Night A").first()).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
  await page.waitForTimeout(2000);
  expect(await goingLabel(page)).toBe("Going");
  await expect(viewPass(page)).toHaveCount(0);
  expect(passFetchCalls(backend).length).toBe(checksBefore);
  await shotDecision(page, "R7c-back-to-A-late-denial-still-blocks-375");
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

test("R10 D2: signed-in guest → chip-in → return: invite (no restore, no pass, no check); FINDING-1 its live Going re-submits", async ({ context, page }) => {
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
  expect(submitCalls(backend)).toHaveLength(1);
  const chip = tid(tid(page, "orch-1291-rsvp-chipin-panel-popup"), "orch-1291-rsvp-chipin-submit").first();
  await chip.scrollIntoViewIfNeeded();
  await Promise.all([page.waitForURL(/contribution=paid/, { timeout: 30_000 }), chip.click()]);
  await open(page, "night-a").catch(async () => undefined);
  await expect(page.getByText("Neighbors Night A").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  const banner = await tid(page, "orch-1295-chipin-return-banner").isVisible();
  const label = await goingLabel(page);
  await shotDecision(page, "R10a-signed-in-chipin-return-invite-375");
  expect(await viewPass(page).count()).toBe(0);
  expect(await qr(page).count()).toBe(0);
  expect(passFetchCalls(backend)).toHaveLength(0);
  expect(label).toBe("Going");
  // FINDING-1 evidence: the already-going guest can re-submit from this invite.
  await tid(inline(page), "orch-1150-rsvp-going").click();
  const confirmVisible = await tid(page, "orch-1163-rsvp-going-confirm-cta").isVisible();
  await shot(page, "R10b-signed-in-return-going-opens-confirm-375");
  if (confirmVisible) {
    await tid(page, "orch-1163-rsvp-going-confirm-cta").click();
    await expect.poll(() => submitCalls(backend).length, { timeout: 10_000 }).toBe(2);
    await page.waitForTimeout(800);
    await shotDecision(page, "R10c-signed-in-return-resubmitted-375");
  }
  console.log(JSON.stringify({ R10: { returnBannerVisible: banner, labelOnReturn: label, confirmVisible, submitCalls: submitCalls(backend).length, secondSubmitBody: submitCalls(backend)[1]?.body ?? null } }));
});

test("R11 D1: network error → notice + Try again, no pass; Try again while still offline → still no pass; service back → Try again → pass", async ({ page }) => {
  await open(page, "night-a");
  await fillContact(page);
  await replyGoing(page);
  await closePopup(page);
  backend.passMode = { kind: "network" };
  await reloadReplied(page);
  await expect(page.getByText(OFFLINE).first()).toBeVisible({ timeout: 15_000 });
  await expect(retry(page).first()).toBeVisible();
  expect(await goingLabel(page)).toBe("You're going");
  await expect(viewPass(page)).toHaveCount(0);
  await expect(qr(page)).toHaveCount(0);
  await shotDecision(page, "R11a-network-error-retry-no-pass-375");
  const before = passFetchCalls(backend).length;
  await retry(page).first().click();
  await expect.poll(() => passFetchCalls(backend).length).toBe(before + 1);
  await expect(retry(page).first()).toBeVisible({ timeout: 15_000 });
  await neverPassFor(page, 1500);
  await shotDecision(page, "R11b-retry-still-offline-no-pass-375");
  backend.passMode = { kind: "ok" };
  await retry(page).first().click();
  await expect(viewPass(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(OFFLINE)).toHaveCount(0);
  await viewPass(page).click();
  await expect(qr(page).first()).toBeVisible();
  await shotDecision(page, "R11c-service-back-retry-pass-375");
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

test("R13 D1: a check that never answers — 'You're going' only, no 'View your pass', no QR, no retry, for 8 s", async ({ page }) => {
  await open(page, "night-a");
  await fillContact(page);
  await replyGoing(page);
  await closePopup(page);
  backend.passMode = { kind: "hang" };
  await reloadReplied(page);
  await expect.poll(() => passFetchCalls(backend).length).toBeGreaterThan(0);
  await expect.poll(() => goingLabel(page)).toBe("You're going");
  const samples = await neverPassFor(page, 8000);
  expect(await retry(page).count()).toBe(0);
  const stored = await page.evaluate((k) => sessionStorage.getItem(k), SNAPSHOT_KEY(EVENT_A_ID));
  expect(stored).toContain(backend.nextQr); // the QR is in storage, and still never on screen
  await shotDecision(page, "R13-pending-verify-no-pass-no-qr-375");
  console.log(JSON.stringify({ R13: { samples } }));
});

test("R14 D4: the service answers for a DIFFERENT eventId — no pass, denial notice, stored reply removed", async ({ page }) => {
  await open(page, "night-a");
  await fillContact(page);
  await replyGoing(page);
  await closePopup(page);
  backend.passMode = { kind: "okOtherEvent" };
  await reloadReplied(page);
  await expect(page.getByText(DENIED).first()).toBeVisible({ timeout: 15_000 });
  await expect(viewPass(page)).toHaveCount(0);
  await expect(qr(page)).toHaveCount(0);
  expect(await goingLabel(page)).toBe("Going");
  expect(await page.evaluate((k) => sessionStorage.getItem(k), SNAPSHOT_KEY(EVENT_A_ID))).toBeNull();
  await shotDecision(page, "R14-other-event-id-no-pass-notice-375");
  backend.passMode = { kind: "ok" };
  await reloadReplied(page);
  await page.waitForTimeout(1500);
  await expect(viewPass(page)).toHaveCount(0);
});

test("R15 D4: the pre-#3416 service (no eventId) — reply kept, no pass, retry offered (deploy-order behaviour)", async ({ page }) => {
  await open(page, "night-a");
  await fillContact(page);
  await replyGoing(page);
  await closePopup(page);
  backend.passMode = { kind: "okLegacyNoEventId" };
  await reloadReplied(page);
  await expect(page.getByText(OFFLINE).first()).toBeVisible({ timeout: 15_000 });
  await expect(retry(page).first()).toBeVisible();
  expect(await goingLabel(page)).toBe("You're going");
  await neverPassFor(page, 1500);
  await retry(page).first().click();
  await expect(retry(page).first()).toBeVisible({ timeout: 15_000 });
  await neverPassFor(page, 1000);
  await shotDecision(page, "R15-legacy-service-no-eventid-retry-no-pass-375");
});

test("R16 D1: double-click Try again during a slow check — no pass until the answer, then exactly the service pass", async ({ page }) => {
  await open(page, "night-a");
  await fillContact(page);
  await replyGoing(page);
  await closePopup(page);
  backend.passMode = { kind: "network" };
  await reloadReplied(page);
  await expect(retry(page).first()).toBeVisible({ timeout: 15_000 });
  backend.passMode = { kind: "ok", delayMs: 4000 };
  const before = passFetchCalls(backend).length;
  await retry(page).first().dblclick({ force: true }).catch(() => undefined);
  await neverPassFor(page, 3000);
  expect(submitCalls(backend)).toHaveLength(1); // the second click hit nothing that replies
  await shotDecision(page, "R16a-double-retry-pending-no-pass-375");
  await expect(viewPass(page)).toBeVisible({ timeout: 15_000 });
  await viewPass(page).click();
  await expect(qr(page)).toHaveCount(1);
  await shot(page, "R16b-double-retry-answered-pass-375");
  console.log(JSON.stringify({ R16: { checksFromDoubleClick: passFetchCalls(backend).length - before } }));
});

test("R17 reload mid-check (slow 200 then reload): the new page shows no pass until ITS OWN answer", async ({ page }) => {
  await open(page, "night-a");
  await fillContact(page);
  await replyGoing(page);
  await closePopup(page);
  backend.passMode = { kind: "ok", delayMs: 2500 };
  await reloadReplied(page);
  await expect.poll(() => passFetchCalls(backend).length).toBeGreaterThan(0);
  backend.passMode = { kind: "ok", delayMs: 6000 };
  const answeredBefore = backend.passAnsweredAt.length;
  await reloadReplied(page);
  await neverPassFor(page, 3500); // the first page's 200 has landed (into a dead runtime) during this window
  expect(backend.passAnsweredAt.length).toBeGreaterThan(answeredBefore);
  await shotDecision(page, "R17a-reload-mid-check-no-pass-375");
  await expect(viewPass(page)).toBeVisible({ timeout: 15_000 });
});
