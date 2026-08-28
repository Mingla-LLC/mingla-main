import { expect, test, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const harness = pathToFileURL(
  path.join(__dirname, "../../node_modules/.cache/issue2729/index.html"),
).href;

type Point = { x: number; y: number };

async function touchPan(page: Page, start: Point, end: Point): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [start],
  });
  for (let step = 1; step <= 12; step += 1) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: start.x + ((end.x - start.x) * step) / 12,
          y: start.y + ((end.y - start.y) * step) / 12,
        },
      ],
    });
    await page.waitForTimeout(16);
  }
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await session.detach();
  await page.waitForTimeout(100);
}

async function scrollSnapshot(bar: Locator): Promise<{
  count: number;
  bodyOwned: boolean;
  barOwned: boolean;
  buttonOwned: boolean;
  top: number;
  max: number;
}> {
  return bar.evaluate((node) => {
    const vertical = Array.from(document.querySelectorAll<HTMLElement>("*")).filter(
      (element) => {
        const style = getComputedStyle(element);
        return (
          /(auto|scroll)/.test(style.overflowY) &&
          element.scrollHeight > element.clientHeight
        );
      },
    );
    const owner = vertical[0] ?? null;
    const button = document.querySelector<HTMLElement>(
      "[data-testid='issue-2729-reserve-cta']",
    );
    return {
      count: vertical.length,
      bodyOwned: owner === document.body || owner === document.documentElement,
      barOwned: owner?.contains(node) ?? false,
      buttonOwned: button !== null && (owner?.contains(button) ?? false),
      top: owner?.scrollTop ?? 0,
      max: owner === null ? 0 : owner.scrollHeight - owner.clientHeight,
    };
  });
}

async function scrollTop(bar: Locator): Promise<number> {
  return bar.evaluate((node) => {
    let current: HTMLElement | null = node.parentElement;
    while (current !== null) {
      const style = getComputedStyle(current);
      if (
        /(auto|scroll)/.test(style.overflowY) &&
        current.scrollHeight > current.clientHeight
      ) {
        return current.scrollTop;
      }
      current = current.parentElement;
    }
    return -1;
  });
}

async function panToLowerBoundary(page: Page, bar: Locator): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const box = await bar.boundingBox();
    expect(box).not.toBeNull();
    await touchPan(
      page,
      { x: 96, y: Math.max(92, (box?.y ?? 500) - 40) },
      { x: 96, y: 84 },
    );
    const snapshot = await scrollSnapshot(bar);
    if (Math.abs(snapshot.max - snapshot.top) <= 1) return;
  }
  const snapshot = await scrollSnapshot(bar);
  expect(snapshot.top).toBeCloseTo(snapshot.max, 0);
}

function analyticsCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      window.__issue2729Analytics.filter(
        (event) => event === "public_venue_reservation_started",
      ).length,
  );
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 402, height: 874 },
]) {
  test(`real touch reverses immediately from the CTA at ${viewport.width}px without a hidden second owner`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(harness);

    const bar = page.getByTestId("issue-2729-reserve-bar");
    const cta = page.getByTestId("issue-2729-reserve-cta");
    await expect(bar).toBeVisible();
    await expect(cta).toHaveCount(1);

    const initial = await scrollSnapshot(bar);
    expect(initial).toMatchObject({
      count: 1,
      bodyOwned: false,
      barOwned: true,
      buttonOwned: true,
    });
    expect(initial.max).toBeGreaterThan(0);

    const topGeometry = await bar.boundingBox();
    expect(topGeometry).not.toBeNull();
    expect(topGeometry?.x ?? -1).toBeCloseTo(0, 1);
    expect(topGeometry?.width ?? 0).toBeCloseTo(viewport.width, 1);
    expect((topGeometry?.y ?? 0) + (topGeometry?.height ?? 0)).toBeCloseTo(
      viewport.height,
      1,
    );
    expect((await cta.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(52);

    await panToLowerBoundary(page, bar);
    const lower = await scrollSnapshot(bar);
    expect(lower.top).toBeCloseTo(lower.max, 0);

    const lowerGeometry = await bar.boundingBox();
    const buttonGeometry = await cta.boundingBox();
    expect(lowerGeometry).not.toBeNull();
    expect(buttonGeometry).not.toBeNull();
    expect(
      Math.abs(
        (lowerGeometry?.y ?? 0) +
          (lowerGeometry?.height ?? 0) -
          viewport.height,
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      await bar.evaluate((node) => {
        const previous = node.previousElementSibling;
        if (!(previous instanceof HTMLElement)) return null;
        return node.getBoundingClientRect().top - previous.getBoundingClientRect().bottom;
      }),
    ).toBeCloseTo(8, 1);

    const beforeButtonReverse = await scrollTop(bar);
    await touchPan(
      page,
      {
        x: (buttonGeometry?.x ?? 0) + (buttonGeometry?.width ?? 0) / 2,
        y: (buttonGeometry?.y ?? 0) + 8,
      },
      {
        x: (buttonGeometry?.x ?? 0) + (buttonGeometry?.width ?? 0) / 2,
        y: viewport.height - 2,
      },
    );
    expect(await scrollTop(bar)).toBeLessThan(beforeButtonReverse - 1);
    await expect(page.getByTestId("issue-2729-sheet")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await analyticsCount(page)).toBe(0);

    await panToLowerBoundary(page, bar);
    const wrapperGeometry = await bar.boundingBox();
    const beforeWrapperReverse = await scrollTop(bar);
    await touchPan(
      page,
      { x: 4, y: (wrapperGeometry?.y ?? 0) + 4 },
      { x: 4, y: viewport.height - 2 },
    );
    expect(await scrollTop(bar)).toBeLessThan(beforeWrapperReverse - 1);
    await expect(page.getByTestId("issue-2729-sheet")).toHaveCount(0);
    expect(await analyticsCount(page)).toBe(0);
  });
}

test("Menu, Reservations, keyboard focus, and intentional activation preserve one state path", async ({
  page,
}) => {
  await page.goto(harness);
  const overview = page.getByRole("tab", { name: "Overview" });
  const menu = page.getByRole("tab", { name: "Menu" });
  const reservations = page.getByRole("tab", { name: "Reservations" });

  await menu.click();
  await expect(menu).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Hamburger")).toBeVisible();
  await page.waitForTimeout(250);
  await expect(menu).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("issue-2729-reserve-bar")).toHaveCount(1);

  await reservations.click();
  await expect(reservations).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Booking body")).toBeVisible();
  await expect(page.getByTestId("issue-2729-reserve-bar")).toHaveCount(0);
  expect(await analyticsCount(page)).toBe(0);

  await overview.click();
  await expect(overview).toHaveAttribute("aria-selected", "true");
  const cta = page.getByTestId("issue-2729-reserve-cta");
  await expect(cta).toBeVisible();
  await cta.focus();
  await expect(cta).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("issue-2729-sheet")).toHaveCount(1);
  await expect(reservations).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("issue-2729-reserve-bar")).toHaveCount(0);
  expect(await analyticsCount(page)).toBe(1);
  await page.keyboard.press("Enter");
  expect(await analyticsCount(page)).toBe(1);
});

test("desktop preserves document scrolling and never mounts the phone reserve band", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(harness);
  await expect(page.getByTestId("issue-2729-reserve-bar")).toHaveCount(0);
  const desktopCta = page.getByTestId("issue-2729-reserve-cta");
  await expect(desktopCta).toHaveCount(1);
  await expect(desktopCta).toBeVisible();

  const desktopOwner = page.locator("*").filter({
    has: page.getByText("WHERE YOU'LL BE", { exact: true }),
  });
  const desktopScrollTop = (): Promise<number> =>
    page.evaluate(() => {
      const owner = Array.from(document.querySelectorAll<HTMLElement>("*")).find(
        (element) => {
          const style = getComputedStyle(element);
          return (
            /(auto|scroll)/.test(style.overflowY) &&
            element.scrollHeight > element.clientHeight
          );
        },
      );
      return owner?.scrollTop ?? window.scrollY;
    });
  await expect(desktopOwner.first()).toBeAttached();
  const before = await desktopScrollTop();
  await page.mouse.wheel(0, 800);
  await expect.poll(desktopScrollTop).toBeGreaterThan(before);
  const afterWheel = await desktopScrollTop();
  await page.locator("body").click({ position: { x: 600, y: 850 } });
  await page.keyboard.press("PageUp");
  await expect.poll(desktopScrollTop).toBeLessThan(afterWheel);
  await page.keyboard.press("Home");
  await expect.poll(desktopScrollTop).toBe(0);

  await desktopCta.focus();
  await expect(desktopCta).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("issue-2729-sheet")).toHaveCount(1);
  expect(await analyticsCount(page)).toBe(1);
});
