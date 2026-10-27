import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatMoneyMinor } from "../../lib/moneyFormat.js";

const page = readFileSync(new URL("../BusinessMoneyLedgerPage.jsx", import.meta.url), "utf8");
const brandPage = readFileSync(new URL("../BrandsConsolePage.jsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../../services/adminMoneyService.js", import.meta.url), "utf8");

test("#3645 admin payout console is unified, filterable and explains money", () => {
  for (const value of [
    "Money ledger · Payouts",
    "Every sale's payout from the release ledger",
    // #4130: the summary cards use the approved design's wording.
    "Due next 24 hours",
    "Late on Mingla",
    "Waiting for host bank",
    "Mingla owes back",
    "filterVariant=\"chips\"",
    "Card processing",
    "Mingla pays",
  ]) assert.ok(page.includes(value), `missing ${value}`);
  assert.ok(service.includes('supabase.rpc("admin_list_payouts"'));
  assert.ok(!service.includes('.from("payouts")'));
});

test("#3645 brand detail reuses the server-classified unified payout rows", () => {
  assert.ok(service.includes("payout_screen_rows: unified.data?.rows"));
  assert.ok(brandPage.includes("console.payout_screen_rows"));
  assert.ok(brandPage.includes('late_on_us: "Late, on us"'));
  assert.ok(!brandPage.includes("hostPayoutState("));
});

test("#3645 payout amounts use the settlement currency's minor units", () => {
  assert.equal(formatMoneyMinor(1234, "USD"), "$12.34");
  assert.match(formatMoneyMinor(1234, "NGN"), /₦\s?12\.34/);
  assert.match(formatMoneyMinor(1234, "JPY"), /1,234/);
  assert.equal(formatMoneyMinor(1234, null), "—");
});
