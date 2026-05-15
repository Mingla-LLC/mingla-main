/** Central paths for expo-router `router.push` / `href`.
 * Note: `app/auth/index.tsx` resolves to `/auth` (not `/auth/index`).
 * `(tabs)` is an Expo Router route group — files inside collapse to
 * top-level URLs at runtime (e.g. `app/(tabs)/home.tsx` → `/home`).
 *
 * ORCH-0826 M0: tab `events` renamed to `hub`; the Hub tab now has three
 * sub-routes (events / experiences / trips). The legacy `events` key was
 * removed (hard rename — no stub redirect; old route deleted). Current
 * consumers (`app/index.tsx`, `app/auth/index.tsx`) only use `home` and
 * auth keys; hub keys added for future use without immediate consumers.
 */
const AppRoutes = {
  /** Signed-in shell — the 5-tab layout (Home / Hub / Ari / Blast / Account). */
  home: "/(tabs)/home",
  hub: "/(tabs)/hub",
  hubEvents: "/(tabs)/hub/events",
  hubExperiences: "/(tabs)/hub/experiences",
  hubTrips: "/(tabs)/hub/trips",
  account: "/(tabs)/account",
  marketing: "/(tabs)/marketing",
  ari: "/(tabs)/ari",
  auth: {
    index: "/auth",
  },
} as const;

export default AppRoutes;
