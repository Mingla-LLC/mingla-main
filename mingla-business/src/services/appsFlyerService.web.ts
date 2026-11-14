/**
 * WEB SHIM for appsFlyerService — ORCH-1378 [onelink-dead-on-business-web].
 *
 * ⚠️ THE RULE THAT KEEPS THIS FILE HONEST. Every export of the NATIVE twin
 * (`appsFlyerService.ts`) MUST exist here too. TypeScript CANNOT see a gap:
 * `tsc` resolves imports to the NATIVE module (`moduleSuffixes` is unset in
 * tsconfig.json) while Metro substitutes THIS file into the web bundle. So a
 * missing export is a GREEN typecheck and a live `TypeError` in production.
 *
 * That is not hypothetical — it shipped. `subscribeOneLinkDeepLink` and
 * `resolveBusinessOneLinkDestination` were missing here, and the root `_layout`
 * threw `TypeError: subscribeOneLinkDeepLink is not a function` on EVERY
 * business-web load (reproduced 3/3).
 *
 * CI now enforces the pairing:
 * `.github/scripts/strict-grep/i-1378-web-shim-export-parity.mjs`
 * (I-PROPOSED-1378-WEB-SHIM-EXPORT-PARITY). If you add a function to the native
 * twin, add it here IN THE SAME COMMIT.
 */

// ORCH-1378 — type re-export so the shim's type surface matches the native
// twin's. Types are erased at runtime and cannot throw, but a consumer doing
// `import type { BusinessOneLinkDestination }` must resolve on both sides.
// `import type`/`export type` emit NO runtime require, so this cannot become a
// circular import of the native module into the web bundle.
import type {
  BusinessOneLinkDestination,
  HostAttachResult,
  HostInstallAttribution,
  UninstallTokenVerdict,
} from "./appsFlyerService";
import { supabase } from "./supabase";
import {
  fireHostFunnelBrowserEvent,
  getStoredAdMatchData,
  getStoredClickAttribution,
  isAdsOn,
  markHostKnownAccount,
} from "../analytics/webAnalytics";

export type {
  BusinessOneLinkDestination,
  HostAttachResult,
  HostInstallAttribution,
  UninstallTokenVerdict,
};

export function initializeAppsFlyer(): void {}

export function setAppsFlyerUserId(_userId: string): void {}

export function clearAppsFlyerUserId(): void {}

export function registerAppsFlyerDevice(_userId: string): void {}

export function resetAppsFlyerDeviceCache(): void {}

export function logAppsFlyerEvent(
  _eventName: string,
  _eventValues: Record<string, string | number | boolean> = {},
): void {}

// ─── ORCH-1378: the two exports whose ABSENCE threw on every web load ───────

/**
 * No-op — there is no AppsFlyer OneLink SDK on web, so no deep link can ever be
 * delivered and the sink is never invoked.
 *
 * RETURNS `void`, matching the native twin EXACTLY (appsFlyerService.ts:257 —
 * `subscribeOneLinkDeepLink(onDestination): void`). The native function stores
 * the sink in a module-level variable; it hands back no unsubscribe handle, and
 * the sole call site (`_layout.tsx:518`) does not read the return value.
 * Returning anything else here would re-introduce the very native/web signature
 * divergence this shim exists to prevent.
 */
export function subscribeOneLinkDeepLink(
  _onDestination: (dest: BusinessOneLinkDestination) => void,
): void {}

/**
 * No-op returning `null` (= "no destination"). Parity only: there is no
 * web-reachable call site (ORCH-1378 D-4), because only the native SDK ever
 * produces a OneLink payload to resolve.
 */
export function resolveBusinessOneLinkDestination(
  _data: Record<string, unknown> | null | undefined,
): BusinessOneLinkDestination {
  return null;
}

// ─── #4238 W4-3 / W6-1 / W6-5 / W6-7 / W6-8 / W6-11: parity no-ops ──────────
// No AppsFlyer SDK on web: nothing is queued, hashed, routed or logged.

export const PRE_INIT_EVENT_QUEUE_MAX = 50;
export const APPSFLYER_EMAIL_CRYPT_SHA256 = 3;
export const HOST_INSTALL_ATTRIBUTION_KEY = "@mingla_host_install_attribution";
export const AF_SUB1_REFERRAL_PREFIX = "ref:";

export function classifyUninstallToken(
  _token: string | null | undefined,
  _platform: string,
): UninstallTokenVerdict {
  return { ok: false, reason: "empty" };
}

export function updateAppsFlyerUninstallToken(
  _token: string | null | undefined,
): void {}

export function installAttributionFromConversionData(
  _data: Record<string, unknown> | null | undefined,
  _platform: string,
  _nowIso: string,
): HostInstallAttribution | null {
  return null;
}

export function referralCodeFromAfSub1(_value: unknown): string | null {
  return null;
}

export async function deliverBusinessOneLinkTarget(
  _target: string,
  _deps: {
    navigate: (target: string) => void;
    stashForAfterSignIn: (target: string) => Promise<void>;
  },
): Promise<"navigated" | "stashed" | "failed"> {
  return "failed";
}

export function appsFlyerAuthMethod(provider: unknown): string {
  const p = typeof provider === "string" ? provider.trim().toLowerCase() : "";
  if (p === "apple" || p === "google" || p === "phone" || p === "email") return p;
  return p.length > 0 ? "other" : "email";
}

export async function logAppsFlyerRegistrationOnce(
  _userId: string,
  _eventValues: Record<string, string | number | boolean>,
): Promise<boolean> {
  return false;
}

// ─── #4238 W3-3: host web sign-up attribution ──────────────────────────────

export function parseHostAttachResponse(data: unknown): HostAttachResult | null {
  if (!data || typeof data !== "object") return null;
  const body = data as { ok?: unknown; new_host?: unknown; host_signup_event_id?: unknown };
  if (body.ok !== true) return null;
  return {
    newHost: typeof body.new_host === "boolean" ? body.new_host : null,
    hostSignupEventId:
      typeof body.host_signup_event_id === "string" ? body.host_signup_event_id : null,
  };
}

/**
 * Called once per sign-in (AuthContext). Sends this browser's first-party
 * click id and match cookies (only while ads are on; otherwise just the
 * opt-out) to host-attribution-attach. A new host then gets the browser
 * HostSignUp twin with the server's event id. The page URL is sent without
 * its query or hash (an OAuth return carries tokens in the hash). Never throws.
 */
export async function attachHostAttribution(): Promise<HostAttachResult | null> {
  try {
    const adsOn = isAdsOn();
    const match = getStoredAdMatchData();
    const page =
      typeof window !== "undefined" && window.location
        ? `${window.location.origin}${window.location.pathname}`
        : null;
    const body = adsOn
      ? {
          surface: "web",
          tracking_opt_out: false,
          click_id: getStoredClickAttribution().clickId,
          fbp: match.fbp,
          fbc: match.fbc,
          ttp: match.ttp,
          scid: match.scid,
          page_url: page,
        }
      : { surface: "web", tracking_opt_out: true };
    const { data, error } = await supabase.functions.invoke("host-attribution-attach", {
      body,
    });
    markHostKnownAccount();
    if (error) {
      console.warn("[webAnalytics] host-attribution-attach failed:", error.message ?? error);
      return null;
    }
    const result = parseHostAttachResponse(data);
    if (adsOn && result?.newHost === true && result.hostSignupEventId) {
      void fireHostFunnelBrowserEvent("host_signup", result.hostSignupEventId);
    }
    return result;
  } catch (e) {
    console.warn("[webAnalytics] host-attribution-attach unavailable:", e);
    return null;
  }
}
