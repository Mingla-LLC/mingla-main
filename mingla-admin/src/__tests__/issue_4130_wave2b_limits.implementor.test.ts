// #4130 Wave 2b — Refund operations, Subscriptions, Pricing and limits (admin).
//
// Pure helpers are run for real; the pages are read as source for the wiring
// that has no runtime here (React + Supabase). The database side (limits,
// real tiers, admin-only RPCs) is proven by
// supabase/migrations/__tests__/issue_4130_messaging_limits.implementor.happy.pg17.test.sql.
//
// Fails on revert: restoring the old pages (window.prompt for the reason, no
// catch on row open, appendCapturedQueuePage inside setView, the
// `length === PAGE_SIZE` next-page rule, the raw admin_grant_override call with
// a client `p_granted_by`, the browser read of admin_subscription_overrides,
// the Fees-only Pricing page) fails the source tests below.

import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  endsAtFromDay,
  formatLimit,
  formatUsage,
  limitSourceLabel,
  messagingLimitErrorMessage,
  parseLimitInput,
  parseWeekWarningInput,
  startOfNextMonthUtc,
  untilOptions,
  usagePercent,
  usageTone,
} from "../lib/messagingLimits.js";
import { formatMinor, saleEarnings } from "../lib/saleEarnings.js";
import {
  getsNowLabel,
  globalPlusConfirmCopy,
  hasNextPage,
  pageRangeLabel,
  personName,
  realTierLabel,
} from "../lib/subscriptionsView.js";
import {
  exceptionDetail,
  queueRowModel,
  refundQueueErrorMessage,
  validateActionReason,
} from "../lib/refundOperationsView.js";

const read = (rel: string) => Deno.readTextFile(new URL(rel, import.meta.url));
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

// ── Messaging limits ───────────────────────────────────────────────────────

Deno.test("#4130 limits: null means no limit, everywhere it is shown", () => {
  assertEquals(formatLimit(null), "No limit");
  assertEquals(formatLimit(1000), "1,000 a month");
  assertEquals(formatUsage(123, 3000), "123 / 3,000");
  assertEquals(formatUsage(5, null), "5 / No limit");
  assertEquals(usagePercent(5, null), null);
  assertEquals(usagePercent(50, 100), 50);
  assertEquals(usagePercent(150, 100), 100);
  assertEquals(usageTone(80, 100), "warning");
  assertEquals(usageTone(100, 100), "error");
  assertEquals(usageTone(10, 100), "default");
});

Deno.test("#4130 limits: inputs are whole numbers; push may be left empty for no limit", () => {
  assertEquals(parseLimitInput("3,000"), { value: 3000 });
  assertEquals(parseLimitInput("", { allowBlank: true }), { value: null });
  assertEquals(parseLimitInput("No limit", { allowBlank: true }), { value: null });
  assert("error" in parseLimitInput("", { label: "Emails a month" }));
  assert("error" in parseLimitInput("12.5"));
  assert("error" in parseLimitInput("-3"));
  assert("error" in parseLimitInput("10000001"));
  assertEquals(parseWeekWarningInput("3"), { value: 3 });
  assert("error" in parseWeekWarningInput("0"));
});

Deno.test("#4130 limits: end dates are UTC month starts or the end of a picked day", () => {
  const now = new Date("2026-10-26T15:40:00Z");
  assertEquals(startOfNextMonthUtc(now).toISOString(), "2026-11-01T00:00:00.000Z");
  const options = untilOptions(now);
  assertEquals(options.map((o) => o.id), ["this_month", "next_month", "date", "none"]);
  assertEquals(options[1].endsAt, "2026-12-01T00:00:00.000Z");
  assertEquals(options[3].endsAt, null);
  assertEquals(endsAtFromDay("2026-11-30", now), { value: "2026-12-01T00:00:00.000Z" });
  assert("error" in endsAtFromDay("2026-10-01", now));
  assert("error" in endsAtFromDay("", now));
});

