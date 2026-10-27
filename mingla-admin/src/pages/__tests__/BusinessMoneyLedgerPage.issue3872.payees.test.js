import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(resolve(here, "..", "BusinessMoneyLedgerPage.jsx"), "utf8");
const readService = readFileSync(resolve(here, "..", "..", "services", "adminMoneyService.js"), "utf8");
const actService = readFileSync(resolve(here, "..", "..", "services", "adminMoneyActService.js"), "utf8");

test("#3872 admin money ledger exposes the payee ledger through read RPCs", () => {
  assert.match(readService, /admin_list_payee_ledger/);
  assert.match(page, /id: "payees", label: "Payees"/);
  assert.match(page, /fetchPage=\{listPayeeLedger\}/);
  // [TEST-MOD-APPROVED #3872] walkthrough W4: the tab covers every payee kind, so it is titled "Payees".
  assert.match(page, /title="Payees"/);
  assert.doesNotMatch(page, /Referral payees/);
  assert.match(page, /Risk held/);
  assert.match(page, /Below payout floor/);
});

test("#3872 payee provider fee ownership is buyer-readable", () => {
  assert.match(page, /Provider fee · payee/);
  assert.match(page, /Provider transfer fees come out of the payee's reward/);
  assert.match(page, /not charged to the buyer or host/);
  assert.match(page, /Provider fee paid by payee minor/);
});

test("#3872 admin can only hold or clear through the audited write seam", () => {
  assert.match(actService, /callAdminWriteRpc\("admin_set_referral_member_hold"/);
  assert.match(page, /HighRiskActionModal/);
  assert.match(page, /Hold payee payouts/);
  assert.match(page, /Clear payee payout hold/);
  assert.doesNotMatch(readService, /supabase\.from\(/);
});

test("#3872 W4 every payee kind shows, with a Kind column and filter, and the rail as the payee's bank", () => {
  assert.match(page, /key: "payee_kind", label: "Kind"/);
  assert.match(page, /\{ key: "kind", label: "Kind", options: \[/);
  for (const [value, label] of [["referral", "Referral"], ["gig_fee", "Gig fee"], ["local_month", "Local"]]) {
    assert.match(page, new RegExp(`value: "${value}", label: "${label}"`));
  }
  assert.match(page, /railWord\(v, row\.currency\)/);
  assert.match(page, /value: "stripe", label: "Bank \(US\)"/);
  assert.match(page, /value: "paystack", label: "Bank \(NG\)"/);
  // #4130 + #3872: the payee rail never names a provider. #4130's one Disputes
  // tab filters chargebacks by provider (a dispute is a provider's), so the
  // check reads the payee columns and the Payees list, not the whole page.
  const payeeTab = page.slice(page.indexOf('activeTab === "payees"'), page.indexOf('activeTab === "debts"'));
  assert.ok(payeeTab.includes("fetchPage={listPayeeLedger}"));
  for (const part of [page.slice(page.indexOf("function payeeColumns"), page.indexOf("const PAYEE_CSV")), payeeTab]) {
    assert.doesNotMatch(part, /label: "Stripe" \}|label: "Paystack" \}/);
  }
  assert.match(readService, /p_kind_filter: kind/);
  assert.match(page, /row\.member_id \? \(/, "risk holds only on referral rows, which have a member");
  assert.doesNotMatch(page.slice(page.indexOf("function payeeColumns"), page.indexOf("const PAYEE_CSV")), /replaceAll\("_"/);
});
