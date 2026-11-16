// Issue #4238 retest 4 (tester): adversarial angles on rework 3 / 3b that the
// implementor's tests do not take.
//
//  - (The Home Ads total was retired in rework 4: Home shows Promote's summary line.)
//  - Home attention reason: a payment line only for payment_failed, in any
//    case spelling the server sends; a rejected creative wins over a payment
//    state; the "Not approved" chip only on a needs-attention tile.
//  - Promote row identity: drafts and unparseable dates never print junk.
//
// FAILS-ON-REVERT (verified at 2b1db824fe, see the retest 4 verdict on #4238):
//  - homeAdAttentionReason without .toLowerCase() → "server spelling" fails.
import { describe, expect, test } from "@jest/globals";

import {
  homeAdAttentionReason,
  homeAdStatusLabel,
} from "../../../../utils/homeAdLifecycle";
import { hostAdRowIdentity, type HostAdListItem } from "../../../../services/hostAdLifecycle";
import type { HostAdCampaign } from "../../../../services/hostAdCampaignService";

const campaign = (over: Partial<Record<string, unknown>> = {}): HostAdCampaign =>
  ({
    id: "c1",
    plan_version_id: "v1",
    lifecycle: "live",
    currency: "USD",
    cap_cents: 10_000,
    lifetime_budget_cents: null,
    host_spend_equivalent_cents: 1,
    spend_by_currency: [],
    next_action: "Fix issue",
    plan_state: "live",
    creative: null,
    updated_at: "2026-11-10T10:00:00Z",
    created_at: "2026-11-01T10:00:00Z",
    ...over,
  }) as unknown as HostAdCampaign;

describe("retest 4: Home attention reason", () => {
  test("payment wording only for payment_failed, in the server's spelling too", () => {
    expect(homeAdAttentionReason(campaign({ plan_state: "PAYMENT_FAILED" }))).toBe(
      "The payment for this ad didn't go through",
    );
    for (const state of ["live", "paused", "settling", "creation_failed_terminal", null, "", "unknown_new_state"]) {
      expect(homeAdAttentionReason(campaign({ plan_state: state }))).not.toMatch(/payment/i);
    }
  });

  test("a rejected creative wins over a payment state", () => {
    const both = campaign({ plan_state: "payment_failed", creative: { review_status: "rejected" } });
    expect(homeAdAttentionReason(both)).toBe("An app didn't approve this ad");
  });

  test("'Not approved' only on a needs-attention tile", () => {
    const rejectedLive = campaign({ lifecycle: "live", plan_state: "staff_rejected" });
    expect(homeAdStatusLabel(rejectedLive)).not.toBe("Not approved");
    expect(homeAdStatusLabel({ ...rejectedLive, lifecycle: "needs_attention" } as HostAdCampaign)).toBe("Not approved");
  });
});

describe("retest 4: Promote row identity", () => {
  const item = (over: Partial<HostAdListItem>): HostAdListItem =>
    ({ kind: "campaign", platforms: ["meta"], startedAt: "2026-11-04T09:00:00Z", ...over }) as HostAdListItem;

  test("a draft never prints a start day; an unparseable date prints only the apps", () => {
    const draft = hostAdRowIdentity(item({ kind: "draft", startedAt: "2026-11-04T09:00:00Z" }), "en-GB");
    expect(draft).not.toMatch(/\d/);
    const junk = hostAdRowIdentity(item({ startedAt: "not a date" }), "en-GB");
    expect(junk).not.toMatch(/Invalid|NaN|·/);
    expect(junk?.length ?? 0).toBeGreaterThan(0);
  });

  test("no apps and no start → null (no empty caption line)", () => {
    expect(hostAdRowIdentity(item({ platforms: [], startedAt: null }), "en-GB")).toBeNull();
  });
});
