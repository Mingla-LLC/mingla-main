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

// #4318 regression: the always-present (hidden) privacy sheet must never read as
// an open dialog or swallow Escape. The home menu closes on Escape with the
// privacy sheet closed, before hydration (no handler touches Escape) and after.
test("#4318 usemingla.com: Escape still closes the home menu with the privacy sheet closed", async ({ page, context }) => {
  test.setTimeout(240_000);
  await page.goto("/", { waitUntil: "load" });

  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return route.abort("blockedbyclient");
    if (url.pathname.startsWith("/_next/static/chunks/")) await gate;
    return route.fallback();
  });
  await context.addInitScript(() => {
    const seen: Array<{ prevented: boolean; stopped: boolean }> = [];
    (window as unknown as { __issue4318Escapes: typeof seen }).__issue4318Escapes = seen;
    // Last in the bubble path: did anything before it prevent or stop Escape?
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") seen.push({ prevented: event.defaultPrevented, stopped: false });
    });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // Before hydration, with the privacy sheet closed: nothing is a dialog and
  // Escape passes through untouched.
  await expect(page.getByTestId("privacy-sheet")).toBeHidden();
  expect(await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length)).toBe(0);
  await page.locator("body").press("Escape");
  expect(await page.evaluate(() => (window as unknown as { __issue4318Escapes: unknown[] }).__issue4318Escapes)).toEqual([{ prevented: false, stopped: false }]);

  release();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __minglaPrivacyHydrated?: boolean }).__minglaPrivacyHydrated === true), { timeout: 120_000 }).toBe(true);
  // The pre-hydration handler has removed its listeners.
  expect(await page.evaluate(() => (window as unknown as { __minglaPrivacyPrehydrationOff?: unknown }).__minglaPrivacyPrehydrationOff)).toBeUndefined();

  // After hydration: open the menu, Escape closes it, no dialog is left.
  // #4339: the redesigned site menu is a disclosure (aria-expanded on its
  // button, "Open menu" / "Close menu"), not a dialog; Escape closes it and
  // puts focus back on the button, with the privacy sheet still closed.
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open menu" })).toHaveAttribute("aria-expanded", "false", { timeout: 6_000 });
  expect(await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length)).toBe(0);
  await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
  await expect(page.getByTestId("privacy-sheet")).toBeHidden();
});
