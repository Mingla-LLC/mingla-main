import { useShareNetworkState } from "../components/ui/useShareNetworkState";

import type { NetInfoSafeState } from "./netinfoSafe";

/**
 * Web already has an authoritative, event-driven connectivity signal. Keeping
 * that boundary here avoids booting the native NetInfo implementation in the
 * browser while preserving the same hook contract for Recent.
 */
export function useNetInfoSafe(): NetInfoSafeState {
  const online = useShareNetworkState();
  return { isConnected: online, isInternetReachable: online };
}

export function isNetInfoAvailable(): boolean {
  return true;
}
