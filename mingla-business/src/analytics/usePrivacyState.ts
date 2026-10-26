import type { PrivacySnapshot } from "./webAnalytics";

const NATIVE_PRIVACY_STATE: PrivacySnapshot = {
  saved: true,
  analytics: false,
  ads: false,
  gpc: false,
};

/** Native exclusion: the browser privacy bar does not exist on either native app. */
export function usePrivacyState(): PrivacySnapshot {
  return NATIVE_PRIVACY_STATE;
}
