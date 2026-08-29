import { expect, test } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const harness = pathToFileURL(
  path.join(__dirname, "../../../node_modules/.cache/issue2756/index.html"),
).href;

test("retry busy-state mutations stay outside the once-per-transition live alert", async ({
  page,
}) => {
  await page.goto(harness);

  const liveAlert = page.getByRole("alert");
  const retry = page.getByRole("button", {
    name: "Try refreshing venue again",
  });
  await expect(liveAlert).toContainText(
    "Couldn’t refresh venue. Showing the last update.",
  );
  await expect(retry).toBeVisible();

  // WAI-ARIA gives role=alert implicit aria-atomic=true. Any busy-label or
  // retry-state mutation beneath that node is therefore eligible to replay
  // the whole notice. The retry must remain a sibling, not a live descendant.
  await expect(
    liveAlert.getByRole("button", {
      name: "Try refreshing venue again",
    }),
  ).toHaveCount(0);
});
