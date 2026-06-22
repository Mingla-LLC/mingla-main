/**
 * AppsFlyer Server-to-Server (S2S) event poster (ORCH-0808).
 *
 * Used by the Stripe webhook router to fire revenue events (first ticket sold,
 * first payout received, stripe-connect activation) without requiring the
 * organiser's device to be online.
 *
 * Hard contract: NEVER throws. AppsFlyer S2S failure must never propagate to
 * the Stripe webhook caller — Stripe will retry the whole webhook on any 5xx,
 * which would cause duplicate downstream side-effects (e.g. duplicate order
 * notifications). All failures log + return false.
 *
 * Env required (set via `supabase secrets set` on the linked project):
 *   - APPSFLYER_BUSINESS_DEV_KEY
 *   - APPSFLYER_BUSINESS_IOS_APP_ID         (bare 10-digit Apple ID)
 *   - APPSFLYER_BUSINESS_ANDROID_APP_ID     (Android package name)
 *
 * Spec: Mingla_Artifacts/specs/SPEC_ORCH-0808_APPSFLYER_MINGLA_BUSINESS.md §3.2
 */

// ORCH-1201 — Layer-C passive health observation (fire-and-forget, best-effort).
import { recordApiCall } from "./apiHealthLog.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

const APPSFLYER_S2S_BASE = "https://api3.appsflyer.com/inappevent";

export interface AppsFlyerS2SEventValues {
  // Reserved AppsFlyer revenue fields — string or number both accepted by AF.
  af_revenue?: number;
  af_currency?: string;
  // Custom fields — IDs and small primitives only. No PII.
  [k: string]: string | number | boolean | undefined;
}

interface AppsFlyerDeviceRow {
  appsflyer_uid: string;
  platform: "ios" | "android";
}

/**
 * Look up the most-recent `business` AppsFlyer device row for a Supabase user.
 * Returns null if the user has never signed into the Mingla Business app on a
 * device, or if the row was not registered (env missing during install).
 */
async function fetchBusinessDevice(
  supabase: SupabaseClient,
  userId: string,
): Promise<AppsFlyerDeviceRow | null> {
  const { data, error } = await supabase
    .from("appsflyer_devices")
    .select("appsflyer_uid, platform")
    .eq("user_id", userId)
    .eq("app", "business")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(
      "[AppsFlyerS2S] device lookup failed:",
      error.message ?? String(error),
    );
    return null;
  }
  return data as AppsFlyerDeviceRow | null;
}

/**
 * Resolve the Mingla Business owner user_id for a brand via creator_accounts.
 * `brands.account_id` references `creator_accounts.id` which is the auth user
 * UUID. Returns null if the brand has no owner (data anomaly) or is missing.
 */
export async function resolveBrandOwnerUserId(
  supabase: SupabaseClient,
  brandId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("brands")
    .select("account_id")
    .eq("id", brandId)
    .maybeSingle();
  if (error) {
    console.warn(
      "[AppsFlyerS2S] brand owner lookup failed:",
      error.message ?? String(error),
    );
    return null;
  }
  return (data?.account_id as string | null) ?? null;
}

interface PostS2SInput {
  supabase: SupabaseClient;
  userId: string;
  eventName: string;
  eventValues?: AppsFlyerS2SEventValues;
  /** Override eventTime; defaults to now. Format: "YYYY-MM-DD HH:MM:SS.SSS". */
  eventTime?: string;
}

function formatEventTime(d: Date): string {
  // AppsFlyer S2S accepts "YYYY-MM-DD HH:MM:SS.SSS" (UTC).
  const pad = (n: number, w = 2): string => n.toString().padStart(w, "0");
  return [
    d.getUTCFullYear(),
    "-",
    pad(d.getUTCMonth() + 1),
    "-",
    pad(d.getUTCDate()),
    " ",
    pad(d.getUTCHours()),
    ":",
    pad(d.getUTCMinutes()),
    ":",
    pad(d.getUTCSeconds()),
    ".",
    pad(d.getUTCMilliseconds(), 3),
  ].join("");
}

/**
 * Post an AppsFlyer S2S in-app event for a given Supabase user.
 *
 * Resolves the user's business install (appsflyer_devices.app='business'),
 * picks the matching iOS/Android app id from env, and POSTs to the AF endpoint.
 *
 * Returns true on 2xx, false on any error (env missing, no device row, HTTP
 * failure). Never throws.
 */
