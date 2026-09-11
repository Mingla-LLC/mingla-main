/**
 * Issues #3191 + #3192 — happy-path regression cover for payout onboarding.
 *
 * WHY THIS FILE LIVES HERE (not beside the code it tests). The code under test
 * is Deno edge-function source under `supabase/functions/**`, but the only
 * universal CI gate is `mingla-business jest (full suite)`, which runs on every
 * PR to main with no paths filter and whose roots stop at `mingla-business/src`.
 * A test placed next to the edge functions would run NOWHERE — the #1176 leaf
 * that executes the sibling Deno tests is an immutable registry entry, and new
 * `issue-*.yml` lanes are banned by I-PROPOSED-2148-CI-TOPOLOGY-BOUNDED. So the
 * tests live here and import the real modules by relative path. They execute
 * the actual implementations — these are not source scans.
 *
 * THE TWO PRODUCTION FAILURES
 *
 *   #3191  A brand whose `contact_email` held a street address
 *          ("61 Wythe Ave, Brooklyn, NY 11249") sent that string to Stripe as
 *          the connected account's contact email. Stripe answered
 *          "Invalid email"; onboarding dead-ended behind a Try again that could
 *          never succeed, naming no field.
 *
 *   #3192  Paystack de-duplicates transfer recipients: creating one for a bank
 *          account that already exists returns the EXISTING recipient_code with
 *          a success status. Proven on our own test integration 2026-09-11 —
 *          two creates on account 0000000000 / bank 057 both returned
 *          RCP_zrf3vmf1kjg3q15. A UNIQUE index on recipient_code then rejected
 *          the second holder's insert, and the failure path "rolled back" by
 *          DELETING that recipient at Paystack, destroying the first holder's
 *          live payout destination.
 *
 * FAILS ON REVERT — verified by restoring each original implementation and
 * observing these tests go red (see the issue #3192 implementation comment).
 */

import * as fs from "fs";
import * as path from "path";

import {
  isWellFormedEmail,
  MissingOrganiserEmailError,
  resolveOrganiserContactEmail,
} from "../../../../supabase/functions/_shared/organiserContactEmail";
import { isPaystackRecipientShared } from "../../../../supabase/functions/_shared/paystackRecipientSharing";
import {
  BrandRecipientError,
  saveBrandPaystackRecipient,
} from "../../../../supabase/functions/brand-paystack-onboard/recipient";
import type {
  BrandRecipientDeps,
  BrandRecipientRow,
} from "../../../../supabase/functions/brand-paystack-onboard/recipient";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const BRAND_ID = "33333333-3333-4333-8333-333333333333";
/** The exact value found on brand e005238f-…-ee32a72445bd in production. */
const PRODUCTION_BAD_EMAIL = "61 Wythe Ave, Brooklyn, NY 11249";
const VERIFIED_LOGIN_EMAIL = "seth@usemingla.com";

// ───────────────────────── #3191 — organiser contact email ──────────────────