Deno.test("#4130 limits: where a brand's limits come from, in words", () => {
  assertEquals(limitSourceLabel({ source: "default" }), "Default");
  assertEquals(limitSourceLabel({ source: "override", override: { set_by_name: "Seth" } }), "Raised by Seth");
  assertEquals(limitSourceLabel({ source: "default", override: { active: false } }), "Default (raise ended)");
  assertMatch(messagingLimitErrorMessage({ message: "messaging_limit_end_in_past" }), /already passed/);
  assertMatch(messagingLimitErrorMessage({ message: "not_authorized" }), /permission/);
});

// ── What one sale earns ────────────────────────────────────────────────────

Deno.test("#4130 sale earnings: 1.5% + 3% on a ₦5,500 ticket, Paystack's published rate", () => {
  const r = saleEarnings({ ticketMinor: 550_000, takeBps: 150, currency: "NGN" })!;
  assertEquals(r.fee, 24_750);
  assertEquals(r.buyerPays, 574_750);
  assertEquals(r.processing, 8_621 + 10_000);
  assertEquals(r.profit, 24_750 - 18_621);
  assertEquals(formatMinor(r.buyerPays, "NGN"), "₦5,747.50");
});

Deno.test("#4130 sale earnings: a $30 ticket at Stripe's published rate, and a brand override", () => {
  const r = saleEarnings({ ticketMinor: 3_000, takeBps: 150, currency: "USD" })!;
  assertEquals([r.fee, r.buyerPays, r.processing, r.profit], [135, 3_135, 121, 14]);
  const override = saleEarnings({ ticketMinor: 3_000, takeBps: 100, currency: "USD" })!;
  assertEquals(override.fee, 120);
  assertEquals(saleEarnings({ ticketMinor: 0, takeBps: 150, currency: "USD" }), null);
  assertEquals(saleEarnings({ ticketMinor: 3_000, takeBps: 150, currency: "GBP" }), null);
  // Paystack's fee is capped at ₦2,000.
  const big = saleEarnings({ ticketMinor: 50_000_000, takeBps: 150, currency: "NGN" })!;
  assertEquals(big.processing, 200_000);
});

// ── Subscriptions ──────────────────────────────────────────────────────────

Deno.test("#4130 subscriptions: next page follows the server total, not a full page", () => {
  // The old page disabled Next only when fewer than 20 rows came back, so
  // exactly 20 people offered an empty next page, and 21+ hid nobody.
  assertEquals(hasNextPage(20, 0), false);
  assertEquals(hasNextPage(21, 0), true);
  assertEquals(hasNextPage(40, 1), false);
  assertEquals(pageRangeLabel(150, 1, 20), "Showing 21–40 of 150");
});

Deno.test("#4130 subscriptions: blank names, real tiers and what people get now", () => {
  assertEquals(personName({ display_name: null, has_first_name: false }), "No first name");
  assertEquals(personName({ display_name: "Okafor", has_first_name: false }), "No first name (Okafor)");
  assertEquals(personName({ display_name: "Ada Okafor", has_first_name: true }), "Ada Okafor");
  assertEquals(realTierLabel({ real_tier: "mingla_plus", real_source: "paid" }).label, "Paid Mingla+");
  assertEquals(realTierLabel({ real_tier: "free", real_source: "none" }).label, "Free");
  assertEquals(getsNowLabel({ gets_now: "mingla_plus", gets_now_reason: "global" }), "Mingla+ (Global Plus)");
});

Deno.test("#4130 subscriptions: turning Global Plus off says how many lose access", () => {
  const off = globalPlusConfirmCopy({ turningOn: false, realFree: 140, realPlus: 5 });
  assertMatch(off.body, /140 people will lose Mingla\+/);
  assertMatch(off.body, /5 people with Mingla\+ of their own/);
  assertEquals(off.confirmLabel, "Turn off for 140 people");
  // Counts that did not load never become a guess.
  assertEquals(globalPlusConfirmCopy({ turningOn: false, realFree: null, realPlus: null }).confirmLabel, null);
});

// ── Refund operations ──────────────────────────────────────────────────────

Deno.test("#4130 refunds: exception rows open with their captured details", () => {
  const item = {
    itemKind: "provider_event_exception",
    itemId: "exc-1",
    safeSummary: { exceptionId: "exc-1", provider: "paystack", providerEventType: "refund.processed", matchStatus: "unmatched" },
  };
  assertEquals(queueRowModel(item).kind, "exception");
  const detail = exceptionDetail(item);
  assertMatch(detail.explanation, /matches no refund/);
  assertEquals(detail.fields.find(([k]) => k === "Event")?.[1], "refund.processed");
  assertEquals(queueRowModel({ itemKind: "refund_operation", itemId: "r1", safeSummary: { operationId: "r1" } }).kind, "refund");
});

