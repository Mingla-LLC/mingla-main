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

test("#3872 admin list renders the read-only margin strip", () => {
  assert.match(service, /admin_discount_margin_summary/);
  assert.match(page, /Discount margin · last 30 days/);
  assert.match(page, /buyer contact details are excluded/);
  assert.match(page, /row\.discountedOrderCount/);
  assert.match(page, /row\.discountCents/);
  assert.match(page, /row\.marginCents/);
  assert.match(page, /row\.negativeMarginCount/);
});
