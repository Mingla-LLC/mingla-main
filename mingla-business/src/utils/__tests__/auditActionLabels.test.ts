import { describe, expect, test } from "@jest/globals";

import {
  AUDIT_CATEGORIES,
  KNOWN_STATIC_SLUGS,
  resolveAuditActionLabel,
} from "../auditActionLabels";

describe("resolveAuditActionLabel — static slugs", () => {
  test("T-01 order_cancelled resolves with ticket icon and orders category", () => {
    const out = resolveAuditActionLabel("order_cancelled");
    expect(out.title).toBe("Order cancelled");
    expect(out.category).toBe("orders");
    expect(out.iconHint).toBe("ticket");
  });

  test("stripe_connect.detach_completed resolves cleanly", () => {
    const out = resolveAuditActionLabel("stripe_connect.detach_completed");
    // [TEST-MOD-APPROVED #3645] was "Disconnected Stripe account": the activity log no longer names the payment provider.
    expect(out.title).toBe("Disconnected payout account");
    expect(out.category).toBe("stripe_connect");
    expect(out.iconHint).toBe("bank");
  });

  test("stripe_connect.detach_local_success_stripe_rejected has explanatory detail", () => {
    const out = resolveAuditActionLabel(
      "stripe_connect.detach_local_success_stripe_rejected",
    );
    // [TEST-MOD-APPROVED #3645] was "Disconnected locally — Stripe rejected": the activity log no longer names the payment provider.
    expect(out.title).toBe("Disconnected locally — payment partner refused");
    expect(out.detail).toContain("Local state cleared");
    expect(out.category).toBe("stripe_connect");
  });

  test("mingla_tos_accept categorised as legal", () => {
    const out = resolveAuditActionLabel("mingla_tos_accept");
    expect(out.category).toBe("legal");
    expect(out.iconHint).toBe("shield");
  });

  test("ops.webhook_silence_check_fired categorised as ops", () => {
    const out = resolveAuditActionLabel("ops.webhook_silence_check_fired");
    expect(out.category).toBe("ops");
  });

  test("order_refund_issued categorised as payouts_refunds with pound icon", () => {
    const out = resolveAuditActionLabel("order_refund_issued");
    expect(out.category).toBe("payouts_refunds");
    expect(out.iconHint).toBe("pound");
  });
});

describe("resolveAuditActionLabel — dynamic patterns", () => {
  test("T-02 deadline N=7 produces plural day detail", () => {
    const out = resolveAuditActionLabel(
      "stripe_connect.deadline_warning_7d_sent",
    );
    expect(out.title).toBe("KYC deadline reminder sent");
    expect(out.detail).toBe("Verification deadline is 7 days away.");
    expect(out.category).toBe("stripe_connect");
  });

  test("T-03 deadline N=1 produces singular day detail", () => {
    const out = resolveAuditActionLabel(
      "stripe_connect.deadline_warning_1d_sent",
    );
    expect(out.detail).toBe("Verification deadline is 1 day away.");
  });

  test("deadline N=3 also resolves", () => {
    const out = resolveAuditActionLabel(
      "stripe_connect.deadline_warning_3d_sent",
    );
    expect(out.detail).toBe("Verification deadline is 3 days away.");
  });

  test("T-04 refund status pending capitalised", () => {
    const out = resolveAuditActionLabel(
      "stripe.charge.refund.updated.pending",
    );
    expect(out.title).toBe("Refund Pending");
    expect(out.category).toBe("payouts_refunds");
  });

  test("refund status failed", () => {
    const out = resolveAuditActionLabel("stripe.charge.refunded.failed");
    expect(out.title).toBe("Refund Failed");
    expect(out.category).toBe("payouts_refunds");
  });

  test("T-05 reconciled refund maps correctly", () => {
    const out = resolveAuditActionLabel(
      "stripe.charge.refund.updated.reconciled",
    );
    expect(out.title).toBe("Refund matched to order");
    expect(out.category).toBe("payouts_refunds");
  });

  test("orphan refund maps correctly", () => {
    const out = resolveAuditActionLabel("stripe.refund.created.orphan");
    expect(out.title).toBe("Orphan refund recorded");
    expect(out.detail).toContain("no matching Mingla order");
    expect(out.category).toBe("payouts_refunds");
  });

  test("generic stripe_connect.<event.type> falls through to Connect category", () => {
    const out = resolveAuditActionLabel("stripe_connect.capability.updated");
    // [TEST-MOD-APPROVED #3645] was "Stripe Connect: Capability updated": the activity log no longer names the payment provider.
    expect(out.title).toBe("Payout account: Capability updated");
    expect(out.category).toBe("stripe_connect");
  });
});

