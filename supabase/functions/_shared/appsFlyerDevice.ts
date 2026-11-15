/**
 * #4238 W4-1 (D20): the env-free half of the AppsFlyer S2S helper. No secret
 * is read here (appsFlyerS2S.ts owns APPSFLYER_S2S_TOKEN and the Host app ids),
 * so the conversion hook can resolve an Explorer device without adding
 * AppsFlyer secrets to every function that records a conversion.
 */

import { majorFromMinor } from "./money/formatMinor.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export interface AppsFlyerDeviceRow {
  appsflyer_uid: string;
  platform: "ios" | "android";
  /**
   * #4238 P1-4 / P2-4 (I-4238-AF-RESPECTS-OPT-OUT): the app's "share usage
   * data" / Analytics switch, written by the app on registration and on every
   * change. True means no server-to-server AppsFlyer post for this install.
   */
  tracking_opt_out?: boolean;
}

/** #4238 P1-4 / P2-4: the install's analytics switch is off. */
export function appsFlyerDeviceOptedOut(
  device: AppsFlyerDeviceRow | null | undefined,
): boolean {
  return device?.tracking_opt_out === true;
}

/** Which Mingla app an S2S event belongs to (appsflyer_devices.app). */
export type AppsFlyerApp = "consumer" | "business";

/**
 * #4238 W4-1 (D20): the Explorer app's AppsFlyer app ids. Public store ids, not
 * secrets (the same values ship in app-mobile/app.config.js), so they are
 * constants: the project is at its secret ceiling and needs no new env name.
 */
export const EXPLORER_APPSFLYER_APP_IDS = {
  ios: "id6760440898",
  android: "com.mingla.app.v2",
} as const;

/** One device lookup: the row (or null), and whether the read itself failed. */
export interface AppsFlyerDeviceLookup {
  device: AppsFlyerDeviceRow | null;
  /** True when the database read failed (retryable), not "no device". */
  lookupFailed: boolean;
}

/**
 * #4238 P2-R1: `tracking_opt_out` is added by M-2. Until M-2 is applied, the
 * select names a column that does not exist (PostgREST 42703). That is not a
 * missing device: the lookup is retried without the column.
 */
function isMissingOptOutColumn(error: unknown): boolean {
  const record = (error ?? {}) as { code?: unknown; message?: unknown };
  if (record.code === "42703") return true;
  const message = typeof record.message === "string" ? record.message : "";
  return /tracking_opt_out/.test(message) &&
    /does not exist|could not find|schema cache/i.test(message);
}

/**
 * Look up the most-recent AppsFlyer device row of one app for a Supabase user.
 * `device` is null if the user has never signed into that app on a device, or
 * if the row was not registered (env missing during install). `app` defaults
 * to `business`, so every pre-#4238 caller is unchanged.
 *
 * #4238 P2-R1 (I-4238-AF-DEVICE-FAILS-OPEN-BEFORE-M2): before M-2 adds
 * `tracking_opt_out`, the row is read without it and the install counts as
 * not opted out. That is safe: an opt-out can only be stored in that column,
 * so none can exist yet. Any other read error is `lookupFailed` (retryable).
 */
export async function lookupAppsFlyerDevice(
  supabase: SupabaseClient,
  userId: string,
  app: AppsFlyerApp = "business",
): Promise<AppsFlyerDeviceLookup> {
  const read = (columns: string) =>
    supabase
      .from("appsflyer_devices")
      .select(columns)
      .eq("user_id", userId)
      .eq("app", app)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  let { data, error } = await read("appsflyer_uid, platform, tracking_opt_out");
  if (error && isMissingOptOutColumn(error)) {
    console.error(
      "[AppsFlyerS2S] appsflyer_devices.tracking_opt_out is missing (apply M-2); reading the device without it",
    );
    ({ data, error } = await read("appsflyer_uid, platform"));
    if (!error && data) {
      data = { ...(data as AppsFlyerDeviceRow), tracking_opt_out: false };
    }
  }
  if (error) {
    console.warn(
      "[AppsFlyerS2S] device lookup failed:",
      error.message ?? String(error),
    );
    return { device: null, lookupFailed: true };
  }
  return {
    device: (data as AppsFlyerDeviceRow | null) ?? null,
    lookupFailed: false,
  };
}

/** The device row, or null (no device, or the read failed). */
export async function fetchAppsFlyerDevice(
  supabase: SupabaseClient,
  userId: string,
  app: AppsFlyerApp = "business",
): Promise<AppsFlyerDeviceRow | null> {
  return (await lookupAppsFlyerDevice(supabase, userId, app)).device;
}

export function formatEventTime(d: Date): string {
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
 * #4238 W6-2 (I-4238-HOST-EVENTS-NO-REVENUE): Host money (a host's first ticket
 * sale, a payout) is the host's money, not Mingla revenue, so it never rides
 * af_revenue. It goes as plain values: the stored minor amount, the major
 * amount by the currency's own exponent (JPY 1500 stays 1500), and the code.
 */
export function hostMoneyEventValues(
  prefix: "ticket_gross" | "payout",
  amountMinor: number,
  currency: string,
): Record<string, string | number> {
  const minor = Number.isFinite(amountMinor) ? Math.round(amountMinor) : 0;
  const code = typeof currency === "string"
    ? currency.trim().toUpperCase()
    : "";
  return {
    [`${prefix}_minor`]: minor,
    [prefix]: majorFromMinor(minor, code),
    currency: code,
  };
}

/**
 * Resolve the Mingla Host owner user_id for a brand via creator_accounts.
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
  column:
    | "first_ticket_sold_at"
    | "first_payout_at"
    // `first_activated_at` = Stripe charges_enabled (CHARGE-ready).
    | "first_activated_at"
    // #3645 PR10 — Paystack payout bank attached (PAYOUT-ready).
    | "first_bank_added_at",
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
