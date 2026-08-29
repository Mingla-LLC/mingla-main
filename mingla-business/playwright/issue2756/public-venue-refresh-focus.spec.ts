import { expect, test } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const harness = pathToFileURL(
  path.join(__dirname, "../../node_modules/.cache/issue2756/index.html"),
).href;

const load = async (page: import("@playwright/test").Page): Promise<void> => {
  await page.goto(harness);
  await expect(
    page.getByRole("button", { name: "Try refreshing venue again" }),
  ).toBeVisible();
};

test("busy retry retains focus and suppresses click, Enter, and Space before successful tab recovery", async ({ page }) => {
  await load(page);
  const retry = page.getByRole("button", {
    name: "Try refreshing venue again",
  });
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(retry).toBeFocused();
  await expect(retry).toHaveAttribute("aria-disabled", "true");
  await expect(retry).toHaveAttribute("aria-busy", "true");
  await expect(retry).toHaveAttribute("tabindex", "0");
  await retry.dispatchEvent("click");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await expect.poll(() => page.evaluate(() => window.issue2756?.calls())).toBe(1);
  await page.evaluate(() => window.issue2756?.succeed());
  await expect(retry).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Reservations" })).toBeFocused();
});

test("failed retry preserves the same focused control and re-enables it", async ({ page }) => {
  await load(page);
  const retry = page.getByRole("button", {
    name: "Try refreshing venue again",
  });
  await retry.evaluate((node) => {
    (window as Window & { issue2756RetryNode?: Element }).issue2756RetryNode =
      node;
  });
  await retry.focus();
  await page.keyboard.press("Enter");
  await page.evaluate(() => window.issue2756?.fail());
  await expect(retry).toBeFocused();
  await expect(retry).toHaveAttribute("aria-disabled", "false");
  await expect(retry).toHaveAttribute("aria-busy", "false");
  await expect.poll(() =>
    retry.evaluate((node) =>
      (window as Window & { issue2756RetryNode?: Element })
        .issue2756RetryNode === node,
    ),
  ).toBe(true);
});

test("settlement never steals focus after the visitor moves elsewhere", async ({ page }) => {
  await load(page);
  const retry = page.getByRole("button", {
    name: "Try refreshing venue again",
  });
  await retry.focus();
  await page.keyboard.press("Enter");
  const elsewhere = page.getByRole("button", { name: "Elsewhere" });
  await elsewhere.focus();
  await expect(elsewhere).toBeFocused();
  await page.evaluate(() => window.issue2756?.succeed());
  await expect(elsewhere).toBeFocused();
  await expect(page.getByRole("tab", { name: "Reservations" })).not.toBeFocused();
});
