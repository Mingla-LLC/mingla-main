/** Central paths for expo-router `router.push` / `href`.
 * Note: `app/auth/index.tsx` resolves to `/auth` (not `/auth/index`). */
const AppRoutes = {
  home: "/home",
  auth: {
    index: "/auth",
  },
  onboarding: {
    index: "/onboarding",
  },
  claim: {
    index: "/claim",
  },
  menu: {
    index: "/menu",
  },
} as const;

export default AppRoutes;