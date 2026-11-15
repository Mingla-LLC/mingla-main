/**
 * hostAttributionAttach.web.ts — #4238 W3-3: host web sign-up attribution.
 *
 * Loaded on intent (a sign-in) by appsFlyerService.web.ts attachHostAttribution,
 * so this host-only code stays out of the eager buyer web chunk (#3493).
 */
import type { HostAttachResult } from "./appsFlyerService";
import { parseHostAttachResponse } from "./appsFlyerService.web";
import { supabase } from "./supabase";
import {
  fireHostFunnelBrowserEvent,
  getStoredAdMatchData,
  getStoredClickAttribution,
  isAdsOn,
  markHostKnownAccount,
} from "../analytics/webAnalytics";

/**
 * Called once per sign-in (AuthContext). Sends this browser's first-party
 * click id and match cookies (only while ads are on; otherwise just the
 * opt-out) to host-attribution-attach. A new host then gets the browser
 * HostSignUp twin with the server's event id. The page URL is sent without
 * its query or hash (an OAuth return carries tokens in the hash). Never throws.
 */
export async function attachHostAttributionNow(): Promise<HostAttachResult | null> {
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