describe("resolveAuditActionLabel — unknown fallback", () => {
  test("T-06 unknown slug humanizes title and stores raw in detail", () => {
    const out = resolveAuditActionLabel("some.future.slug");
    expect(out.title).toBe("Some future slug");
    expect(out.detail).toBe("some.future.slug");
    expect(out.category).toBe("other");
    expect(out.iconHint).toBe("flag");
  });

  test("empty-ish unknown stays safe", () => {
    const out = resolveAuditActionLabel("___");
    expect(out.category).toBe("other");
    expect(typeof out.title).toBe("string");
  });
});

describe("T-07 — every KNOWN_STATIC_SLUG resolves to a non-other category", () => {
  for (const slug of KNOWN_STATIC_SLUGS) {
    test(`${slug} → non-other`, () => {
      const out = resolveAuditActionLabel(slug);
      expect(out.category).not.toBe("other");
      expect(out.title.length).toBeGreaterThan(0);
    });
  }
});

describe("AUDIT_CATEGORIES exposure", () => {
  test("exposes all 6 ids", () => {
    const ids = AUDIT_CATEGORIES.map((c) => c.id);
    expect(ids).toEqual([
      "stripe_connect",
      "payouts_refunds",
      "orders",
      "legal",
      "ops",
      "other",
    ]);
  });
});

// #3645 — the brand activity log is host-facing copy: no title, detail or
// filter label names the payment provider, including the titles built at
// runtime for dynamic slugs. Entries that differed only by provider stay
// distinguishable.
describe("#3645 — the activity log never names the payment provider", () => {
  const PROVIDER = /\b(?:stripe|paystack)\b/i;
  const DYNAMIC_SLUGS = [
    "stripe_connect.deadline_warning_7d_sent",
    "stripe.charge.refund.updated.reconciled",
    "stripe.refund.created.orphan",
    "stripe.charge.refunded.failed",
    "stripe_connect.capability.updated",
  ];

  test("filter labels name no provider", () => {
    for (const category of AUDIT_CATEGORIES) {
      expect(category.label).not.toMatch(PROVIDER);
    }
    expect(AUDIT_CATEGORIES.find((c) => c.id === "stripe_connect")?.label).toBe(
      "Payout account",
    );
  });

  for (const slug of [...KNOWN_STATIC_SLUGS, ...DYNAMIC_SLUGS]) {
    test(`${slug} → title and detail name no provider`, () => {
      const out = resolveAuditActionLabel(slug);
      expect(out.title).not.toMatch(PROVIDER);
      if (out.detail !== undefined) expect(out.detail).not.toMatch(PROVIDER);
    });
  }

  test("every static slug keeps a distinct title", () => {
    const titles = KNOWN_STATIC_SLUGS.map((slug) => resolveAuditActionLabel(slug).title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  test("card and Nigerian payout-account events stay distinguishable", () => {
    expect(resolveAuditActionLabel("stripe_connect.detach_completed").title).toBe(
      "Disconnected payout account",
    );
    expect(resolveAuditActionLabel("paystack.subaccount_disconnected").title).toBe(
      "Nigerian payout account disconnected",
    );
    expect(resolveAuditActionLabel("paystack.subaccount_created").title).toBe(
      "Nigerian payout account connected",
    );
    expect(resolveAuditActionLabel("stripe_connect.onboard_initiated").title).toBe(
      "Started bank setup",
    );
    expect(resolveAuditActionLabel("paystack.provider_selected").detail).toBe(
      "The brand chose to get paid in Nigeria; bank connection is the next step.",
    );
    expect(resolveAuditActionLabel("stripe_connect.webhook_unhandled").title).not.toBe(
      resolveAuditActionLabel("paystack.webhook_unhandled_event").title,
    );
  });
});
