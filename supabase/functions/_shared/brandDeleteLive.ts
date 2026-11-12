/**
 * #4389 — the live (Supabase + Stripe + Paystack) dependencies for
 * `runBrandDelete`. Kept apart from the pure core so the core's tests never
 * import a provider SDK.
 */
// deno-lint-ignore-file no-explicit-any
import { STRIPE_API_VERSION, stripeBalances, stripeDetach } from "./stripe.ts";
import { paystackUpdateSubaccount } from "./paystack.ts";
import type { BalanceAmount, BrandDeleteDeps } from "./brandDelete.ts";

const BALANCE_TIMEOUT_MS = 10_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export function liveBrandDeleteDeps(supabase: any, userId: string): BrandDeleteDeps {
  return {
    readBrand: async (brandId) => {
      const { data, error } = await supabase
        .from("brands")
        .select("name, account_id, deleted_at")
        .eq("id", brandId)
        .maybeSingle();
      if (error) throw new Error(`brand_read_failed:${error.message}`);
      return data ?? null;
    },
    blockers: async (brandId, uid) => {
      const { data, error } = await supabase.rpc("issue_4389_brand_deletion_blockers_internal", {
        p_brand_id: brandId,
        p_user_id: uid,
      });
      if (error) throw new Error(error.message);
      return {
        blockers: Array.isArray(data?.blockers) ? data.blockers : [],
        is_draft: data?.is_draft === true,
        stripe_account_id: data?.providers?.stripe_account_id ?? null,
        paystack_subaccount_code: data?.providers?.paystack_subaccount_code ?? null,
      };
    },
    stripeBalance: async (accountId) => {
      const stripe: any = stripeBalances();
      const balance = await withTimeout<any>(
        stripe.balance.retrieve({}, { stripeAccount: accountId }),
        BALANCE_TIMEOUT_MS,
      );
      const out: BalanceAmount[] = [];
      for (const bucket of [...(balance?.available ?? []), ...(balance?.pending ?? [])]) {
        const currency = String(bucket?.currency ?? "").toUpperCase();
        const amount = Number(bucket?.amount ?? 0);
        const hit = out.find((o) => o.currency === currency);
        if (hit) hit.amount_minor += amount;
        else out.push({ currency, amount_minor: amount });
      }
      return out;
    },
    stripeDeleteAccount: async (accountId, brandId) => {
      const stripe: any = stripeDetach();
      await stripe.accounts.del(accountId, undefined, {
        apiVersion: STRIPE_API_VERSION,
        // Deterministic: a retry replays the same delete.
        idempotencyKey: `${brandId}:issue4389_brand_delete:${accountId}`,
      });
    },
    paystackSetActive: async (code, active) => {
      await paystackUpdateSubaccount(code, { active });
    },
    finish: async (brandId, uid, mode) => {
      const { data, error } = await supabase.rpc("issue_4389_finish_brand_delete", {
        p_brand_id: brandId,
        p_user_id: uid,
        p_mode: mode,
      });
      if (error) throw new Error(error.message);
      return (data ?? {}) as Record<string, unknown>;
    },
    audit: async (action, after) => {
      const { error } = await supabase.from("audit_log").insert({
        user_id: userId,
        brand_id: typeof after.brand_id === "string" ? after.brand_id : null,
        action,
        target_type: "brand",
        after,
      });
      if (error) console.error("[brand-delete] audit failed:", error.message);
    },
  };
}
