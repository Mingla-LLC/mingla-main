/**
 * Issues #3191 + #3192 — ADVERSARIAL cover.
 *
 * The happy-path suite proves the reported bugs are fixed. This one attacks the
 * FIX, on angles that suite deliberately does not reach. Each of these would
 * pass every happy-path assertion while still losing someone's payouts:
 *
 *   1. CROSS-TABLE sharing. Brands and Growth Partners live in separate tables
 *      but share ONE Paystack integration, so de-duplication crosses between
 *      them. A guard consulting only the caller's own table still deletes the
 *      other side's recipient.
 *   2. SELF-EXCLUSION. If a holder's own row counted as sharing, cleanup would
 *      never run and orphan recipients would accumulate forever. A guard can be
 *      wrong by being too eager, not only too lax.
 *   3. FAIL-CLOSED. A sharing check that throws must skip the delete, never
 *      fall through to deleting.
 *   4. THE OTHER TWO DELETE SITES — switching banks, and disconnecting. The
 *      happy path only exercises the rollback; each of the others destroys a
 *      shared recipient just as effectively.
 *   5. Email inputs shaped to slip past a careless validator.
 *
 * See the sibling `.happy.test.ts` for why these live under mingla-business/src.
 */

import { isPaystackRecipientShared } from "../../../../supabase/functions/_shared/paystackRecipientSharing";
import {
  isWellFormedEmail,
  resolveOrganiserContactEmail,
} from "../../../../supabase/functions/_shared/organiserContactEmail";
import {
  deactivateBrandPaystackRecipient,
  saveBrandPaystackRecipient,
} from "../../../../supabase/functions/brand-paystack-onboard/recipient";
import type {
  BrandRecipientDeps,
  BrandRecipientRow,
} from "../../../../supabase/functions/brand-paystack-onboard/recipient";

const BRAND_ID = "44444444-4444-4444-8444-444444444444";
const PARTNER_ID = "55555555-5555-4555-8555-555555555555";

function fakeClient(
  rows: Record<string, Array<Record<string, string>>>,
  onQuery?: (table: string) => void,
) {
  return {
    from(table: string) {
      onQuery?.(table);
      let matched = rows[table] ?? [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: string) => {
          matched = matched.filter((r) => r[column] === value);
          return builder;
        },
        neq: (column: string, value: string) => {
          matched = matched.filter((r) => r[column] !== value);
          return builder;
        },
        limit: (n: number) =>
          Promise.resolve({ data: matched.slice(0, n), error: null }),
      };
      return builder;
    },
  };
}

describe("#3192 cross-table sharing", () => {
  it("a BRAND sees a code held only by a PARTNER as shared", async () => {
    // A brand-table-only check returns false here, and the partner's live
    // payout recipient is deleted.
    const client = fakeClient({
      brand_paystack_recipients: [],
      partner_paystack_accounts: [{ account_id: PARTNER_ID, recipient_code: "RCP_cross" }],
    });
    await expect(
      isPaystackRecipientShared(client, "RCP_cross", { kind: "brand", brandId: BRAND_ID }),
    ).resolves.toBe(true);
  });

  it("a PARTNER sees a code held only by a BRAND as shared", async () => {
    const client = fakeClient({
      brand_paystack_recipients: [{ brand_id: BRAND_ID, recipient_code: "RCP_cross" }],
      partner_paystack_accounts: [],
    });
    await expect(
      isPaystackRecipientShared(client, "RCP_cross", { kind: "partner", accountId: PARTNER_ID }),
    ).resolves.toBe(true);
  });

  it("consults both tables even when the first comes back empty", async () => {
    const seen: string[] = [];
    const client = fakeClient(
      { brand_paystack_recipients: [], partner_paystack_accounts: [] },
      (t) => seen.push(t),
    );
    await isPaystackRecipientShared(client, "RCP_none", { kind: "brand", brandId: BRAND_ID });
    expect(seen).toContain("brand_paystack_recipients");
    // Short-circuiting on an empty brand result would miss every partner holder.
    expect(seen).toContain("partner_paystack_accounts");
  });
});

describe("#3192 self-exclusion", () => {
  it("a holder's OWN row never counts as sharing", async () => {
    // Too eager is also broken: disconnect would never clean up, and orphan
    // recipients would pile up at Paystack indefinitely.
    const brandClient = fakeClient({
      brand_paystack_recipients: [{ brand_id: BRAND_ID, recipient_code: "RCP_mine" }],
      partner_paystack_accounts: [],
    });
    await expect(
      isPaystackRecipientShared(brandClient, "RCP_mine", { kind: "brand", brandId: BRAND_ID }),
    ).resolves.toBe(false);

    const partnerClient = fakeClient({
      brand_paystack_recipients: [],
      partner_paystack_accounts: [{ account_id: PARTNER_ID, recipient_code: "RCP_mine" }],
    });
    await expect(
      isPaystackRecipientShared(partnerClient, "RCP_mine", {
        kind: "partner",
        accountId: PARTNER_ID,
      }),
    ).resolves.toBe(false);
  });

  it("an unrelated recipient code is not reported as shared", async () => {
    const client = fakeClient({
      brand_paystack_recipients: [{ brand_id: "other", recipient_code: "RCP_different" }],
      partner_paystack_accounts: [{ account_id: "other", recipient_code: "RCP_alsodifferent" }],
    });
    await expect(
      isPaystackRecipientShared(client, "RCP_target", { kind: "brand", brandId: BRAND_ID }),
    ).resolves.toBe(false);
  });
});

