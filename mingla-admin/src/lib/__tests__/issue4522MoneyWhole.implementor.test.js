// issue #4522 S-16 — Admin shows a whole amount without decimals, like the buyer pages.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { formatMoneyMinorWhole, formatMoneyMinor } from "../moneyFormat.js";

const here = dirname(fileURLToPath(import.meta.url));

test("a whole naira amount has no .00", () => {
  assert.equal(formatMoneyMinorWhole(389970000, "NGN"), "₦3,899,700");
  assert.equal(formatMoneyMinorWhole(120000, "USD"), "$1,200");
});

test("a non-whole amount keeps the currency's decimals", () => {
  assert.equal(formatMoneyMinorWhole(779850, "USD"), "$7,798.50");
  assert.equal(formatMoneyMinorWhole(49, "USD"), "$0.49");
});

test("zero-decimal currencies and bad input behave as the shared formatter", () => {
  assert.equal(formatMoneyMinorWhole(1500, "JPY"), formatMoneyMinor(1500, "JPY"));
  assert.equal(formatMoneyMinorWhole(null, "USD"), "—");
  assert.equal(formatMoneyMinorWhole(100, ""), "—");
});

test("the shared two-decimal formatter is unchanged (ledger pages keep it)", () => {
  assert.equal(formatMoneyMinor(120000, "USD"), "$1,200.00");
});

test("the orders page uses the whole-amount formatter", () => {
  const page = readFileSync(resolve(here, "..", "..", "pages", "BusinessOrdersPage.jsx"), "utf8");
  assert.match(page, /return formatMoneyMinorWhole\(cents, currency\)/);
});
