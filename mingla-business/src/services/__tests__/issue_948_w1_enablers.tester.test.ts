/**
 * #948 W1 independent tester adversarial regression.
 *
 * Cross-contract fail-closed matrix:
 * - the broadened `/brand` boundary accepts the intended dynamic route while
 *   rejecting prefix, traversal, encoding, protocol, malformed, and oversized
 *   inputs;
 * - absent/null edge enrichment cannot become a selected rail or connected-bank
 *   signal in either raw-token or tokenless client parsing;
 * - the D4 skip contract contains the founder-approved Payments path and no
 *   unsupported reminder promise.
 *
 * CI: the required full mingla-business Jest workflow auto-discovers this file;
 * ci-batch:issue-948-w1-enablers-tests also executes it explicitly.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

jest.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

import {
  acceptBrandInvitation,
  acceptMyPendingInvitation,
} from "../brandInvitationsService";
import { supabase } from "../supabase";
import { sanitizeNextRoute } from "../../utils/nextRoute";

const invoke = supabase.functions.invoke as jest.MockedFunction<
  typeof supabase.functions.invoke
>;

describe("#948 W1 independent tester adversarial contract", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  test("B-01 brand resume is segment-safe and fails closed across hostile boundaries", () => {
    const brandId = "2b7c2c59-b89f-4e77-a548-caa584b3466d";
    const intended = `/brand/${brandId}/connect?source=invite#bank`;

    expect(sanitizeNextRoute(intended)).toBe(intended);

    const rejected: readonly unknown[] = [
      "/brand-evil/connect",
      "/brand.evil/connect",
      "/brands/connect",
      "//evil.example/brand/x/connect",
      "/\\evil.example/brand/x/connect",
      "https://evil.example/brand/x/connect",
      "/brand/../auth",
      "/brand/%2e%2e/auth",
      "/brand/%2E%2E/auth",
      "/brand/%252e%252e/auth",
      "/brand%2fsecret/connect",
      "/%2f%2fevil.example/brand/x/connect",
      "/brand/%ZZ/connect",
      [intended, "/brand/attacker/connect"],
      null,
      undefined,
    ];

    for (const candidate of rejected) {
      expect(sanitizeNextRoute(candidate as never)).toBeNull();
    }

    const maxLengthValid = `/brand/${"a".repeat(2048 - "/brand/".length)}`;
    expect(maxLengthValid).toHaveLength(2048);
    expect(sanitizeNextRoute(maxLengthValid)).toBe(maxLengthValid);
    expect(sanitizeNextRoute(`${maxLengthValid}a`)).toBeNull();
  });

  test.each([
    ["raw-token", () => acceptBrandInvitation("token_1234567890123456")],
    [
      "tokenless invitation id",
      () =>
        acceptMyPendingInvitation(
          "4b7c2c59-b89f-4e77-a548-caa584b3466d",
        ),
    ],
  ])(
    "B-05 %s path treats absent and null enrichment as unknown and disconnected",
    async (_label, accept) => {
      invoke.mockResolvedValueOnce({
        data: {
          brand_id: "2b7c2c59-b89f-4e77-a548-caa584b3466d",
          role: "brand_owner",
          transferred: true,
          partner_setup: true,
          country_code: null,
          payment_provider: null,
          stripe_charges_enabled: null,
          // stripe_payouts_enabled and paystack_subaccount_code omitted.
        },
        error: null,
      } as never);

      await expect(accept()).resolves.toMatchObject({
        countryCode: null,
        paymentProvider: null,
        stripeChargesEnabled: false,
        stripePayoutsEnabled: false,
        paystackSubaccountCode: null,
      });
    },
  );

  test("B-05 edge defaults and response envelope are explicit fail-closed values", () => {
    const edgeSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "../supabase/functions/accept-brand-invitation/index.ts",
      ),
      "utf8",
    );

    expect(edgeSource).toMatch(
      /let resolvedCountryCode: string \| null = null;/,
    );
    expect(edgeSource).toMatch(
      /let resolvedPaymentProvider: "stripe" \| "paystack" \| null = null;/,
    );
    expect(edgeSource).toContain(
      "let resolvedStripeChargesEnabled = false;",
    );
    expect(edgeSource).toContain(
      "let resolvedStripePayoutsEnabled = false;",
    );
    expect(edgeSource).toMatch(
      /let resolvedPaystackSubaccountCode: string \| null = null;/,
    );

    for (const field of [
      "country_code: enrichment.countryCode",
      "payment_provider: enrichment.paymentProvider",
      "stripe_charges_enabled: enrichment.stripeChargesEnabled",
      "stripe_payouts_enabled: enrichment.stripePayoutsEnabled",
      "paystack_subaccount_code: enrichment.paystackSubaccountCode",
    ]) {
      expect(edgeSource).toContain(field);
    }
  });

  test("B-08 D4 skip contract uses Payments and contains zero reminder promise", () => {
    const design = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "../docs/design/948-949-bank-first-invite-funnel.html",
      ),
      "utf8",
    );
    const skipStart = design.indexOf("/* ---------- D4 · skip ---------- */");
    const skipEnd = design.indexOf(
      "/* ---------- D5 · already connected ---------- */",
    );

    expect(skipStart).toBeGreaterThanOrEqual(0);
    expect(skipEnd).toBeGreaterThan(skipStart);

    const skipContract = design.slice(skipStart, skipEnd);
    expect(skipContract).toContain("Add your bank anytime from Payments");
    expect(skipContract).not.toMatch(/\b(?:we(?:'|’)ll|we will)\s+remind\b/i);
  });
});
