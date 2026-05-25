import { expect, test, type Page } from "@playwright/test";

import {
  checkoutRoutes,
  mockCheckoutConfirmPipeline,
  type CheckoutRouteKind,
  type TicketCount,
} from "../../../../playwright/meta-orch-0952-fixtures";

const componentUnderTest = "TicketQrCarousel";
const exportCommandUnderTest = "expo export -p web --output-dir web-build";

const collectReact418Errors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    if (/Minified React error #418/.test(error.message)) {
      errors.push(error.message);
    }
  });
  return errors;
};

const assertMultiTicketCarousel = async (
  page: Page,
  expectedTickets: number,
): Promise<void> => {
  const carousel = page.getByLabel("Ticket QR carousel", { exact: true });
  await expect(carousel, `${componentUnderTest} mounted from ${exportCommandUnderTest}`).toBeVisible();

  const box = await carousel.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(200);

  const qrImages = carousel.locator("img[src^='data:image/png;base64,']");
  await expect(qrImages).toHaveCount(expectedTickets);
  const carouselBox = await carousel.boundingBox();
  expect(carouselBox).not.toBeNull();

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
  expect(imageBoxes).toHaveLength(expectedTickets);
  expect(imageBoxes[0].width).toBeGreaterThanOrEqual(190);
  expect(imageBoxes[0].height).toBeGreaterThanOrEqual(190);
  const carouselCenter = (carouselBox?.x ?? 0) + (carouselBox?.width ?? 0) / 2;
  const firstQrCenter = (imageBoxes[0].left + imageBoxes[0].right) / 2;
  expect(Math.abs(firstQrCenter - carouselCenter)).toBeLessThanOrEqual(16);
  for (const hiddenPageBox of imageBoxes.slice(1)) {
    expect(hiddenPageBox.left).toBeGreaterThanOrEqual((carouselBox?.x ?? 0) + (carouselBox?.width ?? 0));
  }

  for (let index = 1; index <= expectedTickets; index += 1) {
    await expect(page.getByLabel(`Ticket QR carousel dot ${index}`)).toBeVisible();
  }
  await expect(page.getByText("Swipe to see next ticket")).toBeVisible();
};

const assertSingleTicketQr = async (page: Page): Promise<void> => {
  await expect(page.getByLabel("Ticket QR carousel", { exact: true })).toHaveCount(0);
  await expect(page.locator("img[src^='data:image/png;base64,']")).toHaveCount(1);
  await expect(page.getByText("Swipe to see next ticket")).toHaveCount(0);
  await expect(page.getByLabel(/Ticket QR carousel dot/)).toHaveCount(0);
};

const openConfirmRoute = async (
  page: Page,
  kind: CheckoutRouteKind,
  ticketCount: TicketCount,
): Promise<string[]> => {
  const react418Errors = collectReact418Errors(page);
  await mockCheckoutConfirmPipeline(page, { kind, ticketCount });
  await page.goto(checkoutRoutes[kind], { waitUntil: "domcontentloaded" });
  return react418Errors;
};

test.describe("META-ORCH-0952 buyer-web TicketQrCarousel browser contract", () => {
  test("HP-01 trip confirm renders 3 QR cards on first browser pass", async ({ page }) => {
    const react418Errors = await openConfirmRoute(page, "trip", 3);
    await assertMultiTicketCarousel(page, 3);
    await page.waitForTimeout(5000);
    expect(react418Errors).toEqual([]);
  });

  test("HP-02 event confirm renders 3 QR cards on first browser pass", async ({ page }) => {
    const react418Errors = await openConfirmRoute(page, "event", 3);
    await assertMultiTicketCarousel(page, 3);
    await page.waitForTimeout(5000);
    expect(react418Errors).toEqual([]);
  });

  test("HP-03 trip confirm preserves single-ticket QR without carousel affordances", async ({ page }) => {
    const react418Errors = await openConfirmRoute(page, "trip", 1);
    await assertSingleTicketQr(page);
    await page.waitForTimeout(5000);
    expect(react418Errors).toEqual([]);
  });
});
