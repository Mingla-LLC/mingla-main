// META-ORCH-1161 Sub-C "b" — regression test: per-category render templates.
//
// Proves the NET-NEW Sub-C render cases added to notifyTemplates.ts:
//   * buyer_event_reminder renders DISTINCT copy for the 24h vs 2h lead bucket
//     (the leadBucket payload field is the only differentiator — proves the
//     single category covers both buckets, SPEC §7.3),
//   * buyer_reservation_reminder likewise 24h vs 2h,
//   * buyer_purchase_confirmation renders push+email copy (COPY §3.11, NO STOP
//     line; SMS string exists defensively but the seed gives it no sms channel),
//   * buyer_refund_issued formats the amount currency-aware (COPY §3.9),
//   * buyer_order_cancelled renders the event-scoped copy (COPY §3.10).
//
// fails-on-revert: delete any of these case blocks → the switch falls through to
// the generic default and the assertions below FAIL.
//
// Run: deno test supabase/functions/_shared/__tests__/meta_orch_1161_subc_templates.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderCategoryMessage } from "../notifyTemplates.ts";

Deno.test("buyer_event_reminder 24h vs 2h render distinct copy by lead_bucket", () => {
  const base = { brand_name: "Lantern", event_title: "Jazz Night", time: "8:00 PM" };
  const r24 = renderCategoryMessage("buyer_event_reminder", { ...base, lead_bucket: "24h" });
  const r2 = renderCategoryMessage("buyer_event_reminder", { ...base, lead_bucket: "2h" });

  // 24h copy speaks of "tomorrow"; 2h copy speaks of "2 hours". They MUST differ.
  assertStringIncludes(r24.sms, "tomorrow");
  assertStringIncludes(r2.sms, "2 hours");
  assert(r24.sms !== r2.sms, "24h and 2h reminder SMS must differ");
  assert(r24.push.title !== r2.push.title, "24h and 2h reminder push titles must differ");
  // Brand + event interpolated into the body (no fabricated placeholder leftovers).
  assertStringIncludes(r24.sms, "Lantern");
  assertStringIncludes(r24.sms, "Jazz Night");
});

Deno.test("buyer_reservation_reminder 24h vs 2h render distinct copy", () => {
  const base = { brand_name: "Vine", time: "7:30 PM", party_size: 4 };
  const r24 = renderCategoryMessage("buyer_reservation_reminder", { ...base, lead_bucket: "24h" });
  const r2 = renderCategoryMessage("buyer_reservation_reminder", { ...base, lead_bucket: "2h" });
  assertStringIncludes(r24.sms, "tomorrow");
  assertStringIncludes(r2.sms, "2 hours");
  assert(r24.sms !== r2.sms, "reservation reminder 24h/2h SMS must differ");
  assertStringIncludes(r24.sms, "party of 4");
});

Deno.test("buyer_purchase_confirmation renders push+email (NO STOP line)", () => {
  const r = renderCategoryMessage("buyer_purchase_confirmation", {
    brand_name: "Lantern",
    event_title: "Jazz Night",
    date: "Jun 22",
    time: "8:00 PM",
  });
  assertStringIncludes(r.push.title, "Jazz Night");
  assertStringIncludes(r.push.body, "Mingla app");
  assertStringIncludes(r.email.subject, "Lantern");
  // Pure transactional confirmation: no "Reply STOP" promo footer in the copy.
  assertEquals(r.push.body.includes("STOP"), false);
  assertEquals(r.email.body.includes("STOP"), false);
});

Deno.test("buyer_refund_issued formats amount currency-aware", () => {
  const r = renderCategoryMessage("buyer_refund_issued", {
    brand_name: "Lantern",
    amount_cents: 6793,
    currency: "USD",
  });
  // $67.93 from 6793 cents (proves fmtAmount wiring — not a raw cents leak).
  assertStringIncludes(r.sms, "$67.93");
  assertStringIncludes(r.sms, "5-10 days");
  assertEquals(r.sms.includes("6793"), false);
});

Deno.test("buyer_order_cancelled renders event-scoped copy", () => {
  const r = renderCategoryMessage("buyer_order_cancelled", {
    brand_name: "Lantern",
    event_title: "Jazz Night",
  });
  assertStringIncludes(r.sms, "Jazz Night");
  assertStringIncludes(r.sms, "cancelled");
  assertStringIncludes(r.push.title, "Order cancelled");
});
