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

  await expect(page.getByText("Ad privacy", { exact: true })).toBeVisible();
  await expect(page.getByText("We use cookies and advertising tools from Meta, Snapchat and TikTok to measure and improve our ads.")).toBeVisible();
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
    const region = page.getByRole("region", { name: "Cookie consent" });
    const box = await region.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await expect(page.getByTestId("issue-2769-consent-accept")).toBeVisible();
    await expect(page.getByTestId("issue-2769-consent-reject")).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy policy" })).toBeVisible();
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
    await context.route(
      /connect\.facebook\.net|analytics\.tiktok\.com|sc-static\.net|redditstatic\.com/,
      (route) => route.abort(),
    );
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

test("the canonical storage event reconciles another open venue page", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto(harness), second.goto(harness)]);
  await first.getByTestId("issue-2769-consent-reject").click();
  await expect(second.getByRole("region", { name: "Cookie consent" })).toHaveCount(0);
  await expect(second.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
  await context.close();
});

test("keyboard focus reaches Privacy policy, OK, and Opt out in that order", async ({ page }) => {
  await page.goto(harness);
  const privacy = page.getByRole("link", { name: "Privacy policy" });
  await privacy.focus();
  await expect(privacy).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("issue-2769-consent-accept")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("issue-2769-consent-reject")).toBeFocused();
  expect(await page.getByTestId("issue-2769-consent-reject").evaluate((node) => getComputedStyle(node).outlineWidth)).not.toBe("0px");
});

test("a settled choice exposes one control that reopens the exact privacy choices", async ({ page }) => {
  await page.goto(harness);
  await page.getByTestId("issue-2769-consent-accept").click();
  const choices = page.getByRole("button", { name: "Ad privacy choices" });
  await expect(choices).toBeVisible();
  await choices.click();
  await expect(page.getByRole("region", { name: "Cookie consent" })).toBeVisible();
  await expect(page.getByTestId("issue-2769-consent-reject")).toBeVisible();
});
