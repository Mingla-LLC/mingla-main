import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(
  resolve(here, "..", "BusinessOrdersPage.jsx"),
  "utf8",
);
const service = readFileSync(
  resolve(here, "..", "..", "services", "adminMoneyService.js"),
  "utf8",
);

test("#3872 admin order detail renders discount truth", () => {
  assert.match(page, /bundle\.discount_lines/);
  assert.match(page, /field\("List subtotal"/);
  assert.match(page, /field\("Discount"/);
  assert.match(page, /field\("Fees & tax"/);
  assert.match(page, /field\("Buyer paid"/);
  assert.match(page, /label: `Discounts \(\$\{discountLines\.length\}\)`/);
});

// #4130: the old strip counted discounted orders but summed the margin of ALL
// paid orders under that headline. Discounts (discounted orders only) and
// margin are now two separate cards fed by admin_orders_overview.
test("#3872 admin list shows discounts and margin as separate cards", () => {
  assert.match(service, /admin_orders_overview/);
  assert.match(page, /Discounts given, last 30 days/);
  assert.match(page, /Mingla margin on sales, last 30 days/);
  assert.match(page, /data\.discounts, "discount_cents"/);
  assert.match(page, /data\.margin, "margin_cents"/);
  assert.match(page, /below zero/);
  assert.doesNotMatch(page, /D38/);
});
