// MINGLA-INVARIANT: I-4522-CANCEL-REFUSED-PART-SETTLES | issue #4522 | A trip cancel refund the provider refuses is read back and lowered only to what the charge truly holds by the cancel's rule (never raised, sent once by the next run); before the #4522 migration nothing new runs (as main); a counted in-flight refund that fails is told to ops once with the exact amount, and no alert promises a host retry that repeats a refused ask.
/**
 * issue #4522 pass 8 (P8-1 / P8-2), edge side.
 * FAILS ON REVERT: without providerRefundedElsewhere / lostMinglaRefunds /
 * alertTripCancelShortfalls the imports fail; without the refusal read-back
 * and card resize the source checks fail; the old alert text fails R-5.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { lostMinglaRefunds, providerRefundedElsewhere } from "../refundEntries.ts";
import {
  alertTripCancelNotFinished,
  alertTripCancelShortfalls,
  resumeTripCancels,
} from "../../_shared/installments/unrecordedRefunds.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
const own = "mingla_trip_refund:r1:deposit";

Deno.test("R-1 the provider's other refunds of the charge are what was refunded elsewhere", () => {
  const rows = [
    { id: "1", amount: 50_000_000, status: "processed", merchantNote: "mingla_line_refund:s1" },
    { id: "2", amount: 100_000_000, status: "failed", merchantNote: own },
    { id: "3", amount: 7_000, status: "failed", merchantNote: "other" },
    { id: "4", amount: 3_000, status: "pending", merchantNote: "" },
  ];
  assertEquals(providerRefundedElsewhere(rows, own), 50_003_000);
  assertEquals(providerRefundedElsewhere([], own), 0);
});

Deno.test("R-2 Mingla's own lost refunds found on the provider are recorded, never this cancel's or a processed one", () => {
  const rows = [
    { id: "PS1", amount: 50_000_000, status: "processed", merchantNote: "mingla_line_refund:s1" },
    { id: "PS2", amount: 10, status: "processed", merchantNote: "mingla_line_refund:s2" },
    { id: "PS3", amount: 10, status: "failed", merchantNote: "mingla_line_refund:s3" },
  ];
  const attempts = [
    { merchant_note: "mingla_line_refund:s1", status: "pending", provider_refund_id: null },
    { merchant_note: "mingla_line_refund:s2", status: "processed", provider_refund_id: "PS2" },
    { merchant_note: "mingla_line_refund:s3", status: "pending", provider_refund_id: null },
    { merchant_note: own, status: "pending", provider_refund_id: null },
  ];
  const lost = lostMinglaRefunds(rows, attempts, own);
  assertEquals(lost.map((l) => [l.attempt.merchant_note, l.providerRefundId, l.status]), [
    ["mingla_line_refund:s1", "PS1", "processed"],
  ]);
});

Deno.test("R-3 a refused second-provider part is read back and resized; a refused card part is resized", () => {
  const refusal = source.indexOf("p_release: true");
  assert(refusal > 0);
  const after = source.slice(refusal, refusal + 1200);
  assertStringIncludes(after, "settleRefusedPaystackPart(");
  assertStringIncludes(source, "listPaystackTransactionRefunds({");
  assertStringIncludes(source, "p_provider_refunded_elsewhere_cents: providerRefundedElsewhere(rows, input.merchantNote)");
  // deploy window: no recording unless the resize (a new object) answered.
  const settle = source.slice(source.indexOf("const settleRefusedPaystackPart"));
  assert(settle.indexOf("if (resizeError) return;") < settle.indexOf("record_paystack_refund_outcome"));
  const card = source.slice(source.indexOf('refusedCardCharge = entry.installment_id ?? "deposit";'));
  assert(card.slice(0, 900).includes('"issue_4522_trip_cancel_resize_charge"'));
});

Deno.test("R-4 an owed amount is told to ops once with the exact figure; missing claim (deploy window) is silent", async () => {
  const sent: Array<{ subject: string; paragraphs: string[] }> = [];
  const alert = (subject: string, paragraphs: string[]) => {
    sent.push({ subject, paragraphs });
    return Promise.resolve();
  };
  let claims = 0;
  const client = {
    rpc: (fn: string) => {
      if (fn === "issue_4522_claim_trip_cancel_shortfalls") {
        claims += 1;
        return Promise.resolve({
          data: claims === 1
            ? [{ kind: "shortfall", order_id: "o1", cancel_refund_id: "c1", failed_refund_id: "s1", owed_cents: 25000, currency: "usd", tier_pct: 50, failed_refund_cents: 50000, shortfall_refund_id: "sf1" }]
            : [],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    },
  };
  await resumeTripCancels(client, 5, () => Promise.resolve(new Response("{}")), alert);
  await resumeTripCancels(client, 5, () => Promise.resolve(new Response("{}")), alert);
  assertEquals(sent.length, 1);
  // Pass 9 (P9-2): the owed amount is sent automatically, once; the alert
  // is informational and never sends staff to a refund Admin cannot make.
  assertStringIncludes(sent[0].paragraphs.join("\n"), "Owed and being sent: 25000 USD (minor units)");
  assertStringIncludes(sent[0].paragraphs.join("\n"), "it goes out as refund sf1");
  assert(!sent[0].paragraphs.join("\n").includes("Admin (order refund)"));
  const missing = { rpc: () => Promise.resolve({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }) };
  assertEquals(await alertTripCancelShortfalls(missing, alert), 0);
  assertEquals(sent.length, 1);
});

Deno.test("R-5 the stopped-retrying alert tells staff what to do and never promises a host retry", async () => {
  let text = "";
  await alertTripCancelNotFinished((_s, p) => {
    text = p.join("\n");
    return Promise.resolve();
  }, {
    orderId: "o1", refundId: "r1", currency: "ngn", detail: "Refund amount cannot be more than unrefunded",
    made: [], intended: [{ installment_id: null, source_pi: "ref1", refund_cents: 100_000_000 }], unconfirmed: [], cause: "failure",
  });
  assert(!text.includes("then the host can press Cancel & refund again on this booking to finish it"));
  assertStringIncludes(text, "repeats the same request");
  assertStringIncludes(text, "Admin > Money > Refund operations");
});
