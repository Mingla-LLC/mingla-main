/** Central paths for expo-router `router.push` / `href`.
 * Note: `app/auth/index.tsx` resolves to `/auth` (not `/auth/index`).
 * `(tabs)` is an Expo Router route group — files inside collapse to
 * top-level URLs at runtime (e.g. `app/(tabs)/home.tsx` → `/home`).
 */
const AppRoutes = {
  /** Signed-in shell — the 3-tab layout. */
  home: "/(tabs)/home",
  events: "/(tabs)/events",
  account: "/(tabs)/account",
  auth: {
    index: "/auth",
  },
} as const;

export default AppRoutes;
