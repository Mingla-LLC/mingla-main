/**
 * #4541 — what the app does for forms once someone is signed in:
 *
 *   - R2.3 S-SIGNIN: a form opened while signed out is held under
 *     `mingla_pending_form_route_v1` (the pending-path pattern of
 *     pendingRsvpGuest.ts) and reopened after sign-in. The held route never
 *     carries a personal link token (Q7: signing in answers as yourself).
 *   - R2.11: report, at most once a day, that this phone can open the form
 *     screen (`mingla_form_capability_reported_v1`). A failure is ignored and
 *     logged once.
 *
 * Both keys start with `mingla_`, so sign-out clears them
 * (performPrivateAuthCleanup). Loaded on use by app/index.tsx.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { reportFormCapability } from "../../services/brandFormService";

export const PENDING_FORM_ROUTE_KEY = "mingla_pending_form_route_v1";
export const FORM_CAPABILITY_KEY = "mingla_form_capability_reported_v1";
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CAPABILITY_EVERY_MS = 24 * 60 * 60 * 1000;

/** The route without its personal token. Pure. */
export function stripFormToken(path: string): string {
  const [base, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.delete("t");
  const rest = params.toString();
  return rest.length > 0 ? `${base}?${rest}` : base;
}

export async function setPendingFormRoute(path: string): Promise<void> {
  if (!path.startsWith("/form/")) return;
  try {
    await AsyncStorage.setItem(PENDING_FORM_ROUTE_KEY, JSON.stringify({ path: stripFormToken(path), ts: Date.now() }));
  } catch (error) {
    console.warn("[forms] pending route not saved", error instanceof Error ? error.name : "unknown");
  }
}

/** The held route (removed as it is read), or null when none or stale. */
export async function takePendingFormRoute(now = Date.now()): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_FORM_ROUTE_KEY);
    if (raw === null) return null;
    await AsyncStorage.removeItem(PENDING_FORM_ROUTE_KEY);
    const parsed = JSON.parse(raw) as { path?: unknown; ts?: unknown } | null;
    if (
      parsed === null || typeof parsed.path !== "string" || !parsed.path.startsWith("/form/") ||
      typeof parsed.ts !== "number" || now - parsed.ts > PENDING_MAX_AGE_MS
    ) return null;
    return parsed.path;
  } catch (error) {
    console.warn("[forms] pending route not read", error instanceof Error ? error.name : "unknown");
    return null;
  }
}

let capabilityFailureLogged = false;

/** R2.11 — at most once a day per phone; failures are ignored (logged once). */
export async function reportFormCapabilityDaily(
  platform: string,
  appVersion: string | null | undefined,
  now = Date.now(),
): Promise<void> {
  if (platform !== "ios" && platform !== "android") return;
  if (typeof appVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(appVersion)) return;
  try {
    const last = Number(await AsyncStorage.getItem(FORM_CAPABILITY_KEY));
    if (Number.isFinite(last) && last > 0 && now - last < CAPABILITY_EVERY_MS) return;
    await reportFormCapability(platform, appVersion);
    await AsyncStorage.setItem(FORM_CAPABILITY_KEY, String(now));
  } catch (error) {
    if (!capabilityFailureLogged) {
      capabilityFailureLogged = true;
      console.warn("[forms] capability report skipped", error instanceof Error ? error.message : "unknown");
    }
  }
}

/** Tests only. */
export function __resetFormsStartupForTest(): void {
  capabilityFailureLogged = false;
}
