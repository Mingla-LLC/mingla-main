// [TEST-MOD-APPROVED #2331] Adversarial angle on the new composition: the
// slim bar and the reserve action coexist at every width, the action never
// sits under the bar (expanded or not), and storage edge cases never make the
// bar or the switches disagree with what is saved.
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

async function ctaClearOfBar(page: Page): Promise<{ owns: boolean; above: boolean }> {
  // Desktop keeps Reserve in the sticky side panel: bring it on screen first
  // (the phone bar is already pinned to the bottom of the scroll area).
  // (a sticky panel taller than the viewport releases at the end of the
  // scroll area, which ends above the bar: scroll the owner to its end).
  await page.getByTestId("issue-2729-reserve-cta").evaluate((node) => {
    const bar = document.querySelector<HTMLElement>("[data-testid='privacy-bar']")?.getBoundingClientRect();
    const limit = bar?.top ?? window.innerHeight;
    if (node.getBoundingClientRect().bottom <= limit + 0.5) return;
    let owner = node.parentElement;
    while (owner !== null && !(/(auto|scroll)/.test(getComputedStyle(owner).overflowY) && owner.scrollHeight > owner.clientHeight)) {
      owner = owner.parentElement;
    }
    if (owner !== null) owner.scrollTop = owner.scrollHeight;
  });
  return page.getByTestId("issue-2729-reserve-cta").evaluate((cta) => {
    const rect = cta.getBoundingClientRect();
    const hit = document.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)[0];
    const bar = document.querySelector<HTMLElement>("[data-testid='privacy-bar']")?.getBoundingClientRect();
    return {
      owns: hit !== undefined && (hit === cta || cta.contains(hit)),
      above: bar === undefined || rect.bottom <= bar.top + 0.5,
    };
  });
}

test("every width keeps the action and the bar, side by side, never overlapping", async ({ browser }) => {
  for (const [width, height] of [[320, 568], [390, 844], [402, 874], [1279, 640], [195, 422], [1280, 640], [1440, 900]] as const) {
    const page = await freshPage(browser, width, height);
    await expect(page.getByRole("region", { name: "Privacy choices" })).toHaveCount(1);
    await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
    expect(await ctaClearOfBar(page), `${width}x${height}`).toEqual({ owns: true, above: true });
    expect(await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth })))
      .toEqual({ doc: width, body: width });
    await page.context().close();
  }
});

test("expanded at 320x568 the bar stays within 60% of the screen and the action still rises above it", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(loopback);
  await page.getByTestId("privacy-bar-options").click();
  await expect(page.getByTestId("privacy-panel")).toBeVisible();
  await page.waitForTimeout(260);
  const box = (await page.getByRole("region", { name: "Privacy choices" }).boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(568 * 0.6 + 0.5);
  const inset = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--mingla-privacy-inset").trim());
  expect(inset).toBe(`${Math.round(box.height)}px`);
  expect(await ctaClearOfBar(page)).toEqual({ owns: true, above: true });
});

test("Esc collapses, Close collapses, and reopening never duplicates the action", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(loopback);
  await page.getByTestId("privacy-bar-options").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("privacy-panel")).toHaveCount(0);
  await page.getByTestId("privacy-bar-options").click();
  await page.getByTestId("privacy-bar-options").click();
  await expect(page.getByTestId("privacy-panel")).toHaveCount(0);
  await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
  await expect(page.getByTestId("issue-2729-reserve-bar")).toHaveCount(1);
});

test("the page keeps scrolling under the nonmodal bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(loopback);
  const scrolled = await page.evaluate(() => {
    const owner = Array.from(document.querySelectorAll<HTMLElement>("*")).find((element) =>
      /(auto|scroll)/.test(getComputedStyle(element).overflowY) &&
      element.scrollHeight > element.clientHeight &&
      element.closest("[data-testid='privacy-bar']") === null);
    if (!owner) return -1;
    owner.scrollTop = 200;
    return owner.scrollTop;
  });
  expect(scrolled).toBeGreaterThan(0);
});

test("malformed, partial and unavailable storage read as 'not chosen': bar shows with both switches on", async ({ browser }) => {
  for (const seeded of ['{"analytics":true}', "not-json", '{"choice":"maybe"}']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript((value) => localStorage.setItem("mingla_privacy_v2", value), seeded);
    const page = await context.newPage();
    await page.goto(loopback);
    await expect(page.getByRole("region", { name: "Privacy choices" })).toHaveCount(1);
    await page.getByTestId("privacy-bar-options").click();
    await expect(page.getByTestId("privacy-switch-analytics")).toBeChecked();
    await expect(page.getByTestId("privacy-switch-ads")).toBeChecked();
    await context.close();
  }
});

test("a saved mixed choice reopens with exactly that state", async ({ page }) => {
  await page.goto(loopback);
  await page.getByTestId("privacy-bar-options").click();
  await page.getByTestId("privacy-switch-ads").uncheck();
  await page.getByTestId("privacy-bar-save").click();
  await expect(page.getByTestId("privacy-toast")).toHaveText("Ads are off");
  await page.reload();
  await expect(page.getByRole("region", { name: "Privacy choices" })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("mingla:privacy-choices")));
  await expect(page.getByTestId("privacy-switch-analytics")).toBeChecked();
  await expect(page.getByTestId("privacy-switch-ads")).not.toBeChecked();
});

test("both loopback aliases render the same bar", async ({ browser }) => {
  for (const origin of [loopback, localhost]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(origin);
    await expect(page.getByRole("region", { name: "Privacy choices" })).toHaveCount(1);
    await context.close();
  }
});

test("route ownership and native exclusion stay explicit in production source", () => {
  const route = source("mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx");
  const layout = source("mingla-business/app/_layout.tsx");
  const native = source("mingla-business/src/analytics/ConsentBanner.tsx");
  expect(route).not.toContain("webConsentState");
  expect(layout).toContain("<ConsentBanner />");
  expect(native).toContain("return null;");
});
