// MINGLA-INVARIANT: I-PRIVACY-BAR-NEVER-OCCLUDES | issue #2331 | While the privacy bar shows, collapsed or expanded, every visible control on every mingla-business web route owns the point at its own centre; the bar is full-bleed and the app root ends above it via --mingla-privacy-inset.
//
// #2331 implementor happy path. Real `expo export -p web` (local Supabase
// stand-in, vendors fulfilled locally and recorded) plus the real-source venue
// harness. How to run:
//   EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54331 EXPO_PUBLIC_SUPABASE_ANON_KEY=issue2331-anon \
//   EXPO_PUBLIC_POSTHOG_KEY=phc_issue2331 EXPO_PUBLIC_GA4_MEASUREMENT_ID=G-ISSUE2331 \
//   EXPO_PUBLIC_META_PIXEL_ID=2331000000000 EXPO_PUBLIC_TIKTOK_PIXEL_CODE=ISSUE2331TT \
//   EXPO_PUBLIC_SNAP_PIXEL_ID=issue-2331-snap EXPO_PUBLIC_REDDIT_PIXEL_ID=t2_issue2331 \
//   npx expo export -p web --output-dir /tmp/dist2331 --clear
//   DIST_2331=/tmp/dist2331 npx playwright test --config playwright.issue2331.config.ts
import { expect, test } from "@playwright/test";
import {
  APP,
  BRAND_SLUG,
  EVENT_SLUG,
  PAGES,
  SIZES,
  auditOcclusion,
  install,
  scrollToEnd,
  vendorsSeen,
} from "./harness";

const ALL_VENDORS = ["posthog", "ga", "meta", "tiktok", "snap", "reddit"] as const;
const PIXELS = ["meta", "tiktok", "snap", "reddit"] as const;

for (const size of SIZES) {
  test(`${size.width}x${size.height}: the bar is full-bleed, 53px, and covers no control on any page`, async ({ browser }) => {
    for (const target of PAGES) {
      const context = await browser.newContext({ viewport: size });
      await install(context, { signedIn: target.signedIn });
      const page = await context.newPage();
      await page.goto(target.url);
      await expect(page.getByTestId("privacy-bar")).toBeVisible();
      await page.waitForTimeout(target.signedIn === true ? 5000 : 1500);
      for (const phase of ["top", "scrolled to the end"] as const) {
        if (phase !== "top") await scrollToEnd(page);
        const report = await auditOcclusion(page);
        const where = `${target.name} @ ${size.width}x${size.height} (${phase})`;
        expect(report.barWidth, where).toBe(report.innerWidth);
        expect(Math.round(report.barHeight), where).toBe(53);
        expect(report.inset, where).toBe("53px");
        expect(report.checked, where).toBeGreaterThan(0);
        expect(report.covered, where).toEqual([]);
      }
      await context.close();
    }
  });
}

test("the event page ends with Your privacy choices, above the bar, and it reopens the bar expanded", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
  await install(context);
  const page = await context.newPage();
  await page.goto(`${APP}/e/${BRAND_SLUG}/${EVENT_SLUG}`);
  await page.getByTestId("privacy-bar-ok").click();
  await expect(page.getByTestId("privacy-bar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ad privacy choices" })).toHaveCount(0);
  await scrollToEnd(page);
  await page.getByTestId("privacy-choices-link").first().click();
  await expect(page.getByTestId("privacy-panel")).toBeVisible();
  await expect(page.getByTestId("privacy-switch-analytics")).toBeChecked();
  await expect(page.getByTestId("privacy-switch-ads")).toBeChecked();
  expect((await auditOcclusion(page)).covered).toEqual([]);
  await context.close();
});

test("first visit: every vendor starts before any tap; analytics off stops PostHog + GA; turning it back on restarts it", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 412, height: 718 } });
  const rec = await install(context);
  const page = await context.newPage();
  await page.goto(`${APP}/e/${BRAND_SLUG}/${EVENT_SLUG}`);
  await expect(page.getByTestId("privacy-bar")).toBeVisible();
  await expect.poll(() => [...vendorsSeen(rec)].sort(), { timeout: 20_000 }).toEqual([...ALL_VENDORS].sort());

  await page.getByTestId("privacy-bar-options").click();
  await expect(page.getByTestId("privacy-switch-analytics")).toBeChecked();
  await expect(page.getByTestId("privacy-switch-ads")).toBeChecked();
  await page.getByTestId("privacy-switch-analytics").uncheck();
  await page.getByTestId("privacy-bar-save").click();
  await expect(page.getByTestId("privacy-toast")).toHaveText("Analytics is off");
  const off = Date.now();
  expect(await page.evaluate(() => document.cookie.split(";").map((c) => c.trim().split("=")[0]).filter((n) => /^(_ga|ph_)/.test(n)))).toEqual([]);
  // Interact (autocapture would fire on clicks) and give batching time to flush.
  await scrollToEnd(page);
  await page.mouse.click(200, 200);
  await page.waitForTimeout(6000);
  expect(vendorsSeen(rec, off).has("posthog")).toBe(false);
  expect(vendorsSeen(rec, off).has("ga")).toBe(false);
  expect(await page.evaluate(() => typeof (window as unknown as { fbq?: unknown }).fbq)).toBe("function");

  const reloadAt = Date.now();
  await page.reload();
  await expect(page.getByText("Neighbors Night A").first()).toBeVisible();
  await page.waitForTimeout(5000);
  await expect(page.getByTestId("privacy-bar")).toHaveCount(0);
  const afterReload = vendorsSeen(rec, reloadAt);
  expect(afterReload.has("posthog")).toBe(false);
  expect(afterReload.has("ga")).toBe(false);
  for (const pixel of PIXELS) expect(afterReload.has(pixel), pixel).toBe(true);
  await scrollToEnd(page);
  await page.getByTestId("privacy-choices-link").first().click();
  await expect(page.getByTestId("privacy-switch-analytics")).not.toBeChecked();
  await expect(page.getByTestId("privacy-switch-ads")).toBeChecked();

  // Turn analytics back on: it restarts on this page without a reload.
  await page.getByTestId("privacy-switch-analytics").check();
  const on = Date.now();
  await page.getByTestId("privacy-bar-save").click();
  await expect(page.getByTestId("privacy-toast")).toHaveText("Saved");
  await expect.poll(() => vendorsSeen(rec, on).has("posthog"), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => vendorsSeen(rec, on).has("ga"), { timeout: 20_000 }).toBe(true);
  await context.close();
});

test("Turn off all: nothing goes to any vendor afterwards, on this page or after a reload", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const rec = await install(context);
  const page = await context.newPage();
  await page.goto(`${APP}/e/${BRAND_SLUG}/${EVENT_SLUG}`);
  await expect.poll(() => vendorsSeen(rec).size, { timeout: 20_000 }).toBe(ALL_VENDORS.length);
  await page.getByTestId("privacy-bar-options").click();
  await page.getByTestId("privacy-bar-off-all").click();
  await expect(page.getByTestId("privacy-toast")).toHaveText("Analytics and ads are off");
  const off = Date.now();
  await scrollToEnd(page);
  await page.mouse.click(200, 200);
  await page.waitForTimeout(5000);
  await page.reload();
  await expect(page.getByText("Neighbors Night A").first()).toBeVisible();
  await page.waitForTimeout(5000);
  expect([...vendorsSeen(rec, off)]).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mingla_privacy_v2") ?? "null"))).toMatchObject({ analytics: false, ads: false });
  await context.close();
});
