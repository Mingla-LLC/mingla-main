/**
 * META-ORCH-1074 Sub-D — template-integrity regression.
 *
 * SC-D1: all 11 types have non-empty copy + char budgets; `interpolateTemplate`
 * with a MISSING var shows the fallback literal, never a raw `{var}`.
 * Visual mapping (SUB-C_DESIGN §2): each type resolves to its family + icon.
 *
 * # Fails-on-revert
 * Delete `businessNotificationTemplates.ts` → module error → all RED. Drop a
 * type from the record → the "11 types" assertion RED. Break the interpolate
 * fallback (return `{key}` on miss) → the no-leak assertion RED.
 *
 * Append-only post-merge per `.github/workflows/tests-append-only.yml`.
 */
import { describe, expect, test } from "@jest/globals";

import {
  BUSINESS_NOTIFICATION_TEMPLATES,
  BUSINESS_NOTIFICATION_BRANCH_COPY,
  interpolateTemplate,
  resolveNotificationVisual,
  isBusinessNotificationType,
} from "../businessNotificationTemplates";

const TYPES = Object.keys(BUSINESS_NOTIFICATION_TEMPLATES);

describe("template coverage", () => {
  test("exactly 11 v1 types (new_follower dropped)", () => {
    expect(TYPES).toHaveLength(11);
    expect(isBusinessNotificationType("business.new_follower")).toBe(false);
    expect(isBusinessNotificationType("business.order_paid")).toBe(true);
  });

  test("every type has non-empty copy within char budgets", () => {
    for (const t of Object.values(BUSINESS_NOTIFICATION_TEMPLATES)) {
      expect(t.pushTitle.length).toBeGreaterThan(0);
      expect(t.pushBody.length).toBeGreaterThan(0);
      expect(t.inAppTitle.length).toBeGreaterThan(0);
      expect(t.inAppBody.length).toBeGreaterThan(0);
      expect(t.pushTitle.length).toBeLessThanOrEqual(40);
      expect(t.pushBody.length).toBeLessThanOrEqual(120);
    }
  });

  test("team_member_joined is the one push=OFF default", () => {
    expect(
      BUSINESS_NOTIFICATION_TEMPLATES["business.team_member_joined"].defaultPush,
    ).toBe(false);
    expect(
      BUSINESS_NOTIFICATION_TEMPLATES["business.order_paid"].defaultPush,
    ).toBe(true);
  });
});

describe("interpolateTemplate", () => {
  test("interpolates present vars", () => {
    expect(
      interpolateTemplate("{eventTitle}: {amount} just came in.", {
        eventTitle: "Friday Set",
        amount: "$240.00",
      }),
    ).toBe("Friday Set: $240.00 just came in.");
  });

  test("missing var → fallback literal, never a raw {var}", () => {
    const out = interpolateTemplate("{eventTitle}: {amount} just came in.", {});
    expect(out).not.toMatch(/\{.*\}/);
    expect(out).toContain("your listing"); // eventTitle fallback
  });
});

describe("branch copy", () => {
  test("account_status_changed has both branches", () => {
    const b = BUSINESS_NOTIFICATION_BRANCH_COPY["business.account_status_changed"];
    expect(b.restricted.pushTitle).toBe("Payments paused");
    expect(b.reactivated.pushTitle).toBe("Payments back on");
  });
  test("claim_decision has both branches", () => {
    const b = BUSINESS_NOTIFICATION_BRANCH_COPY["business.claim_decision"];
    expect(b.approved.pushTitle).toBe("Claim approved");
    expect(b.rejected.pushTitle).toBe("Claim update");
  });
});

describe("visual mapping", () => {
  test("money / risk / audience / team families", () => {
    expect(resolveNotificationVisual("business.order_paid").family).toBe("money");
    expect(resolveNotificationVisual("business.dispute_action_needed")).toEqual({
      family: "risk",
      icon: "flag",
      severity: "blocking",
    });
    expect(resolveNotificationVisual("business.new_review").family).toBe("audience");
    expect(resolveNotificationVisual("business.team_member_joined").family).toBe("team");
  });
  test("stripe.* risk types map to amber risk", () => {
    expect(resolveNotificationVisual("stripe.payout_failed").family).toBe("risk");
    expect(resolveNotificationVisual("stripe.refund_processed").family).toBe("money");
  });
});
