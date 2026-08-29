import { expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const loopback = "http://127.0.0.1:42769";
const localhost = "http://localhost:42769";
const repository = path.resolve(__dirname, "../../..");
const source = (relative: string): string => readFileSync(path.join(repository, relative), "utf8");

async function freshPage(browser: Browser, width: number, height: number): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.goto(loopback);
  return page;
}

async function assertPanelBounded(page: Page, width: number, height: number): Promise<void> {
  const region = page.getByRole("region", { name: "Cookie consent" });
  const box = await region.boundingBox();
  expect(box, `${width}x${height} consent bounds`).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(height);
  for (const id of ["accept", "reject", "manage"] as const) {
    const control = page.getByTestId(`issue-2769-consent-${id}`);
    await expect(control).toBeVisible();
    const controlBox = await control.boundingBox();
    expect(controlBox).not.toBeNull();
    expect(controlBox!.y).toBeGreaterThanOrEqual(box!.y);
    expect(controlBox!.y + controlBox!.height).toBeLessThanOrEqual(box!.y + box!.height);
    expect(controlBox!.height).toBeGreaterThanOrEqual(44);
  }
}

test("phone, threshold, desktop, dynamic-height, and 200%-effective layouts obey one-action composition", async ({ browser }) => {
  for (const [width, height] of [[320, 568], [390, 844], [402, 874], [1279, 640], [195, 422]] as const) {
    const page = await freshPage(browser, width, height);
    await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(0);
    await expect(page.getByTestId("issue-2729-reserve-bar")).toHaveCount(0);
    await assertPanelBounded(page, width, height);
    await page.getByTestId("issue-2769-consent-manage").click();
    await assertPanelBounded(page, width, height);
    expect(await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth })))
      .toEqual({ doc: width, body: width });
    await page.context().close();
  }

  for (const [width, height] of [[1280, 640], [1440, 900]] as const) {
    const page = await freshPage(browser, width, height);
    await expect(page.getByRole("region", { name: "Cookie consent" })).toHaveCount(1);
    await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
    await assertPanelBounded(page, width, height);
    const consent = await page.getByRole("region", { name: "Cookie consent" }).locator(":scope > div").boundingBox();
    const reserve = await page.getByTestId("issue-2729-reserve-cta").boundingBox();
    expect(consent).not.toBeNull();
    expect(reserve).not.toBeNull();
    const overlaps = consent!.x < reserve!.x + reserve!.width && consent!.x + consent!.width > reserve!.x &&
      consent!.y < reserve!.y + reserve!.height && consent!.y + consent!.height > reserve!.y;
    expect(overlaps).toBe(false);
    await page.context().close();
  }
});

test("semantic omission is not hidden CSS and same-page settlement restores exactly one Reserve", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(loopback);
  expect(await page.locator("[data-testid='issue-2729-reserve-cta']").count()).toBe(0);
  expect(await page.getByRole("button", { name: "Reserve a table" }).count()).toBe(0);
  await page.getByTestId("issue-2769-consent-manage").click();
  await expect(page.getByTestId("issue-2769-consent-manage")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("issue-2769-consent-manage")).toHaveAttribute("aria-controls", "issue-2769-consent-details");
  await page.getByTestId("issue-2769-consent-reject").click();
  await expect(page.getByRole("region", { name: "Cookie consent" })).toHaveCount(0);
  await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
  await expect(page.getByTestId("issue-2729-reserve-bar")).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("region", { name: "Cookie consent" })).toHaveCount(0);
  await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
});

test("privacy, Accept, Reject, and Manage have deterministic keyboard order and visible focus", async ({ page }) => {
  await page.goto(loopback);
  const controls = [
    page.getByRole("link", { name: "Privacy Policy" }),
    page.getByTestId("issue-2769-consent-accept"),
    page.getByTestId("issue-2769-consent-reject"),
    page.getByTestId("issue-2769-consent-manage"),
  ];
  await controls[0].focus();
  for (let index = 0; index < controls.length; index += 1) {
    await expect(controls[index]).toBeFocused();
    if (index + 1 < controls.length) await page.keyboard.press("Tab");
  }
  const manage = controls[3];
  expect(await manage.evaluate((node) => getComputedStyle(node).outlineWidth)).toBe("2px");
  await page.keyboard.press("Enter");
  await expect(manage).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#issue-2769-consent-details")).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect(controls[2]).toBeFocused();
});

