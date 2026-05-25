/**
 * ORCH-0961 RETEST runtime spec.
 *
 * Verifies the rework at commit d3133370a fixes prior QA FAIL findings:
 *   F-1: exactly one runtime Share button on /e/* (shared chrome suppressed).
 *   F-2: visible Close button on Playwright iPhone 13 simulation (testID handle).
 *
 * Static server serves `web-build-orch0961-retest` exported from the rework
 * commit. Real Supabase env (dev anon key) is honored at runtime; we route-mock
 * only `claimed_venues_public_view` per the prior QA report's documented
 * permission-denied bypass.
 */

import { devices, expect, test, type Page, type Route } from "@playwright/test";

const PORT = Number(process.env.ORCH_0961_PORT ?? 43197);
const BASE = `http://127.0.0.1:${PORT}`;

const BRAND_SLUG = "leggothis";
const EVENT_SLUG =
  "runtime-share-test-freeta-throwaway-free-ticket-qa-event-for-testing-public-links-and-share-buttons";

const installClaimedVenuesMock = async (page: Page): Promise<void> => {
  // Per ORCH-0961 v1 QA §4 — dev anon receives "permission denied for table
  // brands" preflight on this view. Route-mock to [] keeps the rest of the
  // public brand/event resolution intact.
  await page.route(
    (url) =>
      url.pathname.includes("claimed_venues_public_view") ||
      url.search.includes("claimed_venues_public_view"),
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify([]),
      }),
  );
};

test.describe("ORCH-0961 rework — public page chrome runtime gate", () => {
  test.beforeEach(async ({ page }) => {
    await installClaimedVenuesMock(page);
  });

  test("brand page renders the testID Close handle", async ({ page }, info) => {
    await page.goto(`${BASE}/b/${BRAND_SLUG}`, { waitUntil: "networkidle" });
    await expect(
      page.getByTestId("orch-0961-public-brand-close"),
    ).toBeVisible({ timeout: 15_000 });
    await page.screenshot({
      path: `../Mingla_Artifacts/reports/screenshots/orch0961-retest-brand-${info.project.name}.png`,
      fullPage: false,
    });
  });

  test("brand page renders the testID Share handle", async ({ page }) => {
    await page.goto(`${BASE}/b/${BRAND_SLUG}`, { waitUntil: "networkidle" });
    await expect(
      page.getByTestId("orch-0961-public-brand-share"),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("event page renders the testID Close handle", async ({ page }, info) => {
    await page.goto(`${BASE}/e/${BRAND_SLUG}/${EVENT_SLUG}`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByTestId("orch-0961-public-event-close"),
    ).toBeVisible({ timeout: 15_000 });
    await page.screenshot({
      path: `../Mingla_Artifacts/reports/screenshots/orch0961-retest-event-${info.project.name}.png`,
      fullPage: false,
    });
  });

  test("event page has EXACTLY ONE Share control (F-1 gate)", async ({ page }) => {
    await page.goto(`${BASE}/e/${BRAND_SLUG}/${EVENT_SLUG}`, {
      waitUntil: "networkidle",
    });
    // Wait for the adapter's testID Share to appear so the shared renderer
    // also had time to mount (or be suppressed).
    await expect(
      page.getByTestId("orch-0961-public-event-share"),
    ).toBeVisible({ timeout: 15_000 });

    // F-1 contract: with `hideFloatingChrome={true}` on the shared renderer,
    // only the adapter IconChrome remains. Two `Share` buttons would mean
    // the shared chrome leaked back in.
    const shareCount = await page.getByRole("button", { name: "Share" }).count();
    expect(shareCount).toBe(1);
  });
});
