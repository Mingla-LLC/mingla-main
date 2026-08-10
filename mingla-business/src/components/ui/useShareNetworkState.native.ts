import { useNetInfoSafe } from '../../lib/netinfoSafe';

export function useShareNetworkState(): boolean {
  const state = useNetInfoSafe();
  if (state === null) {
    // #1758: this binary predates the netinfo dependency (#1719) — degrade to
    // "online" so sharing stays usable; the share flow's own transient/terminal
    // error states surface real network failures. Real offline detection
    // returns with the next native build (netinfo autolinks).
    return true;
  }
  return state.isConnected === true && state.isInternetReachable !== false;
}
