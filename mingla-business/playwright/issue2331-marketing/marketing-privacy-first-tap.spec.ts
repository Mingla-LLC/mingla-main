// #4318 follow-up — usemingla.com: a tap on the "Privacy & ad choices" strip
// before the page hydrates did nothing (the strip is server-rendered, its
// handler is React's). The strip now ships with its sheet (hidden) and a tiny
// inline handler, so the first tap opens the sheet at once; on hydration the
// app takes the open sheet over with the switches as the visitor left them.
// This proof holds every Next.js chunk (no hydration), taps, asserts the sheet
// is fully visible in the first frame the scrim is, flips a switch, releases
// the chunks and asserts the app kept the sheet open with that switch.
import { expect, test, type Page } from "@playwright/test";

const VIEWPORT = { width: 390, height: 844 };

type FirstFrame = { sinceTapMs: number; scrimVisible: boolean; sheetOpacity: string; sheetTop: number; sheetBottom: number };

async function tapStrip(page: Page): Promise<FirstFrame> {
  const count = () => page.evaluate(() => (window as unknown as { __issue4318Frames: FirstFrame[] }).__issue4318Frames.length);
  const before = await count();
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height - 14);
  await expect.poll(count, { timeout: 2_000 }).toBe(before + 1);
  return page.evaluate((index) => (window as unknown as { __issue4318Frames: FirstFrame[] }).__issue4318Frames[index], before);
}

function expectSheetShownWithScrim(frame: FirstFrame) {
  expect(frame.sinceTapMs).toBeLessThanOrEqual(100);
  expect(frame.scrimVisible).toBe(true);
  expect(frame.sheetOpacity).toBe("1");
  expect(frame.sheetTop).toBeGreaterThanOrEqual(0);
  expect(frame.sheetTop).toBeLessThan(frame.sheetBottom);
  expect(frame.sheetBottom).toBeLessThanOrEqual(VIEWPORT.height - 28 + 12);
}

test.use({ viewport: VIEWPORT });

test("#4318 usemingla.com: the first tap before hydration opens the sheet, and the app keeps it open", async ({ page, context }) => {
  test.setTimeout(240_000);
  // Warm the dev server's compile so the held load below is only the hold.
  await page.goto("/support", { waitUntil: "load" });
  await context.clearCookies();
  await page.evaluate(() => window.localStorage.clear());

  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return route.abort("blockedbyclient");
    if (url.pathname.startsWith("/_next/static/chunks/")) await gate;
    return route.fallback();
  });
  await context.addInitScript(() => {
    const frames: FirstFrame[] = [];
    (window as unknown as { __issue4318Frames: FirstFrame[] }).__issue4318Frames = frames;
    window.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      if (!target || !target.closest("[data-testid='privacy-strip']")) return;
      const tappedAt = performance.now();
      requestAnimationFrame(() => {
        const shown = (node: Element | null): node is HTMLElement =>
          node instanceof HTMLElement && !node.hidden && getComputedStyle(node).display !== "none";
        const scrim = document.querySelector("[data-testid='privacy-scrim']");
        const sheet = document.querySelector("[data-testid='privacy-sheet']");
        const rect = shown(sheet) ? sheet.getBoundingClientRect() : null;
        frames.push({
          sinceTapMs: Math.round(performance.now() - tappedAt),
          scrimVisible: shown(scrim),
          sheetOpacity: shown(sheet) ? getComputedStyle(sheet).opacity : "none",
          sheetTop: rect ? Math.round(rect.top) : -1,
          sheetBottom: rect ? Math.round(rect.bottom) : -1,
        });
      });
    });
  });

  await page.goto("/support", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("privacy-strip")).toBeVisible();
  // Not hydrated: every chunk is held.
  expect(await page.evaluate(() => (window as unknown as { __minglaPrivacyHydrated?: boolean }).__minglaPrivacyHydrated === true)).toBe(false);

  expectSheetShownWithScrim(await tapStrip(page));
  await expect(page.getByTestId("privacy-switch-analytics")).toBeFocused();
  await page.getByTestId("privacy-switch-ads").uncheck();

  release();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __minglaPrivacyHydrated?: boolean }).__minglaPrivacyHydrated === true), { timeout: 120_000 }).toBe(true);

  // The app's sheet: still open, one of each, the visitor's switch kept.
  await expect(page.getByTestId("privacy-sheet")).toHaveCount(1);
  await expect(page.getByTestId("privacy-sheet")).toBeVisible();
  await expect(page.getByTestId("privacy-scrim")).toBeVisible();
  await expect(page.getByTestId("privacy-strip")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("privacy-switch-ads")).not.toBeChecked();
  await expect(page.getByTestId("privacy-switch-analytics")).toBeChecked();

  // Escape closes it with no scrim left; the app's strip reopens it.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("privacy-sheet")).toBeHidden();
  await expect(page.getByTestId("privacy-scrim")).toBeHidden();
  await expect(page.getByTestId("privacy-strip")).toBeFocused();
  expectSheetShownWithScrim(await tapStrip(page));
  // Nothing was saved by opening, flipping or closing.
  expect(await page.evaluate(() => window.localStorage.getItem("mingla_privacy_v2"))).toBeNull();
});
