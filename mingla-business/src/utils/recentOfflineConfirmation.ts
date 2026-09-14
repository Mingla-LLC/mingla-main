/**
 * issue #3347 — Recent says "offline" only when being offline is CONFIRMED.
 *
 * The device network status is a hint, not proof. On iOS,
 * `@react-native-community/netinfo` reads the system reachability flags once at
 * start-up and afterwards only reports CHANGES. If that first read lands before
 * the system has decided (typical straight after a cold boot or simulator
 * restart), the app starts as "not connected", and nothing ever changes, so it
 * stays "not connected" for the whole session while the internet works. Recent
 * used to trust that hint, stop asking the server and show "You're offline"
 * until the app was relaunched.
 *
 * Confirmation needs BOTH:
 *   - the hint says not connected (`isConnected === false`; `null` = unknown and
 *     a missing native module = assume online, #1758), AND
 *   - Recent's own latest server request failed with a connection error.
 * A server answer disproves the hint; a hint alone never shows the banner.
 *
 * Leaf module (no imports) so it runs in the node jest environment.
 */
export interface RecentNetworkHint {
  isConnected: boolean | null;
}

/** The device status says we are not connected. Unknown is not offline. */
export const recentOfflineHint = (
  network: RecentNetworkHint | null | undefined,
): boolean => network?.isConnected === false;

/**
 * True only when the hint AND a failed server request agree. `errorKind` is
 * Recent's latest query failure category (`recentErrorCategory`), or null when
 * the latest request succeeded or none has failed.
 */
export const isRecentOfflineConfirmed = (
  network: RecentNetworkHint | null | undefined,
  errorKind: string | null,
): boolean => recentOfflineHint(network) && errorKind === "network";
