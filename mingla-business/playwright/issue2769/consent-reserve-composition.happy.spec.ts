// [TEST-MOD-APPROVED #2331] #2769 hid the venue reserve action under 1280px
// while a floating consent card was unresolved. #2331 replaces that card with
// one slim full-width privacy bar the app root ends above: the reserve action
// always shows, sits above the bar, and the bar is never the thing a tap hits.
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

test("fresh phone visit: bar and reserve action coexist, the action owns its tap, and OK hides the bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(harness);
  const bar = page.getByRole("region", { name: "Privacy choices" });
  await expect(bar).toHaveCount(1);
  await expect(page.getByText("Cookies for analytics and ads.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
  expect(await bar.getAttribute("aria-modal")).toBeNull();
  expect(await hitOwnsCentre(page, "issue-2729-reserve-cta")).toBe(true);
  const box = (await bar.boundingBox())!;
  expect(box.width).toBe(390);
  expect(Math.round(box.height)).toBe(53);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--mingla-privacy-inset").trim())).toBe("53px");

  await page.getByTestId("privacy-bar-ok").click();
  await expect(bar).toHaveCount(0);
  await expect(page.getByTestId("privacy-toast")).toHaveText("Saved");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--mingla-privacy-inset").trim())).toBe("0px");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mingla_privacy_v2") ?? "null"))).toMatchObject({ analytics: true, ads: true });

  await page.getByTestId("issue-2729-reserve-cta").click();
  await expect(page.getByTestId("issue-2769-sheet")).toHaveCount(1);
  expect(await page.evaluate(() => window.__issue2769Analytics.filter((event) => event === "public_venue_reservation_started").length)).toBe(1);
});

test("the collapsed bar stays one 53px row at 320x568, landscape and effective 200 percent zoom", async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 844, height: 390 },
    { width: 195, height: 422 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(harness);
    const box = (await page.getByRole("region", { name: "Privacy choices" }).boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBe(viewport.width);
    expect(Math.round(box.y + box.height)).toBe(viewport.height);
    expect(Math.round(box.height)).toBe(53);
    await expect(page.getByTestId("privacy-bar-ok")).toBeVisible();
    await expect(page.getByTestId("privacy-bar-options")).toBeVisible();
  }
});

test("1279 and 1280 both keep the reserve action, above the bar", async ({ page }) => {
  for (const width of [1279, 1280]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto(harness);
    await expect(page.getByRole("region", { name: "Privacy choices" })).toHaveCount(1);
    await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
    await page.getByTestId("issue-2729-reserve-cta").evaluate((node) => node.scrollIntoView({ block: "end" }));
    expect(await hitOwnsCentre(page, "issue-2729-reserve-cta")).toBe(true);
  }
});

test("carried-over v1 choices skip the bar and preserve reservations-tab absence", async ({ browser }) => {
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
    await expect(page.getByRole("region", { name: "Privacy choices" })).toHaveCount(0);
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

test("a choice hides the bar even when persistence is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new Error("storage unavailable"); };
  });
  await page.goto(harness);
  await page.getByTestId("privacy-bar-ok").click();
  await expect(page.getByRole("region", { name: "Privacy choices" })).toHaveCount(0);
  await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
});

test("the storage event reconciles another open venue page", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto(harness), second.goto(harness)]);
  await first.getByTestId("privacy-bar-options").click();
  await first.getByTestId("privacy-bar-off-all").click();
  await expect(second.getByRole("region", { name: "Privacy choices" })).toHaveCount(0);
  await expect(second.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
  await context.close();
});

test("keyboard: OK then Options; Options exposes aria-expanded and Esc returns focus", async ({ page }) => {
  await page.goto(harness);
  const ok = page.getByTestId("privacy-bar-ok");
  await ok.focus();
  await expect(ok).toBeFocused();
  await page.keyboard.press("Tab");
  const options = page.getByTestId("privacy-bar-options");
  await expect(options).toBeFocused();
  await expect(options).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(options).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("privacy-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("privacy-panel")).toHaveCount(0);
  await expect(options).toBeFocused();
});

test("after a choice there is no floating control; the in-page link reopens the bar expanded", async ({ page }) => {
  await page.goto(harness);
  await page.getByTestId("privacy-bar-ok").click();
  await expect(page.getByRole("button", { name: "Ad privacy choices" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Privacy choices" })).toHaveCount(0);
  await page.getByTestId("privacy-choices-link").click();
  await expect(page.getByTestId("privacy-panel")).toBeVisible();
  await expect(page.getByTestId("privacy-switch-analytics")).toBeChecked();
  await expect(page.getByTestId("privacy-switch-ads")).toBeChecked();
});
