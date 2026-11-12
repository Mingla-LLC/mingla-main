/**
 * #4389 — the one brand-delete core (app `brand-delete` and Ari `delete_brand`).
 *
 * MINGLA-INVARIANT: I-4389-DELETE-CLOSES-PROVIDERS | issue #4389 | a brand delete closes its payment accounts first (Paystack switched off, Stripe account deleted) and is blocked while money is owed or held; the database refuses a delete that skips this.
 *
 * Order (spec v1 §4.3, unchanged in v2):
 *   1. blockers (#3660's "money still owed" + upcoming events) -> delete_blocked
 *   2. Stripe balance (available + pending) not 0 -> delete_blocked
 *   3. Paystack subaccount switched off (reversible)
 *   4. Stripe account deleted; `resource_missing` counts as done (idempotent
 *      retry, R-11). Any other refusal switches Paystack back on and stops
 *      with payment_account_close_refused; nothing is deleted.
 *   5. issue_4389_finish_brand_delete (one transaction, re-checks blockers)
 *
 * `mode: "discard_draft"` (S-12): owner only, no name typing, refused with
 * not_a_draft once the brand is no longer a draft. "Already gone" is done.
 *
 * Every dependency is injected so the ordering and the compensation are
 * tested without Stripe or Paystack.
 */

export type BrandDeleteMode = "delete" | "discard_draft";

export interface BrandDeleteInput {
  brandId: string;
  userId: string;
  mode: BrandDeleteMode;
  confirmName?: string | null;
}

export interface BalanceAmount {
  currency: string;
  amount_minor: number;
}

export interface BrandDeleteDeps {
  readBrand: (brandId: string) => Promise<
    { name: string; account_id: string; deleted_at: string | null } | null
  >;
  blockers: (brandId: string, userId: string) => Promise<{
    blockers: unknown[];
    is_draft: boolean;
    stripe_account_id: string | null;
    paystack_subaccount_code: string | null;
  }>;
  stripeBalance: (accountId: string) => Promise<BalanceAmount[]>;
  stripeDeleteAccount: (accountId: string, brandId: string) => Promise<void>;
  paystackSetActive: (subaccountCode: string, active: boolean) => Promise<void>;
  finish: (
    brandId: string,
    userId: string,
    mode: BrandDeleteMode,
  ) => Promise<Record<string, unknown>>;
  audit?: (action: string, after: Record<string, unknown>) => Promise<void>;
}

export type BrandDeleteResult =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 403 | 404 | 409 | 500 | 502; body: Record<string, unknown> };

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/** Stripe "already gone": the account no longer exists for this platform. */
export function isStripeResourceMissing(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; raw?: { code?: unknown }; statusCode?: unknown; message?: unknown };
  if (e.code === "resource_missing" || e.raw?.code === "resource_missing") return true;
  return e.statusCode === 404 || /no such account|resource_missing/i.test(String(e.message ?? ""));
}

