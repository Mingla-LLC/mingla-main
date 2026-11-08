// #2331 → #4318 adversarial proof (a different angle from the happy path):
// short and landscape viewports, the sheet open, a dialog opening over the
// strip, GPC, carried-over v1 choices, focus, and the switches always matching
// what is loaded. Same harness and run instructions as privacy-bar.happy.spec.ts.
import { expect, test } from "@playwright/test";
import {
  APP,
  BRAND_SLUG,
  EVENT_SLUG,
  PAGES,
  auditOcclusion,
  install,
  scrollToEnd,
  vendorsSeen,
} from "./harness";

const SHORT = [
  { width: 320, height: 480 },
  { width: 568, height: 320 },
  { width: 844, height: 390 },
] as const;
const PIXELS = ["meta", "tiktok", "snap", "reddit"] as const;

for (const size of SHORT) {
  test(`${size.width}x${size.height}: the strip covers no control; the sheet fits above it and never moves it`, async ({ browser }) => {
    for (const target of PAGES) {
      const context = await browser.newContext({ viewport: size });
      await install(context, { signedIn: target.signedIn });
      const page = await context.newPage();
      await page.goto(target.url);
      await expect(page.getByTestId("privacy-strip")).toBeVisible();
      await page.waitForTimeout(target.signedIn === true ? 5000 : 1200);
      await scrollToEnd(page);
      const closed = await auditOcclusion(page);
      expect(closed.covered, `${target.name} @ ${size.width}x${size.height}`).toEqual([]);
      const before = await page.getByTestId("privacy-strip").boundingBox();
      await page.getByTestId("privacy-strip").click();
      const sheet = page.getByTestId("privacy-sheet");
      await expect(sheet).toBeVisible();
      const box = (await sheet.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(size.height - 28 + 0.5);
      expect(await page.getByTestId("privacy-strip").boundingBox()).toEqual(before);
      expect((await auditOcclusion(page)).inset).toBe("28px");
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      await expect(page.getByTestId("privacy-strip")).toBeFocused();
      await context.close();
    }
  });
}

test("the sheet traps focus: Tab and Shift+Tab never leave it", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await install(context);
  const page = await context.newPage();
  await page.goto(`${APP}/e/${BRAND_SLUG}/${EVENT_SLUG}`);
  await page.getByTestId("privacy-strip").click();
  await expect(page.getByTestId("privacy-switch-analytics")).toBeFocused();
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press(index % 2 === 0 ? "Tab" : "Shift+Tab");
    expect(await page.evaluate(() => document.querySelector("[data-testid='privacy-sheet']")?.contains(document.activeElement))).toBe(true);
  }
  await context.close();
});

test("a dialog opened over the page covers the strip (the strip sits below sheets and dialogs)", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
  await install(context);
  const page = await context.newPage();
  await page.goto(`${APP}/e/${BRAND_SLUG}/${EVENT_SLUG}`);
  await expect(page.getByTestId("privacy-strip")).toBeVisible();
  await page.getByRole("button", { name: /share/i }).first().click();
  await expect(page.locator("[role='dialog'], [aria-modal='true']").first()).toBeAttached();
  const hit = await page.evaluate(() => {
    const strip = document.querySelector<HTMLElement>("[data-testid='privacy-strip']")!.getBoundingClientRect();
    const top = document.elementsFromPoint(strip.left + 40, strip.top + strip.height / 2)[0];
    return top?.closest("[data-testid='privacy-strip']") !== null && top !== undefined;
  });
  expect(hit).toBe(false);
  await context.close();
});

test("Global Privacy Control: no pixel request at all, the Ads switch shows off, analytics unaffected", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true, configurable: true });
  });
  const rec = await install(context);
  const page = await context.newPage();
  await page.goto(`${APP}/e/${BRAND_SLUG}/${EVENT_SLUG}`);
  await expect(page.getByTestId("privacy-strip")).toBeVisible();
  await expect.poll(() => vendorsSeen(rec).has("posthog"), { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(4000);
  for (const pixel of PIXELS) expect(vendorsSeen(rec).has(pixel), pixel).toBe(false);
  await page.getByTestId("privacy-strip").click();
  await expect(page.getByTestId("privacy-switch-analytics")).toBeChecked();
  await expect(page.getByTestId("privacy-switch-ads")).not.toBeChecked();
  await page.getByTestId("privacy-bar-save").click();
  await expect(page.getByTestId("privacy-strip")).toHaveText("Saved");
  await page.waitForTimeout(2000);
  for (const pixel of PIXELS) expect(vendorsSeen(rec).has(pixel), pixel).toBe(false);
  await context.close();
});

for (const [choice, on] of [["denied", false], ["granted", true]] as const) {
  test(`a carried-over v1 ${choice} visitor sees the strip and no sheet; vendors ${on ? "run" : "stay silent"}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
    await context.addInitScript((value) => {
      if (sessionStorage.getItem("issue2331-seeded") === null) {
        localStorage.setItem("mingla_consent_v1", value);
        sessionStorage.setItem("issue2331-seeded", "1");
      }
    }, JSON.stringify({ choice, ts: 1 }));
    const rec = await install(context);
    const page = await context.newPage();
    await page.goto(`${APP}/e/${BRAND_SLUG}/${EVENT_SLUG}`);
    await expect(page.getByText("Neighbors Night A").first()).toBeVisible();
    await page.waitForTimeout(5000);
    await expect(page.getByTestId("privacy-strip")).toBeVisible();
    await expect(page.getByTestId("privacy-sheet")).toHaveCount(0);
    expect(vendorsSeen(rec).size).toBe(on ? 6 : 0);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--mingla-privacy-inset").trim())).toBe("28px");
    await context.close();
  });
}

test("the switches always match what is loaded, through every save", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 768, height: 1024 } });
  const rec = await install(context);
  const page = await context.newPage();
  await page.goto(`${APP}/e/${BRAND_SLUG}/${EVENT_SLUG}`);
  await expect.poll(() => vendorsSeen(rec).size, { timeout: 20_000 }).toBe(6);
  for (const [analytics, ads] of [
    [false, true],
    [true, false],
    [true, true],
  ] as const) {
    await page.getByTestId("privacy-strip").click();
    await page.getByTestId("privacy-switch-analytics").setChecked(analytics);
    await page.getByTestId("privacy-switch-ads").setChecked(ads);
    await page.getByTestId("privacy-bar-save").click();
    await expect(page.getByTestId("privacy-strip")).toHaveText("Saved");
    const loaded = await page.evaluate(() => ({
      ga: document.querySelector("script[data-mingla-ga4]") !== null,
      pixels: (window as unknown as { __minglaAdPixelsBootstrapped?: boolean }).__minglaAdPixelsBootstrapped === true,
    }));
    expect(loaded).toEqual({ ga: analytics, pixels: ads });
    await page.evaluate(() => window.dispatchEvent(new Event("mingla:privacy-choices")));
    await expect(page.getByTestId("privacy-switch-analytics")).toBeChecked({ checked: analytics });
    await expect(page.getByTestId("privacy-switch-ads")).toBeChecked({ checked: ads });
    await page.keyboard.press("Escape");
  }
  await context.close();
});