describe("#3191 organiser contact email resolution", () => {
  it("skips the production street-address contact_email for the verified login email", () => {
    // REVERT CANARY: restoring the old `safeContactEmail` (non-empty check only)
    // returns the street address here, and Stripe rejects it exactly as in prod.
    expect(resolveOrganiserContactEmail(PRODUCTION_BAD_EMAIL, VERIFIED_LOGIN_EMAIL))
      .toBe(VERIFIED_LOGIN_EMAIL);
  });

  it("still prefers a well-formed brand contact email over the login email", () => {
    // Precedence must not invert: the organiser's deliberate choice wins.
    expect(
      resolveOrganiserContactEmail("payouts@lanternroom.com", VERIFIED_LOGIN_EMAIL),
    ).toBe("payouts@lanternroom.com");
  });

  it("never returns support@usemingla.com as an organiser identity", () => {
    // REVERT CANARY: the deleted fallback registered Mingla's own inbox on the
    // organiser's Stripe account, routing their verification and payout mail to us.
    const brandEmails: unknown[] = [
      PRODUCTION_BAD_EMAIL, null, "", "   ", undefined, 12345,
    ];
    for (const brandEmail of brandEmails) {
      expect(resolveOrganiserContactEmail(brandEmail, VERIFIED_LOGIN_EMAIL))
        .not.toContain("support@usemingla.com");
    }
  });

  it("refuses rather than inventing an address when nothing usable exists", () => {
    // Unreachable under today's email-OTP-only business auth; asserted so the
    // behaviour stays fail-closed if an auth model without email ever lands.
    expect(() => resolveOrganiserContactEmail(PRODUCTION_BAD_EMAIL, null))
      .toThrow(MissingOrganiserEmailError);
    expect(() => resolveOrganiserContactEmail(null, "not-an-email")).toThrow();
  });

  it("uses the same email shape the app enforces at sign-in", () => {
    for (const ok of ["a@b.co", "seth@usemingla.com", "  padded@x.io  "]) {
      expect(isWellFormedEmail(ok)).toBe(true);
    }
    for (const bad of [PRODUCTION_BAD_EMAIL, "no-at-sign.com", "no@dot", "two @spaces.com", ""]) {
      expect(isWellFormedEmail(bad)).toBe(false);
    }
  });
});

// ──────────────────── #3192 — a shared recipient is never deleted ───────────

