import { useSyncExternalStore } from "react";

import {
  getPrivacySnapshot,
  subscribePrivacy,
  type PrivacySnapshot,
} from "./webAnalytics.web";

// Before hydration nothing is known: render as "saved" so no bar flashes in
// server/static HTML, then the client snapshot takes over.
const SERVER_SNAPSHOT: PrivacySnapshot = {
  saved: true,
  analytics: false,
  ads: false,
  gpc: false,
};
const getServerSnapshot = (): PrivacySnapshot => SERVER_SNAPSHOT;

/** #2331 — React bridge over the one buyer-web privacy owner. */
export function usePrivacyState(): PrivacySnapshot {
  return useSyncExternalStore(
    subscribePrivacy,
    getPrivacySnapshot,
    getServerSnapshot,
  );
}
