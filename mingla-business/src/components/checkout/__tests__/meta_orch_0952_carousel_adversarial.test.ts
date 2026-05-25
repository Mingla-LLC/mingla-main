import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  checkoutRoutes,
  mockCheckoutConfirmPipeline,
} from "../../../../playwright/meta-orch-0952-fixtures";

const collectReact418Errors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    if (/Minified React error #418/.test(error.message)) {
      errors.push(error.message);
    }
  });
  return errors;
};

const assertFirstDotActive = async (carousel: Locator): Promise<void> => {
  const dots = carousel.page().getByLabel(/Ticket QR carousel dot/);
  await expect(dots).toHaveCount(3);

  const dotColors = await dots.evaluateAll((nodes) =>
    nodes.map((node) => window.getComputedStyle(node).backgroundColor),
  );

  expect(dotColors[0]).toBe("rgb(235, 120, 37)");
  expect(dotColors[1]).not.toBe("rgb(235, 120, 37)");
  expect(dotColors[2]).not.toBe("rgb(235, 120, 37)");
};

const assertCarouselStable = async (page: Page): Promise<void> => {
  const carousel = page.getByLabel("Ticket QR carousel", { exact: true });
  await expect(carousel).toBeVisible();

  const box = await carousel.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(200);

  const qrImages = carousel.locator("img[src^='data:image/png;base64,']");
  await expect(qrImages).toHaveCount(3);
  const imageBoxes = await qrImages.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      };
    }),
  );
  expect(imageBoxes[0].width).toBeGreaterThanOrEqual(190);
  expect(imageBoxes[0].height).toBeGreaterThanOrEqual(190);
  const carouselCenter = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const firstQrCenter = (imageBoxes[0].left + imageBoxes[0].right) / 2;
  expect(Math.abs(firstQrCenter - carouselCenter)).toBeLessThanOrEqual(16);
  for (const hiddenPageBox of imageBoxes.slice(1)) {
    expect(hiddenPageBox.left).toBeGreaterThanOrEqual((box?.x ?? 0) + (box?.width ?? 0));
  }
  await assertFirstDotActive(carousel);
  await expect(page.getByText("Swipe to see next ticket")).toBeVisible();
};

test.describe("META-ORCH-0952 adversarial resize contract", () => {
  test("AD-01 trip confirm carousel survives narrow-wide-narrow viewport resize during mount", async ({
    page,
  }) => {
    const react418Errors = collectReact418Errors(page);

    await page.setViewportSize({ width: 375, height: 667 });
    await mockCheckoutConfirmPipeline(page, { kind: "trip", ticketCount: 3 });
    await page.goto(checkoutRoutes.trip, { waitUntil: "domcontentloaded" });
    await assertCarouselStable(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await assertCarouselStable(page);

    await page.setViewportSize({ width: 375, height: 667 });
    await assertCarouselStable(page);

    await page.waitForTimeout(5000);
    expect(react418Errors).toEqual([]);
  });
});
