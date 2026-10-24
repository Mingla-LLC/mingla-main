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
  assert.match(page, /Referral payees/);
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
