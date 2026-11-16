/**
 * #4238 W4b (amendment B §2): what the signed-in teammate can do on Host
 * ads, with who to ask when they can't — for the UI to disable a control
 * with a reason ("Only {ask_name} can end this ad · Ask them").
 *
 * Each answer calls THE SAME authority the action itself uses, never a
 * restatement of the role rules:
 *   plan / launch / pause / end → ad_can_host_action(<that action>)
 *   change_live                 → ad_can_host_action('fund') (host-ad-campaign)
 *   top_up / withdraw           → biz_can_manage_payments_for_brand (ad-credit)
 * A failed check is "not allowed" (fail closed). The person to ask is the
 * brand's owner, who can do every Host ad action, read from this brand only.
 */

export const HOST_AD_CAPABILITIES = [
  "plan",
  "top_up",
  "withdraw",
  "launch",
  "pause",
  "change_live",
  "end",
] as const;

export type HostAdCapability = typeof HOST_AD_CAPABILITIES[number];

export type HostAdCapabilityAnswer = {
  allowed: boolean;
  ask_role?: "brand_owner";
  ask_name?: string;
};

/** The ad_can_host_action action behind each capability (null = payments). */
export const HOST_AD_CAPABILITY_AUTHORITY: Record<
  HostAdCapability,
  "plan" | "launch" | "pause" | "fund" | "end" | null
> = {
  plan: "plan",
  top_up: null,
  withdraw: null,
  launch: "launch",
  pause: "pause",
  change_live: "fund",
  end: "end",
};

// deno-lint-ignore no-explicit-any
type Db = any;

export async function hostAdCapabilities(
  db: Db,
  brandId: string,
  userId: string,
): Promise<Record<HostAdCapability, HostAdCapabilityAnswer>> {
  const ask = async (action: string): Promise<boolean> => {
    try {
      const { data, error } = await db.rpc("ad_can_host_action", {
        p_brand_id: brandId,
        p_user_id: userId,
        p_action: action,
      });
      return !error && data === true;
    } catch {
      return false;
    }
  };
  const payments = async (): Promise<boolean> => {
    try {
      const { data, error } = await db.rpc(
        "biz_can_manage_payments_for_brand",
        { p_brand_id: brandId, p_user_id: userId },
      );
      return !error && data === true;
    } catch {
      return false;
    }
  };
  const [plan, launch, pause, fund, end, money] = await Promise.all([
    ask("plan"),
    ask("launch"),
    ask("pause"),
    ask("fund"),
    ask("end"),
    payments(),
  ]);
  const allowed: Record<HostAdCapability, boolean> = {
    plan,
    top_up: money,
    withdraw: money,
    launch,
    pause,
    change_live: fund,
    end,
  };
  let ownerName: string | null = null;
  if (Object.values(allowed).some((value) => !value)) {
    try {
      const { data: brand } = await db.from("brands").select("account_id")
        .eq("id", brandId).maybeSingle();
      if (typeof brand?.account_id === "string") {
        const { data: account } = await db.from("creator_accounts")
          .select("display_name").eq("id", brand.account_id).maybeSingle();
        ownerName = typeof account?.display_name === "string" &&
            account.display_name.trim()
          ? account.display_name.trim()
          : null;
      }
    } catch {
      ownerName = null;
    }
  }
  const out = {} as Record<HostAdCapability, HostAdCapabilityAnswer>;
  for (const key of HOST_AD_CAPABILITIES) {
    out[key] = allowed[key]
      ? { allowed: true }
      : {
        allowed: false,
        ask_role: "brand_owner",
        ...(ownerName ? { ask_name: ownerName } : {}),
      };
  }
  return out;
}
