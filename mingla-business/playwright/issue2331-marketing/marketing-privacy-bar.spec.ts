// #2331 → #4318 — usemingla.com: one permanent 28px "Privacy & ad choices"
// strip on every route, /links included, server-rendered from the first paint
// (no first-visit banner, no OK, no toast). I-PRIVACY-BAR-NEVER-OCCLUDES: /links
// and the home size themselves to calc(100dvh - inset) and never scroll; no
// control sits under the strip. I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF: PostHog + GA start on
// a first visit and stop after a turn-off.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const SIZES = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
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
    const strip = document.querySelector<HTMLElement>("[data-testid='privacy-strip']");
    const out: string[] = [];
    for (const node of Array.from(document.querySelectorAll<HTMLElement>("a[href], button"))) {
      if (strip?.contains(node)) continue;
      const r = node.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= innerHeight || getComputedStyle(node).visibility === "hidden") continue;
      const y = Math.min((r.top + r.bottom) / 2, innerHeight - 1);
      const hit = document.elementsFromPoint((r.left + r.right) / 2, y)[0];
      if (strip !== null && hit !== undefined && strip.contains(hit)) out.push((node.getAttribute("aria-label") ?? node.textContent ?? "").trim().slice(0, 40));
    }
    return out;
  });
}

for (const size of SIZES) {
  test(`${size.width}x${size.height}: /links shows the full-width strip, ends above it, and never scrolls`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: size });
    await record(context);
    const page = await context.newPage();
    await page.goto("/links");
    const strip = page.getByTestId("privacy-strip");
    await expect(strip).toBeVisible();
    await expect(strip).toHaveText("Privacy & ad choices");
    await page.waitForTimeout(800);
    const box = (await strip.boundingBox())!;
    expect(box.width).toBe(size.width);
    expect(Math.round(box.height)).toBe(28);
    const main = (await page.locator("main#main").boundingBox())!;
    expect(Math.round(main.height)).toBe(size.height - 28);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    expect(await underBar(page)).toEqual([]);
    await expect(page.getByTestId("privacy-choices-link")).toHaveCount(0);
    await expect(page.getByText(/privacy choices/i)).toHaveCount(0);
    await context.close();
  });
}

for (const size of SIZES) {
  test(`${size.width}x${size.height}: home (one screen) ends above the strip; no chip sits under it`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: size });
    await record(context);
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByTestId("privacy-strip")).toBeVisible();
    await page.waitForTimeout(2500);
    expect(await underBar(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    await context.close();
  });
}

test("the strip is in the server HTML (no banner, no OK) before any script runs", async ({ request }) => {
  for (const route of ["/", "/links", "/support"]) {
    const html = await (await request.get(route)).text();
    expect(html, route).toContain('data-testid="privacy-strip"');
    expect(html, route).toContain("Privacy &amp; ad choices");
    expect(html, route).not.toContain("Mingla uses cookies");
    expect(html, route).not.toMatch(/privacy choices/i);
  }
});

test("home: first visit starts analytics; the strip opens the choices; Save off stops it and shows Saved; Save on restarts it", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 412, height: 718 } });
  const hits = await record(context);
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByTestId("privacy-strip")).toBeVisible();
  await expect.poll(() => hits.some((h) => h.vendor === "ga"), { timeout: 30_000 }).toBe(true);
  await page.getByTestId("privacy-strip").click();
  await expect(page.getByTestId("privacy-sheet")).toBeVisible();
  await expect(page.getByTestId("privacy-switch-analytics")).toBeFocused();
  await expect(page.getByTestId("privacy-switch-analytics")).toBeChecked();
  await page.getByTestId("privacy-switch-analytics").uncheck();
  await page.getByTestId("privacy-switch-ads").uncheck();
  await page.getByTestId("privacy-bar-save").click();
  await expect(page.getByTestId("privacy-strip")).toHaveText("Saved");
  await expect(page.getByTestId("privacy-strip")).toBeFocused();
  const off = Date.now();
  await page.reload();
  await page.waitForTimeout(5000);
  expect(hits.filter((h) => h.at >= off).map((h) => h.vendor)).toEqual([]);
  await expect(page.getByTestId("privacy-strip")).toHaveText("Privacy & ad choices");
  await page.getByTestId("privacy-strip").click();
  await expect(page.getByTestId("privacy-switch-analytics")).not.toBeChecked();
  await page.getByTestId("privacy-switch-analytics").check();
  await page.getByTestId("privacy-switch-ads").check();
  const on = Date.now();
  await page.getByTestId("privacy-bar-save").click();
  await expect.poll(() => hits.some((h) => h.at >= on), { timeout: 30_000 }).toBe(true);
  await page.keyboard.press("Escape");
  expect(await underBar(page)).toEqual([]);
  await context.close();
});
