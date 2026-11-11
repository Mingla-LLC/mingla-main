// Issue #4383 — where an Admin push may open (spec §4.6). THE one source of
// truth for the Push screen's "Opens" choices.
//
// A push may only open a screen a person can see in the app today, named on
// the Admin screen by its on-screen name. Each row is proven by executing it
// through the app's real router (app-mobile parseDeepLink/executeDeepLink and
// mingla-business resolveBusinessNavTarget); see the #4383 destination tests.
//
// NOT offered, on purpose:
//   mingla://connections          the internal id of the Chats tab: there is no
//                                 Connections screen, and Chats is no place for a
//                                 broadcast
//   mingla-business://home        no parser case: the tap would fall back by type
//   mingla://saved, mingla://profile  need an entity, or are not a broadcast place
//
// Restated (and tested to agree) in:
//   supabase/migrations/20280608004383_issue_4383_communications_scheduling.sql
//     (the CHECK constraints and issue_4383_push_deep_link)
//   mingla-admin/src/lib/pushDestinations.js (labels for the composer)
//
// Pure module: no imports, so Deno, the app tests and the drain all load it.

export type AdminPushApp = "explorer" | "host";

export interface AdminPushDestination {
  app: AdminPushApp;
  /** The value stored in admin_push_campaigns.explorer_target / host_target. */
  value: string;
  /** What the Admin screen calls it (the app's own on-screen name). */
  label: string;
  /** The deep link the push carries. */
  deepLink: string;
  /** True for each app's default choice. */
  isDefault: boolean;
}

export const ADMIN_PUSH_DESTINATIONS: readonly AdminPushDestination[] = Object.freeze([
  Object.freeze({ app: "explorer", value: "explore", label: "Explore", deepLink: "mingla://home", isDefault: true }),
  Object.freeze({ app: "explorer", value: "discover", label: "Discover", deepLink: "mingla://discover", isDefault: false }),
  Object.freeze({ app: "explorer", value: "likes", label: "Likes", deepLink: "mingla://likes", isDefault: false }),
  Object.freeze({ app: "host", value: "community", label: "Community", deepLink: "mingla-business://community", isDefault: true }),
  Object.freeze({ app: "host", value: "home", label: "Home", deepLink: "mingla-business://(tabs)/home", isDefault: false }),
] as AdminPushDestination[]);

/** The push category each app's rows are sent as (the prefix picks the OneSignal app). */
export const ADMIN_PUSH_CATEGORY: Readonly<Record<AdminPushApp, string>> = Object.freeze({
  explorer: "mingla_updates",
  host: "business.mingla_update",
});

export const ADMIN_PUSH_CATEGORIES: ReadonlySet<string> = new Set(Object.values(ADMIN_PUSH_CATEGORY));

/** Is this deep link one this category may carry? Anything else is refused, never rewritten. */
export function adminPushDeepLinkValid(category: string, deepLink: string | null | undefined): boolean {
  const app = (Object.keys(ADMIN_PUSH_CATEGORY) as AdminPushApp[]).find((key) => ADMIN_PUSH_CATEGORY[key] === category);
  if (!app || typeof deepLink !== "string") return false;
  return ADMIN_PUSH_DESTINATIONS.some((row) => row.app === app && row.deepLink === deepLink);
}

/** The deep link for a stored value, or null when the pair is not in the table. */
export function adminPushDeepLink(app: AdminPushApp, value: string): string | null {
  return ADMIN_PUSH_DESTINATIONS.find((row) => row.app === app && row.value === value)?.deepLink ?? null;
}