/** Minimal stand-in for the supabase-js builder chain the checker walks. */
function fakeClient(rows: Record<string, Array<Record<string, string>>>) {
  return {
    from(table: string) {
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

function harness(opts: {
  shared: boolean;
  seed?: BrandRecipientRow | null;
  failPersist?: boolean;
}) {
  let stored: BrandRecipientRow | null = opts.seed ?? null;
  const calls = { deletes: [] as string[], warnings: [] as string[] };
  const deps: BrandRecipientDeps = {
    resolveAccount: ({ accountNumber }) =>
      Promise.resolve({ account_name: "ADA ORGANISER", account_number: accountNumber }),
    // Paystack hands back the code that ALREADY belongs to another brand.
    createRecipient: () => Promise.resolve({ recipient_code: "RCP_shared" }),
    deleteRecipient: (code: string) => {
      calls.deletes.push(code);
      return Promise.resolve();
    },
    fingerprintAccount: ({ bankCode, accountNumber }) =>
      Promise.resolve(`fingerprint:${bankCode}:${accountNumber}`),
    loadRecipient: () => Promise.resolve(stored),
    persistRecipient: (_brandId: string, row: BrandRecipientRow) => {
      if (opts.failPersist) {
        // The real shape: 23505 unique_violation, surfaced by PostgREST as 409.
        return Promise.reject(new Error("duplicate key value violates unique constraint"));
      }
      stored = row;
      return Promise.resolve();
    },
    deactivateRecipient: () => Promise.resolve(),
    isRecipientCodeSharedElsewhere: () => Promise.resolve(opts.shared),
    audit: () => Promise.resolve(),
    warn: (message: string) => calls.warnings.push(message),
  };
  return { calls, deps };
}

const CONNECT_INPUT = {
  action: "create_recipient" as const,
  brandId: BRAND_ID,
  accountNumber: "0123456789",
  bankCode: "058",
};

describe("#3192 shared Paystack recipients", () => {
  it("reports a code held by another brand as shared", async () => {
    const client = fakeClient({
      brand_paystack_recipients: [{ brand_id: "other-brand", recipient_code: "RCP_shared" }],
      partner_paystack_accounts: [],
    });
    await expect(
      isPaystackRecipientShared(client, "RCP_shared", { kind: "brand", brandId: BRAND_ID }),
    ).resolves.toBe(true);
  });

  it("does not delete a SHARED recipient when the local write fails", async () => {
    // REVERT CANARY: this is the production incident. Restoring the unguarded
    // `await deps.deleteRecipient(recipientCode)` rollback puts RCP_shared into
    // calls.deletes — another brand's live payout destination.
    const h = harness({ shared: true, failPersist: true });

    await expect(saveBrandPaystackRecipient(CONNECT_INPUT, h.deps))
      .rejects.toBeInstanceOf(BrandRecipientError);

    expect(h.calls.deletes).toEqual([]);
    expect(h.calls.warnings.some((w) => w.includes("shared"))).toBe(true);
  });

  it("still rolls back an UNSHARED recipient when the local write fails", async () => {
    // The guard must not become a blanket no-op, or every failed attempt leaks
    // an orphan recipient at Paystack.
    const h = harness({ shared: false, failPersist: true });

    await expect(saveBrandPaystackRecipient(CONNECT_INPUT, h.deps))
      .rejects.toBeInstanceOf(BrandRecipientError);

    expect(h.calls.deletes).toEqual(["RCP_shared"]);
  });

  it("lets a second brand connect the same bank account", async () => {
    // Seth's requirement (2026-09-10) end to end: with the UNIQUE index dropped
    // the persist succeeds, so brand two completes on the de-duplicated code.
    const h = harness({ shared: true, failPersist: false });

    const result = await saveBrandPaystackRecipient(CONNECT_INPUT, h.deps);

    expect(result.recipient_code).toBe("RCP_shared");
    expect(result.is_active).toBe(true);
    expect(h.calls.deletes).toEqual([]);
  });
});

// ───────────────── migration + call-site contracts (source scans) ───────────

describe("#3192 migration and call-site contracts", () => {
  const read = (rel: string): string =>
    fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

  it("the migration drops both recipient_code UNIQUE indexes", () => {
    const sql = read(
      "supabase/migrations/20270622003192_issue_3192_paystack_recipient_code_shared.sql",
    );
    expect(sql).toContain("DROP INDEX IF EXISTS public.brand_paystack_recipients_recipient_code_key");
    expect(sql).toContain("DROP INDEX IF EXISTS public.partner_paystack_accounts_recipient_code_key");
    // Replaced by plain btrees — the sharing check filters on recipient_code,
    // so removing the index outright would make every disconnect a seq scan.
    expect(sql).toContain("brand_paystack_recipients_recipient_code_idx");
    expect(sql).toContain("partner_paystack_accounts_recipient_code_idx");
    // Per-owner uniqueness must survive: one recipient per brand / per partner.
    expect(sql).not.toContain("DROP INDEX IF EXISTS public.brand_paystack_recipients_brand_id_key");
    expect(sql).not.toContain("DROP INDEX IF EXISTS public.partner_paystack_accounts_account_id_key");
  });

  it("no payout edge function hardcodes support@usemingla.com as an identity", () => {
    // REVERT CANARY for #3191 at both Stripe call sites.
    for (
      const rel of [
        "supabase/functions/brand-stripe-onboard/index.ts",
        "supabase/functions/partner-stripe-onboard/index.ts",
      ]
    ) {
      const src = read(rel).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(src).not.toContain("support@usemingla.com");
      expect(src).toContain("resolveOrganiserContactEmail");
    }
  });

  it("the Paystack connect handler no longer swallows its error", () => {
    // #3192 — a BARE `catch {}` discarded the error object entirely, so a
    // cross-tenant deletion surfaced as "try again in a moment".
    const src = read("mingla-business/src/components/brand/BrandPaystackOnboardView.tsx");
    const handler = src.slice(src.indexOf("const handleConnect"));
    const body = handler.slice(0, handler.indexOf("\n  };"));
    expect(body).not.toMatch(/}\s*catch\s*\{/);
    expect(body).toContain("catch (err)");
    expect(body).toContain("console.error");
  });

  it("brand edit validates the contact email before saving", () => {
    // #3191 — stop a non-email reaching brands.contact_email at the door.
    const src = read("mingla-business/src/components/brand/BrandEditView.tsx");
    expect(src).toContain("CONTACT_EMAIL_RE");
    const handler = src.slice(src.indexOf("const handleSave"));
    expect(handler.slice(0, 1200)).toContain("CONTACT_EMAIL_RE.test");
  });
});
