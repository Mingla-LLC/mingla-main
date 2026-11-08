// [TEST-MOD-APPROVED #2331] #2769 hid the venue reserve action under 1280px
// while a floating consent card was unresolved. #2331 replaced that card with
// one slim full-width privacy bar the app root ends above; #4318 (Seth) made it
// one permanent 28px "Privacy & ad choices" strip with no first-visit banner.
// The reserve action always shows, sits above the strip, and the strip is
// never the thing a tap hits.
import { expect, test, type Page } from "@playwright/test";

const harness = "http://127.0.0.1:42769";
const legacy = (value: "granted" | "denied"): string =>
  JSON.stringify({ choice: value, ts: 1 });

async function hitOwnsCentre(page: Page, testId: string): Promise<boolean> {
  return page.getByTestId(testId).evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)[0];
    return hit !== undefined && (hit === node || node.contains(hit));
  });
}

const inset = (page: Page): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--mingla-privacy-inset").trim());

for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
  test(`${viewport.width}x${viewport.height}: strip and reserve action coexist; the action owns its tap; no banner`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(harness);
    const strip = page.getByTestId("privacy-strip");
    await expect(strip).toBeVisible();
    await expect(strip).toHaveText("Privacy & ad choices");
    await expect(page.getByText("Cookies for analytics and ads.", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
    expect(await hitOwnsCentre(page, "issue-2729-reserve-cta")).toBe(true);
    expect(await hitOwnsCentre(page, "privacy-strip")).toBe(true);
    const box = (await strip.boundingBox())!;
    expect(box.width).toBe(viewport.width);
    expect(Math.round(box.height)).toBe(28);
    expect(Math.round(box.y + box.height)).toBe(viewport.height);
    const cta = (await page.getByTestId("issue-2729-reserve-cta").boundingBox())!;
    expect(cta.y + cta.height).toBeLessThanOrEqual(box.y + 0.5);
    expect(await inset(page)).toBe("28px");
    expect(await page.evaluate(() => localStorage.getItem("mingla_privacy_v2"))).toBeNull();
    await page.getByTestId("issue-2729-reserve-cta").click();
    await expect(page.getByTestId("issue-2769-sheet")).toHaveCount(1);
    expect(await page.evaluate(() => window.__issue2769Analytics.filter((event) => event === "public_venue_reservation_started").length)).toBe(1);
  });
}

test("the strip stays one 28px line at 320x568, landscape and effective 200 percent zoom", async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 844, height: 390 },
    { width: 195, height: 422 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(harness);
    const box = (await page.getByTestId("privacy-strip").boundingBox())!;
    expect(Math.round(box.height)).toBe(28);
    expect(box.width).toBe(viewport.width);
    expect(await hitOwnsCentre(page, "issue-2729-reserve-cta")).toBe(true);
  }
});

test("1279 and 1280 both keep the reserve action, above the strip", async ({ page }) => {
  for (const width of [1279, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(harness);
    await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
    await expect(page.getByTestId("privacy-strip")).toHaveCount(1);
  }
});

test("carried-over v1 choices keep the strip, open no sheet, and preserve reservations-tab absence", async ({ browser }) => {
  for (const stored of ["denied", "granted"] as const) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route(
      /connect\.facebook\.net|analytics\.tiktok\.com|sc-static\.net|redditstatic\.com/,
      (route) => route.abort(),
    );
    await context.addInitScript(([key, value]) => {
      if (sessionStorage.getItem("issue2331-seeded") === null) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("issue2331-seeded", "1");
      }
    }, ["mingla_consent_v1", legacy(stored)]);
    const page = await context.newPage();
    await page.goto(harness);
    await expect(page.getByTestId("privacy-strip")).toBeVisible();
    await expect(page.getByTestId("privacy-sheet")).toHaveCount(0);
    await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mingla_privacy_v2") ?? "null"))).toMatchObject({
      analytics: stored === "granted",
      ads: stored === "granted",
    });
    await page.goto(`${harness}/?tab=reservations`);
    await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(0);
    await context.close();
  }
});

test("Save closes the sheet and shows Saved even when persistence is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new Error("storage unavailable"); };
  });
  await page.goto(harness);
  await page.getByTestId("privacy-strip").click();
  await page.getByTestId("privacy-switch-ads").uncheck();
  await page.getByTestId("privacy-bar-save").click();
  await expect(page.getByTestId("privacy-sheet")).toHaveCount(0);
  await expect(page.getByTestId("privacy-strip")).toHaveText("Saved");
  await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
});

test("the storage event reconciles another open venue page", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto(harness), second.goto(harness)]);
  await first.getByTestId("privacy-strip").click();
  await first.getByTestId("privacy-switch-analytics").uncheck();
  await first.getByTestId("privacy-switch-ads").uncheck();
  await first.getByTestId("privacy-bar-save").click();
  await second.getByTestId("privacy-strip").click();
  await expect(second.getByTestId("privacy-switch-analytics")).not.toBeChecked();
  await expect(second.getByTestId("privacy-switch-ads")).not.toBeChecked();
  await expect(second.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
  await context.close();
});

test("keyboard: the strip opens the sheet, focus moves in, Escape closes and returns focus", async ({ page }) => {
  await page.goto(harness);
  const strip = page.getByTestId("privacy-strip");
  await strip.focus();
  await expect(strip).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(strip).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("privacy-sheet")).toBeVisible();
  await expect(page.getByTestId("privacy-switch-analytics")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("privacy-sheet")).toHaveCount(0);
  await expect(strip).toBeFocused();
});
