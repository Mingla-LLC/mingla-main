import { devices, expect, test } from "@playwright/test";

test.use({ ...devices["iPhone 13"] });

test("iPhone 13 diagnostic — what is actually rendered on /b/leggothis", async ({ page }) => {
  await page.route(
    (url) =>
      url.pathname.includes("claimed_venues_public_view") ||
      url.search.includes("claimed_venues_public_view"),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify([]),
      }),
  );

  page.on("console", (msg) => console.log(`[iphone-console] ${msg.type()}: ${msg.text()}`));
  page.on("pageerror", (err) => console.log(`[iphone-pageerror] ${err.message}`));

  await page.goto("http://127.0.0.1:43197/b/leggothis", { waitUntil: "load", timeout: 25_000 });
  await page.waitForTimeout(8_000);

  await page.screenshot({ path: "/tmp/orch0961-iphone-diag.png", fullPage: true });
  const bodyText = await page.locator("body").innerText().catch(() => "(failed innerText)");
  console.log("--- body text ---");
  console.log(bodyText.slice(0, 800));
  console.log("--- look for testID ---");
  const closeCount = await page.locator('[data-testid="orch-0961-public-brand-close"]').count();
  const anyButtonCount = await page.locator("button").count();
  console.log(`brand-close testID count=${closeCount}, total button count=${anyButtonCount}`);
  const html = await page.content();
  console.log(`--- html length: ${html.length} ---`);
  console.log(html.includes("orch-0961-public-brand-close") ? "TESTID-PRESENT-IN-HTML" : "TESTID-MISSING-FROM-HTML");
});
