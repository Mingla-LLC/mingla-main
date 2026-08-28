import { expect, test, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const harness = pathToFileURL(
  path.join(__dirname, "../../node_modules/.cache/issue2729/index.html"),
).href;

async function dispatchTouchPan(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: start.x, y: start.y }],
  });
  for (let step = 1; step <= 10; step += 1) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: start.x + ((end.x - start.x) * step) / 10,
          y: start.y + ((end.y - start.y) * step) / 10,
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
  await page.waitForTimeout(150);
}

async function expectDocked(
  bar: Locator,
  viewport: { width: number; height: number },
): Promise<void> {
  const box = await bar.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width).toBeCloseTo(viewport.width, 0);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeCloseTo(viewport.height, 0);
}

test("the real phone venue keeps its persistent reserve band inside the sole native scroll owner", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) =>
    runtimeErrors.push(error.stack ?? error.message),
  );
  await page.goto(harness);
  const shell = page.getByTestId("orch-1255-public-venue");
  const bar = page.getByTestId("issue-2729-reserve-bar");
  const cta = page.getByTestId("issue-2729-reserve-cta");
  await expect(
    shell,
    `browser runtime errors: ${runtimeErrors.join(" | ")}`,
  ).toBeVisible();
  await expect(bar).toBeVisible();
  await expect(cta).toHaveCount(1);

  const ownership = await bar.evaluate((node) => {
    const vertical = Array.from(
      document.querySelectorAll<HTMLElement>("*"),
    ).filter((element) => {
      const style = getComputedStyle(element);
      return (
        /(auto|scroll)/.test(style.overflowY) &&
        element.scrollHeight > element.clientHeight
      );
    });
    const owner = vertical[0] ?? null;
    const button = document.querySelector<HTMLElement>(
      "[data-testid='issue-2729-reserve-cta']",
    );
    return {
      count: vertical.length,
      barOwned: owner?.contains(node) ?? false,
      buttonOwned: button !== null && (owner?.contains(button) ?? false),
      ownerHeight: owner?.clientHeight ?? 0,
      ownerScrollHeight: owner?.scrollHeight ?? 0,
    };
  });
  expect(ownership.count).toBe(1);
  expect(ownership.barOwned).toBe(true);
  expect(ownership.buttonOwned).toBe(true);
  expect(ownership.ownerScrollHeight).toBeGreaterThan(ownership.ownerHeight);

  await expectDocked(bar, { width: 390, height: 844 });
  expect((await cta.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(52);

  const scrollOwner = await bar.evaluateHandle((node) => {
    let current: HTMLElement | null = node.parentElement;
    while (current !== null) {
      const style = getComputedStyle(current);
      if (
        /(auto|scroll)/.test(style.overflowY) &&
        current.scrollHeight > current.clientHeight
      )
        return current;
      current = current.parentElement;
    }
    return null;
  });
  await scrollOwner.evaluate((node) => {
    (node as HTMLElement).scrollTop = 400;
  });
  await page.waitForTimeout(100);
  await expectDocked(bar, { width: 390, height: 844 });

  await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(100);
  await expectDocked(bar, { width: 390, height: 844 });
  expect(
    await bar.evaluate((node) => {
      const previous = node.previousElementSibling;
      if (!(previous instanceof HTMLElement)) return null;
      return Math.round(node.getBoundingClientRect().top - previous.getBoundingClientRect().bottom);
    }),
  ).toBe(8);

  await page.setViewportSize({ width: 390, height: 760 });
  await page.waitForTimeout(100);
  await expectDocked(bar, { width: 390, height: 760 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  await expectDocked(bar, { width: 390, height: 844 });

  const before = await scrollOwner.evaluate(
    (node) => (node as HTMLElement).scrollTop,
  );
  expect(before).toBeGreaterThan(0);
  const currentBar = await bar.boundingBox();
  expect(currentBar).not.toBeNull();
  await dispatchTouchPan(
    page,
    { x: 8, y: (currentBar?.y ?? 0) + 4 },
    { x: 8, y: Math.min(840, (currentBar?.y ?? 0) + 56) },
  );
  const after = await scrollOwner.evaluate(
    (node) => (node as HTMLElement).scrollTop,
  );
  expect(after).toBeLessThan(before);
  await expect(page.getByTestId("issue-2729-sheet")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        window.__issue2729Analytics.filter(
          (event) => event === "public_venue_reservation_started",
        ).length,
    ),
  ).toBe(0);

  await cta.tap();
  await expect(page.getByTestId("issue-2729-sheet")).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      window.__issue2729Analytics.filter(
        (event) => event === "public_venue_reservation_started",
      ),
    ),
  ).toEqual(["public_venue_reservation_started"]);
});
