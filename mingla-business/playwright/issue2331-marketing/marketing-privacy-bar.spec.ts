// #2331 — usemingla.com: the same slim bar on every route, /links included
// (the #905 suppression is retired). I-PRIVACY-BAR-NEVER-OCCLUDES: /links
// sizes itself to calc(100dvh - inset) and never scrolls; no control sits
// under the bar. I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF: PostHog + GA start on
// a first visit and stop after a turn-off.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const SIZES = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 412, height: 718 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
  { width: 2560, height: 1440 },
] as const;

type Hit = { vendor: string; at: number };

async function record(context: BrowserContext): Promise<Hit[]> {
  const hits: Hit[] = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return route.fallback();
    const vendor = /posthog\.com$/.test(url.hostname) ? "posthog"
      : /(googletagmanager|google-analytics)\.com$/.test(url.hostname) ? "ga" : null;
    if (vendor !== null) {
      hits.push({ vendor, at: Date.now() });
      return route.fulfill({ status: 200, contentType: "text/javascript", body: "", headers: { "Access-Control-Allow-Origin": "*" } });
    }
    return route.abort("blockedbyclient");
  });
  return hits;
}

async function underBar(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>("[data-testid='privacy-bar']");
    const out: string[] = [];
    for (const node of Array.from(document.querySelectorAll<HTMLElement>("a[href], button"))) {
      if (bar?.contains(node)) continue;
      const r = node.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= innerHeight || getComputedStyle(node).visibility === "hidden") continue;
      const y = Math.min((r.top + r.bottom) / 2, innerHeight - 1);
      const hit = document.elementsFromPoint((r.left + r.right) / 2, y)[0];
      if (bar !== null && hit !== undefined && bar.contains(hit)) out.push((node.getAttribute("aria-label") ?? node.textContent ?? "").trim().slice(0, 40));
    }
    return out;
  });
}

for (const size of SIZES) {
  test(`${size.width}x${size.height}: /links shows the full-width bar, ends above it, and never scrolls`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: size });
    await record(context);
    const page = await context.newPage();
    await page.goto("/links");
    const bar = page.getByTestId("privacy-bar");
    await expect(bar).toBeVisible();
    await page.waitForTimeout(800);
    const box = (await bar.boundingBox())!;
    expect(box.width).toBe(size.width);
    expect(Math.round(box.height)).toBe(53);
    const main = (await page.locator("main#main").boundingBox())!;
    expect(Math.round(main.height)).toBe(size.height - 53);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    expect(await underBar(page)).toEqual([]);
    await expect(page.getByTestId("privacy-choices-link")).toBeAttached();
    await context.close();
  });
}

for (const size of SIZES) {
  test(`${size.width}x${size.height}: home (one screen, no footer) ends above the bar; no chip sits under it`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: size });
    await record(context);
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByTestId("privacy-bar")).toBeVisible();
    await expect(page.getByRole("button", { name: "Privacy", exact: true })).toBeVisible();
    await page.waitForTimeout(2500);
    expect(await underBar(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    await context.close();
  });
}

test("home: first visit starts analytics; the privacy sheet reopens the bar; analytics off stops it", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 412, height: 718 } });
  const hits = await record(context);
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByTestId("privacy-bar")).toBeVisible();
  await expect.poll(() => hits.some((h) => h.vendor === "ga"), { timeout: 30_000 }).toBe(true);
  await page.getByTestId("privacy-bar-ok").click();
  await expect(page.getByTestId("privacy-bar")).toHaveCount(0);
  await page.getByRole("button", { name: "Privacy", exact: true }).click();
  await page.getByRole("dialog").getByTestId("privacy-choices-link").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("privacy-panel")).toBeVisible();
  await expect(page.getByTestId("privacy-switch-analytics")).toBeChecked();
  await page.getByTestId("privacy-switch-analytics").uncheck();
  await page.getByTestId("privacy-bar-save").click();
  await expect(page.getByTestId("privacy-toast")).toHaveText("Analytics is off");
  const off = Date.now();
  await page.reload();
  await page.waitForTimeout(5000);
  expect(hits.filter((h) => h.at >= off).map((h) => h.vendor)).toEqual([]);
  await expect(page.getByTestId("privacy-bar")).toHaveCount(0);
  expect(await underBar(page)).toEqual([]);
  await context.close();
});
