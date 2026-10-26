// #2331 adversarial proof (a different angle from the happy path): short and
// landscape viewports, the bar EXPANDED, a dialog opening over the bar, GPC,
// carried-over v1 choices, and the switches always matching what is loaded.
// Same harness and run instructions as privacy-bar.happy.spec.ts.
import { expect, test, type Page } from "@playwright/test";
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

async function expand(page: Page): Promise<void> {
  await page.getByTestId("privacy-bar-options").click();
  await expect(page.getByTestId("privacy-panel")).toBeVisible();
  await page.waitForTimeout(300);
}

for (const size of SHORT) {
  test(`${size.width}x${size.height}: expanded, the bar stays within 60% and still covers no control`, async ({ browser }) => {
    for (const target of PAGES) {
      const context = await browser.newContext({ viewport: size });
      await install(context, { signedIn: target.signedIn });
      const page = await context.newPage();
      await page.goto(target.url);
      await expect(page.getByTestId("privacy-bar")).toBeVisible();
      await page.waitForTimeout(target.signedIn === true ? 5000 : 1200);
      await expand(page);
      for (const phase of ["top", "scrolled to the end"] as const) {
        if (phase !== "top") await scrollToEnd(page);
        const report = await auditOcclusion(page);
        const where = `${target.name} @ ${size.width}x${size.height} expanded (${phase})`;
        expect(report.barWidth, where).toBe(report.innerWidth);
        expect(report.barHeight, where).toBeLessThanOrEqual(size.height * 0.6 + 0.5);
        expect(report.inset, where).toBe(`${Math.round(report.barHeight)}px`);
        expect(report.covered, where).toEqual([]);
      }
      // Collapsing returns the bar (and the inset) to one 53px row.
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("privacy-panel")).toHaveCount(0);
      const collapsed = await auditOcclusion(page);
      expect(Math.round(collapsed.barHeight)).toBe(53);
      expect(collapsed.inset).toBe("53px");
      await context.close();
    }
  });
}

test("a dialog opened over the page covers the bar (the bar sits below sheets and dialogs)", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
  await install(context);
  const page = await context.newPage();
  await page.goto(`${APP}/e/${BRAND_SLUG}/${EVENT_SLUG}`);
  await expect(page.getByTestId("privacy-bar")).toBeVisible();
  await page.getByRole("button", { name: /share/i }).first().click();
  await expect(page.locator("[role='dialog'], [aria-modal='true']").first()).toBeAttached();
  const hit = await page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>("[data-testid='privacy-bar']")!.getBoundingClientRect();
    const top = document.elementsFromPoint(bar.left + 40, bar.top + bar.height / 2)[0];
    return top?.closest("[data-testid='privacy-bar']") !== null && top !== undefined;
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
  await expect(page.getByTestId("privacy-bar")).toBeVisible();
  await expect.poll(() => vendorsSeen(rec).has("posthog"), { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(4000);
  for (const pixel of PIXELS) expect(vendorsSeen(rec).has(pixel), pixel).toBe(false);
  await expand(page);
  await expect(page.getByTestId("privacy-switch-analytics")).toBeChecked();
  await expect(page.getByTestId("privacy-switch-ads")).not.toBeChecked();
  // OK keeps what the switches show: ads stay off.
  await page.getByTestId("privacy-bar-options").click();
  await page.getByTestId("privacy-bar-ok").click();
  await expect(page.getByTestId("privacy-toast")).toHaveText("Ads are off");
  await page.waitForTimeout(2000);
  for (const pixel of PIXELS) expect(vendorsSeen(rec).has(pixel), pixel).toBe(false);
  await context.close();
});

for (const [choice, on] of [["denied", false], ["granted", true]] as const) {
  test(`a carried-over v1 ${choice} visitor sees no bar; vendors ${on ? "run" : "stay silent"}`, async ({ browser }) => {
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
    await expect(page.getByTestId("privacy-bar")).toHaveCount(0);
    expect(vendorsSeen(rec).size).toBe(on ? 6 : 0);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--mingla-privacy-inset").trim())).toBe("0px");
    await context.close();
  });
}

test("the switches always match what is loaded, through every save", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 768, height: 1024 } });
  const rec = await install(context);
  const page = await context.newPage();
  await page.goto(`${APP}/e/${BRAND_SLUG}/${EVENT_SLUG}`);
  await expect.poll(() => vendorsSeen(rec).size, { timeout: 20_000 }).toBe(6);
  for (const [analytics, ads, toast] of [
    [false, true, "Analytics is off"],
    [true, false, "Ads are off"],
    [true, true, "Saved"],
  ] as const) {
    if (await page.getByTestId("privacy-bar").count() === 0) {
      await page.evaluate(() => window.dispatchEvent(new Event("mingla:privacy-choices")));
    } else if (await page.getByTestId("privacy-panel").count() === 0) {
      await expand(page);
    }
    await page.getByTestId("privacy-switch-analytics").setChecked(analytics);
    await page.getByTestId("privacy-switch-ads").setChecked(ads);
    await page.getByTestId("privacy-bar-save").click();
    await expect(page.getByTestId("privacy-toast")).toHaveText(toast);
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
