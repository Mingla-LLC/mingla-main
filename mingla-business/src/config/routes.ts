/** Central paths for expo-router `router.push` / `href`.
 * Note: `app/auth/index.tsx` resolves to `/auth` (not `/auth/index`). */
const AppRoutes = {
  /** Signed-in shell (replace with your tabs stack later). */
  home: "/home",
  auth: {
    index: "/auth",
  },
} as const;

export default AppRoutes;