export async function postAppsFlyerS2SEvent(
  input: PostS2SInput,
): Promise<boolean> {
  const devKey = Deno.env.get("APPSFLYER_BUSINESS_DEV_KEY");
  const iosAppId = Deno.env.get("APPSFLYER_BUSINESS_IOS_APP_ID");
  const androidAppId = Deno.env.get("APPSFLYER_BUSINESS_ANDROID_APP_ID");
  if (!devKey || !iosAppId || !androidAppId) {
    console.warn(
      "[AppsFlyerS2S] env missing — skip. Set APPSFLYER_BUSINESS_DEV_KEY + APPSFLYER_BUSINESS_IOS_APP_ID + APPSFLYER_BUSINESS_ANDROID_APP_ID.",
    );
    return false;
  }

  const device = await fetchBusinessDevice(input.supabase, input.userId);
  if (!device) {
    if (Deno.env.get("DENO_ENV") === "development") {
      console.log(
        `[AppsFlyerS2S] no business device for user ${input.userId} — skip ${input.eventName}`,
      );
    }
    return false;
  }

  const appId = device.platform === "ios" ? iosAppId : androidAppId;
  const url = `${APPSFLYER_S2S_BASE}/${appId}`;
  const body = {
    appsflyer_id: device.appsflyer_uid,
    customer_user_id: input.userId,
    eventName: input.eventName,
    eventValue: JSON.stringify(input.eventValues ?? {}),
    eventTime: input.eventTime ?? formatEventTime(new Date()),
    eventCurrency:
      typeof input.eventValues?.af_currency === "string"
        ? input.eventValues.af_currency
        : "USD",
  };

  const _t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        // AppsFlyer S2S spec: header key is literally lowercase `authentication`.
        "authentication": devKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    void recordApiCall("appsflyer", res.ok, Date.now() - _t0, res.status); // ORCH-1201 Layer-C
    if (!res.ok) {
      const text = await res.text().catch(() => "<no body>");
      console.warn(
        `[AppsFlyerS2S] ${input.eventName} POST failed: ${res.status} ${text}`,
      );
      return false;
    }
    return true;
  } catch (e) {
    void recordApiCall("appsflyer", false, Date.now() - _t0); // ORCH-1201 Layer-C (network error)
    console.warn(
      `[AppsFlyerS2S] ${input.eventName} POST threw:`,
      e instanceof Error ? e.message : String(e),
    );
    return false;
  }
}

/**
 * Set a brand milestone column atomically. Returns true if the column was
 * NULL prior to this call (i.e. this is the "first" occurrence and the caller
 * should fire the S2S event). Returns false if the column was already set
 * (idempotent — the event already fired in a prior webhook).
 *
 * Uses a single UPDATE with WHERE clause on the NULL column to avoid a
 * lock-prone two-step read/write race. The row is upserted first if missing.
 */
export async function claimBrandMilestone(
  supabase: SupabaseClient,
  brandId: string,
  column: "first_ticket_sold_at" | "first_payout_at" | "first_activated_at",
): Promise<boolean> {
  // Ensure the milestone row exists. No-op if already present.
  const { error: upsertError } = await supabase
    .from("brand_appsflyer_milestones")
    .upsert({ brand_id: brandId }, { onConflict: "brand_id" });
  if (upsertError) {
    console.warn(
      "[AppsFlyerS2S] milestone upsert failed:",
      upsertError.message ?? String(upsertError),
    );
    return false;
  }

  // Atomic claim: UPDATE ... WHERE column IS NULL. Postgres returns the
  // affected row only if the WHERE matched, so we know whether we won the
  // race. RETURNING is necessary because supabase-js returns affected-row
  // data only via .select() chained after .update().
  const nowIso = new Date().toISOString();
  const { data, error: updateError } = await supabase
    .from("brand_appsflyer_milestones")
    .update({ [column]: nowIso, updated_at: nowIso })
    .eq("brand_id", brandId)
    .is(column, null)
    .select("brand_id")
    .maybeSingle();
  if (updateError) {
    console.warn(
      `[AppsFlyerS2S] milestone claim ${column} failed:`,
      updateError.message ?? String(updateError),
    );
    return false;
  }
  return data !== null;
}
