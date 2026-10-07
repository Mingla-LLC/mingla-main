/**
 * #3660 Phase 3 — client mirror: mutate owner-only; view owner/admin/FM.
 */

import fs from "node:fs";
import path from "node:path";

import {
  BRAND_PAYMENTS_DENIED_BODY,
  BRAND_PAYMENTS_MANAGER_ROLES,
  BRAND_PAYMENTS_VIEW_ROLES,
  canManageBrandPayments,
  canViewBrandPayments,
} from "../brandPaymentsPermission";

const ROOT = path.resolve(__dirname, "../../../../");

describe("issue_3660 payouts owner-only client mirror", () => {
  test("mutate roles are brand_owner only", () => {
    expect([...BRAND_PAYMENTS_MANAGER_ROLES]).toEqual(["brand_owner"]);
    expect(canManageBrandPayments({ role: "brand_owner", accepted: true })).toBe(
      true,
    );
    expect(canManageBrandPayments({ role: "brand_admin", accepted: true })).toBe(
      false,
    );
    expect(
      canManageBrandPayments({ role: "finance_manager", accepted: true }),
    ).toBe(false);
  });

  test("view roles keep owner/admin/FM", () => {
    expect([...BRAND_PAYMENTS_VIEW_ROLES].sort()).toEqual(
      ["brand_admin", "brand_owner", "finance_manager"].sort(),
    );
    expect(canViewBrandPayments({ role: "brand_admin", accepted: true })).toBe(
      true,
    );
    expect(
      canViewBrandPayments({ role: "finance_manager", accepted: true }),
    ).toBe(true);
    expect(canViewBrandPayments({ role: "event_manager", accepted: true })).toBe(
      false,
    );
  });

  test("denial copy names the brand owner", () => {
    expect(BRAND_PAYMENTS_DENIED_BODY).toContain("brand owner");
    expect(BRAND_PAYMENTS_DENIED_BODY.toLowerCase()).toContain("payout");
  });

  test("Paystack edge: only refresh_status is view; mutate actions require owner RPC", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "supabase/functions/brand-paystack-onboard/index.ts"),
      "utf8",
    );
    expect(source).toContain(
      'const paystackViewActions = new Set(["refresh_status"]);',
    );
    expect(source).toContain('"biz_can_view_payments_for_brand"');
    expect(source).toContain('"biz_can_mutate_payouts_for_brand"');
    // Admin/FM regression: these writes must not sit on the view allowlist.
    for (const action of ["select_provider", "clear_provider", "disconnect"]) {
      expect(source).not.toMatch(
        new RegExp(
          `paystackViewActions\\s*=\\s*new Set\\([^)]*${action}`,
        ),
      );
    }
  });

  test("Payments UI gates Paystack Change/Disconnect/clear behind owner mutate", () => {
    const source = fs.readFileSync(
      path.join(
        ROOT,
        "mingla-business/src/components/brand/BrandPaymentsView.tsx",
      ),
      "utf8",
    );
    expect(source).toContain("useCanManageBrandPayments");
    expect(source).toContain("canMutatePayouts");
    expect(source.match(/if \(!canMutatePayouts\)/g)?.length ?? 0).toBeGreaterThanOrEqual(
      4,
    );
  });
});