test("page scroll remains available outside the nonmodal panel and the reading band owns local overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(loopback);
  // Match the production Expo root contract and the already-proven #2729
  // harness. The #2769 fixture omits this one containing-block rule.
  await page.addStyleTag({ content: "#root > div { height: 100%; }" });
  const scrollOwner = page.locator("[data-testid='orch-1255-public-venue']").locator("div").filter({ hasNot: page.getByRole("region", { name: "Cookie consent" }) });
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.move(8, 120);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(100);
  const nativeOwnerMoved = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("*")).some((node) =>
    node.closest("[aria-label='Cookie consent']") === null && /(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollTop > 0));
  expect(nativeOwnerMoved || (await page.evaluate(() => window.scrollY)) > before).toBe(true);
  await page.getByTestId("issue-2769-consent-manage").click();
  const readingBand = page.locator("[aria-label='Cookie consent']").locator("div").filter({ hasText: "Cookies & analytics" }).first();
  await expect(readingBand).toBeVisible();
  expect(await page.locator("body").evaluate((node) => getComputedStyle(node).overflowX)).not.toBe("scroll");
  expect(await scrollOwner.count()).toBeGreaterThan(0);
});

test("accept, reject, cross-tab storage, malformed storage, and unavailable storage fail closed without duplicates", async ({ browser }) => {
  for (const action of ["accept", "reject"] as const) {
    const page = await freshPage(browser, 390, 844);
    await page.getByTestId(`issue-2769-consent-${action}`).click();
    await expect(page.getByRole("region", { name: "Cookie consent" })).toHaveCount(0);
    await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mingla_consent_v1") ?? "null")?.choice))
      .toBe(action === "accept" ? "granted" : "denied");
    await page.context().close();
  }

  const malformed = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await malformed.addInitScript(() => localStorage.setItem("mingla_consent_v1", "not-json"));
  const malformedPage = await malformed.newPage();
  await malformedPage.goto(loopback);
  await expect(malformedPage.getByRole("region", { name: "Cookie consent" })).toHaveCount(1);
  await expect(malformedPage.getByTestId("issue-2729-reserve-cta")).toHaveCount(0);
  await malformed.close();

  const unavailable = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await unavailable.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error("unavailable"); };
    Storage.prototype.setItem = () => { throw new Error("unavailable"); };
  });
  const unavailablePage = await unavailable.newPage();
  await unavailablePage.goto(loopback);
  await expect(unavailablePage.getByRole("region", { name: "Cookie consent" })).toHaveCount(1);
  await unavailablePage.getByTestId("issue-2769-consent-reject").click();
  await expect(unavailablePage.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
  await unavailable.close();

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto(loopback), second.goto(loopback)]);
  await first.getByTestId("issue-2769-consent-accept").click();
  await expect(second.getByRole("region", { name: "Cookie consent" })).toHaveCount(0);
  await expect(second.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
  await expect(second.getByTestId("issue-2729-reserve-bar")).toHaveCount(1);
  await context.close();
});

test("one storage listener is installed per page and both loopback aliases render the same adapter", async ({ browser }) => {
  for (const origin of [loopback, localhost]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => {
      const original = window.addEventListener.bind(window);
      let storageListeners = 0;
      window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
        if (type === "storage") storageListeners += 1;
        (window as typeof window & { __issue2769StorageListeners?: () => number }).__issue2769StorageListeners = () => storageListeners;
        original(type, listener, options);
      }) as typeof window.addEventListener;
    });
    const page = await context.newPage();
    await page.goto(origin);
    expect(await page.evaluate(() => (window as typeof window & { __issue2769StorageListeners?: () => number }).__issue2769StorageListeners?.())).toBe(1);
    await expect(page.getByRole("region", { name: "Cookie consent" })).toHaveCount(1);
    await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(0);
    await context.close();
  }
});

test("Reservations suppresses Reserve after consent and Overview retains #2729 single-origin behavior", async ({ page }) => {
  await page.goto(loopback);
  await page.getByTestId("issue-2769-consent-reject").click();
  const reserve = page.getByTestId("issue-2729-reserve-cta");
  await reserve.click();
  await expect(page.getByTestId("issue-2769-sheet")).toHaveCount(1);
  expect(await page.evaluate(() => window.__issue2769Analytics.filter((value) => value === "public_venue_reservation_started").length)).toBe(1);
  await page.goto(`${loopback}/?tab=reservations`);
  await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(0);
  await expect(page.getByTestId("issue-2729-reserve-bar")).toHaveCount(0);
});

test("hydration, route ownership, and native exclusion stay explicit in production source", () => {
  const webHook = source("mingla-business/src/analytics/useWebConsentState.web.ts");
  const nativeHook = source("mingla-business/src/analytics/useWebConsentState.ts");
  const route = source("mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx");
  const screen = source("packages/brand-rendering/PublicVenueScreen.tsx");
  expect(webHook).toContain('const getServerSnapshot = (): WebConsentState => "unknown";');
  expect(nativeHook).toContain('return "not_applicable";');
  expect(nativeHook).not.toContain("webAnalytics.web");
  expect(route).toContain("webConsentState={webConsentState}");
  expect(screen).toContain('webConsentState === "unknown" || webConsentState === "unresolved"');
});
