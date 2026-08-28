import { expect, test, type Page } from "@playwright/test";

const harness = "http://127.0.0.1:42769";
const choice = (value: "granted" | "denied"): string =>
  JSON.stringify({ choice: value, ts: 1 });

async function venueScrollTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const owner = Array.from(document.querySelectorAll<HTMLElement>("*"))
      .find((element) => {
        const style = getComputedStyle(element);
        return /(auto|scroll)/.test(style.overflowY) &&
          element.scrollHeight > element.clientHeight &&
          element.closest("[aria-label='Cookie consent']") === null;
      });
    return owner?.scrollTop ?? 0;
  });
}

test("fresh phone consent is bounded, nonmodal, and the reserve action reveals once without a jump", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(harness);
  const region = page.getByRole("region", { name: "Cookie consent" });
  await expect(region).toHaveCount(1);
  await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(0);
  await expect(page.getByTestId("issue-2729-reserve-bar")).toHaveCount(0);
  expect(await region.getAttribute("aria-modal")).toBeNull();
  expect(await region.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe("none");

  const shell = page.getByTestId("orch-1255-public-venue");
  // The exact native scroll owner is selected by the same computed-style
  // contract as #2729; the banner's internal reading band is excluded.
  await shell.evaluate(() => {
    const owner = Array.from(document.querySelectorAll<HTMLElement>("*"))
      .find((element) => /(auto|scroll)/.test(getComputedStyle(element).overflowY) &&
        element.scrollHeight > element.clientHeight &&
        element.closest("[aria-label='Cookie consent']") === null);
    if (owner) owner.scrollTop = 360;
  });
  const before = await venueScrollTop(page);

  await page.getByTestId("issue-2769-consent-manage").click();
  await expect(page.getByText("Analytics help us improve Mingla")).toBeVisible();
  await page.getByTestId("issue-2769-consent-reject").click();
  await expect(region).toHaveCount(0);
  await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
  expect(await venueScrollTop(page)).toBe(before);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mingla_consent_v1") ?? "null")?.choice)).toBe("denied");

  await page.getByTestId("issue-2729-reserve-cta").click();
  await expect(page.getByTestId("issue-2769-sheet")).toHaveCount(1);
  expect(await page.evaluate(() => window.__issue2769Analytics.filter((event) => event === "public_venue_reservation_started").length)).toBe(1);
});

test("the consent decision band stays reachable at 320x568, landscape, and effective 200 percent zoom", async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 844, height: 390 },
    { width: 195, height: 422 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(harness);
    await page.getByTestId("issue-2769-consent-manage").click();
    const region = page.getByRole("region", { name: "Cookie consent" });
    const box = await region.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await expect(page.getByTestId("issue-2769-consent-accept")).toBeVisible();
    await expect(page.getByTestId("issue-2769-consent-reject")).toBeVisible();
    await expect(page.getByTestId("issue-2769-consent-manage")).toBeVisible();
  }
});

test("1279 suppresses the colliding desktop action while the proven-safe 1280 layout keeps both", async ({ page }) => {
  await page.setViewportSize({ width: 1279, height: 720 });
  await page.goto(harness);
  await expect(page.getByRole("region", { name: "Cookie consent" })).toHaveCount(1);
  await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByRole("region", { name: "Cookie consent" })).toHaveCount(1);
  await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
});

test("returning choices skip the invitation and preserve reservations-tab absence", async ({ browser }) => {
  for (const stored of ["denied", "granted"] as const) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(([key, value]) => localStorage.setItem(key, value), ["mingla_consent_v1", choice(stored)]);
    const page = await context.newPage();
    await page.goto(harness);
    await expect(page.getByRole("region", { name: "Cookie consent" })).toHaveCount(0);
    await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
    await page.goto(`${harness}/?tab=reservations`);
    await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(0);
    await context.close();
  }
});

test("an accepted choice resolves the page even when persistence is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new Error("storage unavailable"); };
  });
  await page.goto(harness);
  await page.getByTestId("issue-2769-consent-accept").click();
  await expect(page.getByRole("region", { name: "Cookie consent" })).toHaveCount(0);
  await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
});

test("keyboard focus reaches Manage, Reject, and Accept with visible focus treatment", async ({ page }) => {
  await page.goto(harness);
  const privacy = page.getByRole("link", { name: "Privacy Policy" });
  await privacy.focus();
  await expect(privacy).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("issue-2769-consent-accept")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("issue-2769-consent-reject")).toBeFocused();
  await page.keyboard.press("Tab");
  const manage = page.getByTestId("issue-2769-consent-manage");
  await expect(manage).toBeFocused();
  expect(await manage.evaluate((node) => getComputedStyle(node).outlineWidth)).toBe("2px");
});
