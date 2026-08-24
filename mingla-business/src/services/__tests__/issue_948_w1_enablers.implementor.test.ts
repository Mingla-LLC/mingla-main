/**
 * #948 W1 implementor happy-path regression.
 *
 * Covers the three independently shippable enablers:
 * - B-01: the segment-safe auth resume accepts `/brand/:id/connect`;
 * - B-05: token and tokenless clients parse every additive bank-routing hint;
 * - B-08: the canonical design tells users the truthful Payments path and
 *   contains no unsupported reminder promise.
 *
 * CI: the required full mingla-business Jest workflow runs this file on every
 * PR; ci-batch:issue-948-w1-enablers-tests also runs it explicitly with the Deno
 * edge-contract suite.
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

const BANK_HINT_RESPONSE = {
  brand_id: "2b7c2c59-b89f-4e77-a548-caa584b3466d",
  role: "brand_owner",
  transferred: true,
  previous_owner_account_id: null,
  new_owner_account_id: "3b7c2c59-b89f-4e77-a548-caa584b3466d",
  brand_slug: "fig-and-vine",
  new_owner_first_name: "Seth",
  partner_setup: true,
  country_code: "NG",
  payment_provider: "paystack",
  stripe_charges_enabled: true,
  stripe_payouts_enabled: true,
  paystack_subaccount_code: "ACCT_partner_123",
};

describe("#948 W1 bank-first enablers", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  test("B-01 allows the dynamic brand connect target without widening prefix or traversal defenses", () => {
    const target =
      "/brand/2b7c2c59-b89f-4e77-a548-caa584b3466d/connect?source=invite";
    expect(sanitizeNextRoute(target)).toBe(target);
    expect(sanitizeNextRoute("/brand-evil/connect")).toBeNull();
    expect(
      sanitizeNextRoute(
        "/accept-brand-invitation/../brand/2b7c2c59-b89f-4e77-a548-caa584b3466d/connect",
      ),
    ).toBeNull();
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
  ])("B-05 %s path parses every bank-routing hint", async (_label, accept) => {
    invoke.mockResolvedValueOnce({
      data: BANK_HINT_RESPONSE,
      error: null,
    } as never);

    await expect(accept()).resolves.toMatchObject({
      countryCode: "NG",
      paymentProvider: "paystack",
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      paystackSubaccountCode: "ACCT_partner_123",
    });
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
  ])("B-05 %s path fails safely when hints are absent or malformed", async (_label, accept) => {
    invoke.mockResolvedValueOnce({
      data: {
        ...BANK_HINT_RESPONSE,
        country_code: 123,
        payment_provider: "unknown",
        stripe_charges_enabled: "true",
        stripe_payouts_enabled: 1,
        paystack_subaccount_code: false,
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
  });

  test("B-08 canonical design uses the truthful Payments path and makes no reminder promise", () => {
    const design = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "../docs/design/948-949-bank-first-invite-funnel.html",
      ),
      "utf8",
    );

    expect(design).toContain("Add your bank anytime from Payments");
    expect(design.toLowerCase()).not.toContain("remind");
  });
});
