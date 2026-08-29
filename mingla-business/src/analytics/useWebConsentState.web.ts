import { useSyncExternalStore } from "react";

import {
  getStoredConsentSnapshot,
  subscribeStoredConsent,
  type StoredConsentSnapshot,
} from "./webAnalytics.web";

export type WebConsentState =
  | "unknown"
  | StoredConsentSnapshot
  | "not_applicable";

const getServerSnapshot = (): WebConsentState => "unknown";

/** React bridge over the canonical buyer-web consent owner. */
export function useWebConsentState(): WebConsentState {
  return useSyncExternalStore(
    subscribeStoredConsent,
    getStoredConsentSnapshot,
    getServerSnapshot,
  );
}