/** A classified Stripe refusal code; never the raw message (it can carry ids). */
export function classifyStripeCloseError(err: unknown): string {
  if (typeof err !== "object" || err === null) return "unknown";
  const e = err as { code?: unknown; type?: unknown; raw?: { code?: unknown } };
  const code = typeof e.code === "string" ? e.code : typeof e.raw?.code === "string" ? e.raw.code : "";
  if (/^[a-z0-9_]{2,64}$/.test(code)) return code;
  const type = typeof e.type === "string" ? e.type : "";
  if (type === "StripeConnectionError") return "stripe_unreachable";
  if (type === "StripePermissionError") return "permission_denied";
  return "unknown";
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export async function runBrandDelete(
  deps: BrandDeleteDeps,
  input: BrandDeleteInput,
): Promise<BrandDeleteResult> {
  const brand = await deps.readBrand(input.brandId);
  if (brand === null || brand.deleted_at !== null) {
    // R-11 / R-15: "already gone" counts as done.
    return { status: 200, body: { ok: true, brand_id: input.brandId, already_deleted: true, stripe: "none", paystack: "none" } };
  }
  if (brand.account_id !== input.userId) {
    return { status: 403, body: { error: "forbidden", detail: "owner_only" } };
  }
  if (input.mode === "delete" && !sameName(input.confirmName ?? "", brand.name)) {
    return { status: 400, body: { error: "confirm_name_mismatch" } };
  }

  let check: Awaited<ReturnType<BrandDeleteDeps["blockers"]>>;
  try {
    check = await deps.blockers(input.brandId, input.userId);
  } catch (err) {
    console.error("[brand-delete] blockers read failed:", errText(err));
    return { status: 500, body: { error: "internal_error" } };
  }
  if (input.mode === "discard_draft" && !check.is_draft) {
    return { status: 409, body: { error: "not_a_draft" } };
  }
  if (check.blockers.length > 0) {
    return { status: 409, body: { error: "delete_blocked", blockers: check.blockers } };
  }

  const stripeId = check.stripe_account_id;
  const paystackCode = check.paystack_subaccount_code;

  if (stripeId) {
    let amounts: BalanceAmount[];
    try {
      amounts = await deps.stripeBalance(stripeId);
    } catch (err) {
      if (isStripeResourceMissing(err)) {
        amounts = [];
      } else {
        // Fail closed: an unknown balance is never treated as zero.
        console.error("[brand-delete] balance read failed:", classifyStripeCloseError(err));
        return { status: 409, body: { error: "payment_account_close_refused", reason_code: "balance_unavailable" } };
      }
    }
    const held = amounts.filter((a) => a.amount_minor !== 0);
    if (held.length > 0) {
      return {
        status: 409,
        body: { error: "delete_blocked", blockers: [{ code: "payment_account_balance", amounts: held }] },
      };
    }
  }

  let paystackOff = false;
  if (paystackCode) {
    try {
      await deps.paystackSetActive(paystackCode, false);
      paystackOff = true;
    } catch (err) {
      console.error("[brand-delete] Paystack switch-off refused:", errText(err));
      return { status: 409, body: { error: "payment_account_close_refused", reason_code: "paystack_refused" } };
    }
  }

  if (stripeId) {
    try {
      await deps.stripeDeleteAccount(stripeId, input.brandId);
    } catch (err) {
      if (!isStripeResourceMissing(err)) {
        const reason = classifyStripeCloseError(err);
        if (paystackOff && paystackCode) {
          try {
            await deps.paystackSetActive(paystackCode, true);
          } catch (reErr) {
            console.error("[brand-delete] Paystack re-activate failed:", errText(reErr));
            await deps.audit?.("paystack.subaccount_reactivate_failed", { reason_code: reason, brand_id: input.brandId });
          }
        }
        await deps.audit?.("brand.delete_refused_by_payment_partner", { reason_code: reason, brand_id: input.brandId });
        return { status: 409, body: { error: "payment_account_close_refused", reason_code: reason } };
      }
    }
  }

  try {
    const finished = await deps.finish(input.brandId, input.userId, input.mode);
    return {
      status: 200,
      body: {
        ok: true,
        brand_id: input.brandId,
        stripe: stripeId ? "closed" : "none",
        paystack: paystackCode ? "switched_off" : "none",
        already_deleted: finished.already_deleted === true,
      },
    };
  } catch (err) {
    const message = errText(err);
    console.error("[brand-delete] finish failed:", message);
    if (message.includes("delete_blocked")) {
      return { status: 409, body: { error: "delete_blocked", blockers: [] } };
    }
    if (message.includes("not_a_draft")) return { status: 409, body: { error: "not_a_draft" } };
    // The payment accounts are closed; the brand row is not. A retry finishes
    // it (the Stripe close is idempotent: resource_missing counts as done).
    return { status: 500, body: { error: "internal_error", detail: "finish_failed_retry" } };
  }
}
