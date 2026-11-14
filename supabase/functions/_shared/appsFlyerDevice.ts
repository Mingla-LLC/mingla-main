/**
 * #4238 W4-1 (D20): the env-free half of the AppsFlyer S2S helper. No secret
 * is read here (appsFlyerS2S.ts owns APPSFLYER_S2S_TOKEN and the Host app ids),
 * so the conversion hook can resolve an Explorer device without adding
 * AppsFlyer secrets to every function that records a conversion.
 */

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export interface AppsFlyerDeviceRow {
  appsflyer_uid: string;
  platform: "ios" | "android";
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

/**
 * Look up the most-recent AppsFlyer device row of one app for a Supabase user.
 * Returns null if the user has never signed into that app on a device, or if
 * the row was not registered (env missing during install). `app` defaults to
 * `business`, so every pre-#4238 caller is unchanged.
 */
export async function fetchAppsFlyerDevice(
  supabase: SupabaseClient,
  userId: string,
  app: AppsFlyerApp = "business",
): Promise<AppsFlyerDeviceRow | null> {
  const { data, error } = await supabase
    .from("appsflyer_devices")
    .select("appsflyer_uid, platform")
    .eq("user_id", userId)
    .eq("app", app)
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
