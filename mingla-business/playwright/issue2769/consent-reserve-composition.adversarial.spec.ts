// [TEST-MOD-APPROVED #2331] Adversarial angle on the composition: the privacy
// strip (#4318: permanent, 28px, no first-visit banner) and the reserve action
// coexist at every width, the action never sits under the strip or behind the
// open sheet's strip, and storage edge cases never make the switches disagree
// with what is saved.
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

async function ctaClearOfStrip(page: Page): Promise<{ owns: boolean; above: boolean }> {
  // Desktop keeps Reserve in the sticky side panel: bring it on screen first
  // (a sticky panel taller than the viewport releases at the end of the
  // scroll area, which ends above the strip: scroll the owner to its end).
  await page.getByTestId("issue-2729-reserve-cta").evaluate((node) => {
    const strip = document.querySelector<HTMLElement>("[data-testid='privacy-strip']")?.getBoundingClientRect();
    const limit = strip?.top ?? window.innerHeight;
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
    const strip = document.querySelector<HTMLElement>("[data-testid='privacy-strip']")?.getBoundingClientRect();
    return {
      owns: hit !== undefined && (hit === cta || cta.contains(hit)),
      above: strip === undefined || rect.bottom <= strip.top + 0.5,
    };
  });
}

test("every width keeps the action and the strip, side by side, never overlapping", async ({ browser }) => {
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [768, 1024], [1024, 768], [1279, 800], [1280, 800], [1920, 1080]] as const) {
    const page = await freshPage(browser, width, height);
    await expect(page.getByTestId("privacy-strip")).toHaveCount(1);
    await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
    expect(await ctaClearOfStrip(page), `${width}x${height}`).toEqual({ owns: true, above: true });
    await page.context().close();
  }
});

test("the open sheet never moves the strip, and closing it leaves the action where it was", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(loopback);
  const before = await page.getByTestId("issue-2729-reserve-cta").boundingBox();
  const strip = await page.getByTestId("privacy-strip").boundingBox();
  await page.getByTestId("privacy-strip").click();
  const sheet = (await page.getByTestId("privacy-sheet").boundingBox())!;
  expect(sheet.height).toBeLessThanOrEqual(568 * 0.8 + 0.5);
  expect(await page.getByTestId("privacy-strip").boundingBox()).toEqual(strip);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("privacy-sheet")).toHaveCount(0);
  expect(await page.getByTestId("issue-2729-reserve-cta").boundingBox()).toEqual(before);
});

test("the scrim closes the sheet and reopening never duplicates the action", async ({ page }) => {
  await page.goto(loopback);
  for (let index = 0; index < 3; index += 1) {
    await page.getByTestId("privacy-strip").click();
    await expect(page.getByTestId("privacy-sheet")).toHaveCount(1);
    await page.getByTestId("privacy-scrim").click({ position: { x: 10, y: 10 } });
    await expect(page.getByTestId("privacy-sheet")).toHaveCount(0);
    await expect(page.getByTestId("issue-2729-reserve-cta")).toHaveCount(1);
  }
});

test("malformed, partial and unavailable storage read as 'not chosen': both switches on", async ({ browser }) => {
  for (const seeded of ['{"analytics":true}', "not-json", '{"choice":"maybe"}']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript((value) => localStorage.setItem("mingla_privacy_v2", value), seeded);
    const page = await context.newPage();
    await page.goto(loopback);
    await expect(page.getByTestId("privacy-strip")).toBeVisible();
    await page.getByTestId("privacy-strip").click();
    await expect(page.getByTestId("privacy-switch-analytics")).toBeChecked();
    await expect(page.getByTestId("privacy-switch-ads")).toBeChecked();
    await context.close();
  }
});

test("a saved mixed choice reopens with exactly that state", async ({ page }) => {
  await page.goto(loopback);
  await page.getByTestId("privacy-strip").click();
  await page.getByTestId("privacy-switch-ads").uncheck();
  await page.getByTestId("privacy-bar-save").click();
  await expect(page.getByTestId("privacy-strip")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId("privacy-sheet")).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("mingla:privacy-choices")));
  await expect(page.getByTestId("privacy-switch-analytics")).toBeChecked();
  await expect(page.getByTestId("privacy-switch-ads")).not.toBeChecked();
});

test("both loopback aliases render the same strip", async ({ browser }) => {
  for (const origin of [loopback, localhost]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(origin);
    await expect(page.getByTestId("privacy-strip")).toHaveText("Privacy & ad choices");
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
