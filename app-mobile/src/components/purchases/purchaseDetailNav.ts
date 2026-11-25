/**
 * #4490 W2-N32 — what the Purchases detail header's back does, for every
 * purchase kind. Pure (no React Native) so the unit suite runs it directly.
 *
 * Why not just `canGoBack ? back() : replace("/purchases")`: a warm purchase
 * link is opened twice. expo-router's own linking navigates to every path
 * `+native-intent` serves (`purchases` included), and AppContent's OS Linking
 * listener (`handleDeepLink` → `executeDeepLink` → `openRouterPath`) pushes the
 * same path again. The stack then holds the same detail twice, so `back()`
 * pops one copy and shows an identical screen: a back tap that "does nothing".
 * Back therefore pops past every copy of this same detail; with nothing else
 * below, it opens the Purchases list.
 */

export type StackRouteLike = {
  name: string;
  params?: object | undefined;
};

export type PurchaseDetailBack =
  | { kind: "dismiss"; count: number }
  | { kind: "replace"; href: "/purchases" };

export const PURCHASES_LIST_HREF = "/purchases" as const;

function param(route: StackRouteLike, key: string): string | null {
  const value = (route.params as Readonly<Record<string, unknown>> | undefined)?.[key];
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
  return value === undefined || value === null ? null : String(value);
}

function sameDetail(a: StackRouteLike, b: StackRouteLike): boolean {
  return (
    a.name === b.name &&
    param(a, "kind") === param(b, "kind") &&
    param(a, "id") === param(b, "id")
  );
}

export function purchaseDetailBack(
  routes: readonly StackRouteLike[] | null | undefined,
  index: number | null | undefined,
): PurchaseDetailBack {
  const list = routes ?? [];
  const here = typeof index === "number" ? index : list.length - 1;
  if (here <= 0 || here >= list.length) {
    return { kind: "replace", href: PURCHASES_LIST_HREF };
  }
  let below = here - 1;
  while (below >= 0 && sameDetail(list[below], list[here])) below -= 1;
  if (below < 0) return { kind: "replace", href: PURCHASES_LIST_HREF };
  return { kind: "dismiss", count: here - below };
}

/**
 * W2-N32 root: a purchase link the OS handed to the app (Linking initial URL
 * or "url" event) is already opened by expo-router's own linking (the
 * `purchases` segment is served by `+native-intent`), so AppContent must not
 * push it a second time. A deferred replay after sign-in, a push tap and a
 * OneLink still push: expo-router did not open those.
 */
export function osLinkPushIsDuplicate(
  source: "os" | "replay",
  destinationKind: string | null | undefined,
): boolean {
  return source === "os" && destinationKind === "purchase";
}