Deno.test("#4130 refunds: errors in words; a reason is required in the page", () => {
  assertMatch(refundQueueErrorMessage(new Error("snapshot_mismatch"), "more"), /expired/);
  assertMatch(refundQueueErrorMessage(new Error("boom"), "more"), /load more/);
  assertMatch(refundQueueErrorMessage(new Error("boom"), "open"), /open this refund/);
  assert(validateActionReason("  ") !== null);
  assertEquals(validateActionReason("Provider confirmed the refund"), null);
});

Deno.test("#4130 refunds page: no pop-up, row open and Load more cannot fail silently", async () => {
  const page = stripComments(await read("../pages/RefundOperationsPage.jsx"));
  assert(!/window\.prompt/.test(page), "the reason is typed in the page, not a pop-up");
  assertMatch(page, /Reason \(saved on the refund\)/);
  const select = page.slice(page.indexOf("const select = async"), page.indexOf("const act = async"));
  assertMatch(select, /try \{[\s\S]*getSourceRefundOperation[\s\S]*\} catch/);
  assertMatch(select, /exceptionDetail\(item\)/);
  assert(!/if \(item\.itemKind !== "refund_operation"\) return;/.test(page), "exception rows open");
  const loadMore = page.slice(page.indexOf("const loadMore = async"), page.indexOf("const resetPanel"));
  assert(!/setView\(\(current\) => appendCapturedQueuePage/.test(loadMore), "no throw inside a state update");
  assertMatch(loadMore, /try \{[\s\S]*appendCapturedQueuePage\(current, page\)[\s\S]*\} catch/);
  assertMatch(loadMore, /setMoreError/);
  assertMatch(page, /All clear/);
});

Deno.test("#4130 subscriptions page: audited writes, admin RPC reads, server paging", async () => {
  const page = stripComments(await read("../pages/SubscriptionManagementPage.jsx"));
  const service = stripComments(await read("../services/subscriptionsService.js"));
  assertMatch(page, /grantOverrideAudited\(/);
  assertMatch(page, /revokeOverrideAudited\(/);
  assert(!/admin_grant_override"|admin_revoke_override"/.test(page), "no unaudited grant/revoke");
  assert(!/p_granted_by|p_revoked_by/.test(page), "the server records the actor");
  assert(!/\.from\(\s*["']admin_subscription_overrides/.test(page + service), "RLS hides overrides; read them by RPC");
  assertMatch(service, /admin_subscription_overrides_expiring/);
  assertMatch(service, /admin_list_subscriptions_v2/);
  assertMatch(page, /hasNextPage\(total, page\)/);
  assert(!/length === PAGE_SIZE/.test(page));
  assertMatch(page, /listAllSubscriptions\(query\)/);
  assertMatch(page, /globalPlusConfirmCopy\(/);
  assertMatch(page, /setGlobalConfirm\(true\)/);
});

Deno.test("#4130 pricing page: Fees and Messaging limits tabs, and what one sale earns", async () => {
  const page = stripComments(await read("../pages/PricingPage.jsx"));
  assertMatch(page, /title="Pricing and limits"/);
  assertMatch(page, /<MessagingLimitsPanel \/>/);
  assertMatch(page, /<SaleEarningsCard/);
  assertMatch(page, /instalment/);
  const panel = stripComments(await read("../components/pricing/MessagingLimitsPanel.jsx"));
  const svc = stripComments(await read("../services/messagingLimitsService.js"));
  for (const rpc of ["admin_messaging_limits_overview", "admin_set_messaging_limit_defaults", "admin_set_brand_messaging_limits", "admin_clear_brand_messaging_limits"]) {
    assertMatch(svc, new RegExp(`"${rpc}"`));
  }
  assert(!/supabase/.test(panel), "the panel calls the service, never Supabase directly");
  assertMatch(panel, /setConfirming\(\{ kind: "save"/);
  assertMatch(panel, /Save these limits\?/);
});
