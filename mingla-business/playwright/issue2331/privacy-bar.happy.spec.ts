// MINGLA-INVARIANT: I-PRIVACY-BAR-NEVER-OCCLUDES | issue #2331 | The privacy strip is always shown and every visible control on every mingla-business web route owns the point at its own centre; the strip is full-bleed and the app root ends above it via --mingla-privacy-inset.
//
// #2331 → #4318 implementor happy path. The bar is now one permanent 28px
// "Privacy & ad choices" strip (no first-visit banner, no OK, no toast).
// Real `expo export -p web` (local Supabase stand-in, vendors fulfilled locally
// and recorded) plus the real-source venue harness. How to run:
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
  test(`${size.width}x${size.height}: the strip is full-bleed, 28px, and covers no control on any page`, async ({ browser }) => {
    for (const target of PAGES) {
      const context = await browser.newContext({ viewport: size });
      await install(context, { signedIn: target.signedIn });
      const page = await context.newPage();
      await page.goto(target.url);
      await expect(page.getByTestId("privacy-strip")).toBeVisible();
      await page.waitForTimeout(target.signedIn === true ? 5000 : 1500);
      for (const phase of ["top", "scrolled to the end"] as const) {
        if (phase !== "top") await scrollToEnd(page);
        const report = await auditOcclusion(page);
        const where = `${target.name} @ ${size.width}x${size.height} (${phase})`;
        expect(report.barWidth, where).toBe(report.innerWidth);
        expect(Math.round(report.barHeight), where).toBe(28);
        expect(report.inset, where).toBe("28px");
        expect(report.checked, where).toBeGreaterThan(0);
        expect(report.covered, where).toEqual([]);
      }
      await context.close();
    }
  });
}

test("first visit: the strip is there, no banner, no OK; every vendor starts before any tap", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const rec = await install(context);
  const page = await context.newPage();
  await page.goto(`${APP}/e/${BRAND_SLUG}/${EVENT_SLUG}`);
  await expect(page.getByTestId("privacy-strip")).toHaveText("Privacy & ad choices");
  await expect(page.getByTestId("privacy-sheet")).toHaveCount(0);
  await expect(page.getByText("Mingla uses cookies for analytics and ads.")).toHaveCount(0);
  await expect(page.getByText(/privacy choices/i)).toHaveCount(0);
  await expect.poll(() => [...vendorsSeen(rec)].sort(), { timeout: 20_000 }).toEqual([...ALL_VENDORS].sort());
  await context.close();
});

test("the strip opens the choices; Save turns analytics and ads off, then on again, and shows Saved", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 412, height: 718 } });
  const rec = await install(context);
  const page = await context.newPage();
  await page.goto(`${APP}/e/${BRAND_SLUG}/${EVENT_SLUG}`);
  await expect.poll(() => vendorsSeen(rec).size, { timeout: 20_000 }).toBe(ALL_VENDORS.length);

  await page.getByTestId("privacy-strip").click();
  await expect(page.getByTestId("privacy-sheet")).toBeVisible();
  await expect(page.getByTestId("privacy-switch-analytics")).toBeChecked();
  await expect(page.getByTestId("privacy-switch-ads")).toBeChecked();
  await page.getByTestId("privacy-switch-analytics").uncheck();
  await page.getByTestId("privacy-switch-ads").uncheck();
  await page.getByTestId("privacy-bar-save").click();
  await expect(page.getByTestId("privacy-strip")).toHaveText("Saved");
  await expect(page.getByTestId("privacy-sheet")).toHaveCount(0);
  await expect(page.getByTestId("privacy-strip")).toBeFocused();
  const off = Date.now();
  await scrollToEnd(page);
  await page.mouse.click(200, 200);
  await page.waitForTimeout(6000);
  expect([...vendorsSeen(rec, off)]).toEqual([]);
  await expect(page.getByTestId("privacy-strip")).toHaveText("Privacy & ad choices");

  const reloadAt = Date.now();
  await page.reload();
  await expect(page.getByText("Neighbors Night A").first()).toBeVisible();
  await page.waitForTimeout(5000);
  expect([...vendorsSeen(rec, reloadAt)]).toEqual([]);
  await expect(page.getByTestId("privacy-strip")).toBeVisible();

  await page.getByTestId("privacy-strip").click();
  await expect(page.getByTestId("privacy-switch-analytics")).not.toBeChecked();
  await expect(page.getByTestId("privacy-switch-ads")).not.toBeChecked();
  await page.getByTestId("privacy-switch-analytics").check();
  await page.getByTestId("privacy-switch-ads").check();
  const on = Date.now();
  await page.getByTestId("privacy-bar-save").click();
  await expect(page.getByTestId("privacy-strip")).toHaveText("Saved");
  await expect.poll(() => vendorsSeen(rec, on).has("posthog"), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => vendorsSeen(rec, on).has("ga"), { timeout: 20_000 }).toBe(true);
  for (const pixel of PIXELS) await expect.poll(() => vendorsSeen(rec, on).has(pixel), { timeout: 20_000 }).toBe(true);
  await context.close();
});