function harness(opts: {
  sharedAnswer: boolean | "throw";
  seed?: BrandRecipientRow | null;
  failPersist?: boolean;
  newCode?: string;
}) {
  let stored: BrandRecipientRow | null = opts.seed ?? null;
  const calls = { deletes: [] as string[], warnings: [] as string[] };
  const deps: BrandRecipientDeps = {
    resolveAccount: ({ accountNumber }) =>
      Promise.resolve({ account_name: "ADA ORGANISER", account_number: accountNumber }),
    createRecipient: () =>
      Promise.resolve({ recipient_code: opts.newCode ?? "RCP_new" }),
    deleteRecipient: (code: string) => {
      calls.deletes.push(code);
      return Promise.resolve();
    },
    fingerprintAccount: ({ bankCode, accountNumber }) =>
      Promise.resolve(`fingerprint:${bankCode}:${accountNumber}`),
    loadRecipient: () => Promise.resolve(stored),
    persistRecipient: (_brandId: string, row: BrandRecipientRow) => {
      if (opts.failPersist) return Promise.reject(new Error("unique violation"));
      stored = row;
      return Promise.resolve();
    },
    deactivateRecipient: () => {
      if (stored) stored = { ...stored, is_active: false };
      return Promise.resolve();
    },
    isRecipientCodeSharedElsewhere: () =>
      opts.sharedAnswer === "throw"
        ? Promise.reject(new Error("sharing lookup exploded"))
        : Promise.resolve(opts.sharedAnswer),
    audit: () => Promise.resolve(),
    warn: (message: string) => calls.warnings.push(message),
  };
  return { calls, deps, getStored: () => stored };
}

const ACTIVE_SEED = (code: string, fingerprintAccount: string): BrandRecipientRow => ({
  recipient_code: code,
  bank_code: "058",
  account_fingerprint: `fingerprint:058:${fingerprintAccount}`,
  account_number_masked: `••••${fingerprintAccount.slice(-4)}`,
  account_name: "ADA ORGANISER",
  is_active: true,
});

describe("#3192 the guard holds at every delete site", () => {
  it("a THROWING sharing check fails closed and deletes nothing", async () => {
    // The dangerous refactor is `catch { deleteAnyway() }`. If safety cannot be
    // established, the only correct move is to leave the provider object alone.
    const h = harness({ sharedAnswer: "throw", failPersist: true });

    await expect(
      saveBrandPaystackRecipient(
        { action: "create_recipient", brandId: BRAND_ID, accountNumber: "0123456789", bankCode: "058" },
        h.deps,
      ),
    ).rejects.toThrow();

    expect(h.calls.deletes).toEqual([]);
    expect(h.calls.warnings.some((w) => w.includes("check failed"))).toBe(true);
  });

  it("switching banks does not delete a shared PREVIOUS code", async () => {
    // Second delete site: the code being left behind can belong to another
    // brand just as easily as the new one can.
    const h = harness({
      sharedAnswer: true,
      newCode: "RCP_new",
      seed: ACTIVE_SEED("RCP_previous_shared", "0000000001"),
    });

    await saveBrandPaystackRecipient(
      { action: "update_recipient", brandId: BRAND_ID, accountNumber: "0123456789", bankCode: "058" },
      h.deps,
    );

    expect(h.calls.deletes).toEqual([]);
  });

  it("disconnecting does not delete a shared code at the provider", async () => {
    // Third delete site. The local row is still deactivated — only the provider
    // object is spared, because other holders still settle to it.
    const h = harness({
      sharedAnswer: true,
      seed: ACTIVE_SEED("RCP_shared_on_disconnect", "0123456789"),
    });

    await deactivateBrandPaystackRecipient(BRAND_ID, h.deps);

    expect(h.calls.deletes).toEqual([]);
    expect(h.getStored()?.is_active).toBe(false);
  });

  it("disconnecting DOES delete a code nobody else holds", async () => {
    const h = harness({ sharedAnswer: false, seed: ACTIVE_SEED("RCP_sole", "0123456789") });

    await deactivateBrandPaystackRecipient(BRAND_ID, h.deps);

    expect(h.calls.deletes).toEqual(["RCP_sole"]);
  });
});

describe("#3191 email inputs built to slip through", () => {
  it("rejects near-miss addresses rather than coercing them", () => {
    const bad = [
      "61 Wythe Ave, Brooklyn, NY 11249", // the production value
      "seth@usemingla",                    // no TLD dot
      "@usemingla.com",                    // empty local part
      "seth@",                             // empty domain
      "seth @usemingla.com",               // embedded space
      "seth@use mingla.com",               // space in domain
      "seth@@usemingla.com",               // double at
      "\t\n",                              // whitespace only
      "0123456789",                        // an account number
    ];
    for (const value of bad) {
      expect(isWellFormedEmail(value)).toBe(false);
    }
  });

  it("never leaks a malformed brand email into the resolved value", () => {
    // The result must be the auth email VERBATIM — not a repaired, concatenated
    // or partially salvaged version of the bad brand value.
    const resolved = resolveOrganiserContactEmail(
      "61 Wythe Ave, Brooklyn, NY 11249",
      "seth@usemingla.com",
    );
    expect(resolved).toBe("seth@usemingla.com");
    expect(resolved).not.toContain("Wythe");
    expect(resolved).not.toContain("Brooklyn");
  });

  it("trims and honours a padded but valid brand email", () => {
    expect(
      resolveOrganiserContactEmail("  payouts@lanternroom.com  ", "seth@usemingla.com"),
    ).toBe("payouts@lanternroom.com");
  });
});
