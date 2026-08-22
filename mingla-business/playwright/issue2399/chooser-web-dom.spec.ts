import { expect, test } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const harness = pathToFileURL(
  path.join(__dirname, "../../node_modules/.cache/issue2399/index.html"),
).href;

test("production chooser exposes checked truth, chronological Space toggling, and scoped motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(harness);
  const boxes = page.getByRole("checkbox");
  await expect(boxes).toHaveCount(2);
  await expect(boxes.nth(0)).toHaveAttribute("id", "issue-2160-day-row-earlier");
  await expect(boxes.nth(0)).toHaveAttribute("aria-checked", "false");

  await page.locator("#blocked-checkout").click();
  await expect(page.locator("#notice-dismiss")).toBeVisible();
  await expect(boxes.nth(0)).toBeFocused();
  await boxes.nth(0).focus();
  await page.keyboard.press("Space");
  await expect(boxes.nth(0)).toHaveAttribute("aria-checked", "true");
  await expect(boxes.nth(1)).toHaveAttribute("aria-checked", "false");
  await boxes.nth(1).click();
  await expect(boxes.nth(1)).toHaveAttribute("aria-checked", "true");
  await boxes.nth(0).click();
  await expect(boxes.nth(0)).toHaveAttribute("aria-checked", "false");
  const normal = await boxes.nth(0).evaluate((node) => getComputedStyle(node).transition);
  expect(normal).toContain("0.15s");
  expect(normal).not.toContain("all");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => boxes.nth(0).evaluate((node) =>
    getComputedStyle(node).transitionDuration,
  )).toBe("0s");
  const reduced = await boxes.nth(0).evaluate((node) => getComputedStyle(node).transitionDuration);
  expect(reduced).toBe("0s");
});
