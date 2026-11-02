/**
 * #4237 — expo-router settings for the `(tabs)` group, re-exported as
 * `unstable_settings` by `app/(tabs)/_layout.tsx`.
 *
 * Without an explicit initial route, expo-router orders a navigator's children
 * by route-name length, so `ari` (3 chars) became the `(tabs)` Slot's default
 * screen. When sign-in mounted the group without the nested `home` target, the
 * Slot fell back to that default and drew Ari while the URL (and so the bottom
 * nav) still said Home. Pinning `home` makes the fallback the screen the nav
 * already highlights.
 *
 * Kept in its own dependency-free module so the regression test can feed it to
 * expo-router's real route builder without importing the layout's UI graph.
 */
export const tabsNavigatorSettings = {
  initialRouteName: "home",
} as const;
