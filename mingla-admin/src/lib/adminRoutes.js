// Issue #4130 (Wave 0) — where every admin address goes after the menu moved
// from 40 entries to 26 pages.
//
// Pure module: no React, no Supabase. App.jsx, the menu, the page hubs and
// useHashQuery all read it, and a plain node test runs it.
//
//   - RETIRED_PAGE_REDIRECTS: an old page id and the page (and tab) that now
//     holds it. Old bookmarks and in-app links keep working: the address is
//     rewritten in place, its other query values kept, before any page is
//     chosen.
//   - PAGE_HUB_TABS: the pages that, until their own wave rebuilds them, show
//     the existing pages they replace as tabs. `hosts` is the old page id the
//     tab shows; who may see a tab is that old page's access (lib/access.js).

import { hashPageId, hashSearch } from "./crmUrl.js";
import { consoleRedirectHash } from "./supportCommunityTabs.js";

/** The query value a hub uses to say which tab is open. */
export const HUB_TAB_PARAM = "tab";

// Old page id -> { page, tab }. `tab` is optional (the page's first tab).
// #4130 Wave 6: Support and Community are real pages now. The old
// Community & Support console (community-support) is retired too, but its
// tab decides which page it lands on, so it is not in this map: see
// SPLIT_PAGE_REDIRECTS below.
export const RETIRED_PAGE_REDIRECTS = Object.freeze({
  drafts: Object.freeze({ page: "work-board" }),
  users: Object.freeze({ page: "people", tab: "explorers" }),
  "business-people": Object.freeze({ page: "people", tab: "hosts" }),
  "business-brands": Object.freeze({ page: "brands", tab: "brands" }),
  "brand-sites": Object.freeze({ page: "brands", tab: "websites" }),
  "business-venues": Object.freeze({ page: "brands", tab: "venues" }),
  claims: Object.freeze({ page: "brands", tab: "claims" }),
  "beta-leads": Object.freeze({ page: "inbound", tab: "beta" }),
  "tool-leads": Object.freeze({ page: "inbound", tab: "tools" }),
  hosts: Object.freeze({ page: "outreach", tab: "hosts" }),
  creators: Object.freeze({ page: "outreach", tab: "creators" }),
  "launch-cities": Object.freeze({ page: "placepool", tab: "cities" }),
  signals: Object.freeze({ page: "placepool", tab: "pipeline" }),
  // #4130 (Wave 4b): the Deck tuner is now an action on a place in Browse and map.
  "deck-tuner": Object.freeze({ page: "placepool", tab: "browse" }),
  "place-intelligence-trial": Object.freeze({ page: "settings", tab: "intelligence-trial" }),
  "stripe-mode": Object.freeze({ page: "platform-health", tab: "stripe" }),
  "api-health": Object.freeze({ page: "platform-health", tab: "providers" }),
  "queue-health": Object.freeze({ page: "platform-health", tab: "queue" }),
  careers: Object.freeze({ page: "admin", tab: "careers" }),
  // #3720 Slice F legacy address: the old Email page is Support's Email tab.
  email: Object.freeze({ page: "support", tab: "email" }),
});

// Retired page id -> the function that works out its new address from the
// whole old one (#4130 Wave 6: the Community & Support console's tab picks
// Support or Community; lib/supportCommunityTabs.js).
const SPLIT_PAGE_REDIRECTS = Object.freeze({
  "community-support": consoleRedirectHash,
});

function splitRedirectFor(pageId) {
  return typeof pageId === "string" && Object.hasOwn(SPLIT_PAGE_REDIRECTS, pageId)
    ? SPLIT_PAGE_REDIRECTS[pageId]
    : null;
}

// Hub page id -> its tabs, in order. The first tab is the default.
export const PAGE_HUB_TABS = Object.freeze({
  outreach: Object.freeze([
    Object.freeze({ id: "hosts", label: "Hosts", hosts: "hosts" }),
    Object.freeze({ id: "creators", label: "Creators", hosts: "creators" }),
  ]),
  // #4130 Wave 3: People and Brands are real pages now (PeoplePage,
  // BrandsPage), not hubs. Their tab values above stay valid addresses:
  // People reads explorers/hosts/..., Brands opens websites/venues/claims as
  // the tools folded inside it (lib/peopleSegments.js BRAND_TOOL_TABS).
  // #4130 (Wave 4b): Place pool, Platform health, Settings and Team and
  // roles are real pages now (PlacePoolPage, PlatformHealthPage, SettingsPage,
  // AdminPage), not hubs. Their tab values stay valid addresses: each page
  // reads its own (lib/systemPages.js PLACE_POOL_TABS, TEAM_TABS,
  // PLATFORM_HEALTH_SECTIONS, SETTINGS_SECTIONS).
});

/** The redirect for an old page id, or null. Never resolves inherited keys. */
export function redirectFor(pageId) {
  return typeof pageId === "string" && Object.hasOwn(RETIRED_PAGE_REDIRECTS, pageId)
    ? RETIRED_PAGE_REDIRECTS[pageId]
    : null;
}

/**
 * The address an old address now lives at, or null when it is not retired.
 *   "#/business-venues?venueId=v1" -> "#/brands?tab=venues&venueId=v1"
 * Every other query value is kept; the old address's own `tab` (if any) gives
 * way to the new one, since it named a tab of a page that no longer exists.
 */
export function redirectHash(hash) {
  const split = splitRedirectFor(hashPageId(hash));
  if (split) return split(hash);
  const target = redirectFor(hashPageId(hash));
  if (!target) return null;
  let params;
  try {
    params = new URLSearchParams(hashSearch(hash));
  } catch {
    params = new URLSearchParams();
  }
  params.delete(HUB_TAB_PARAM);
  const next = new URLSearchParams();
  if (target.tab) next.set(HUB_TAB_PARAM, target.tab);
  for (const [key, value] of params) next.append(key, value);
  const query = next.toString();
  return `#/${target.page}${query ? `?${query}` : ""}`;
}

/** Was this page id retired into another page? */
export function isRetiredPageId(pageId) {
  return redirectFor(pageId) !== null || splitRedirectFor(pageId) !== null;
}

/** The tabs of a hub page, or null when the page is not a hub. */
export function hubTabs(pageId) {
  return typeof pageId === "string" && Object.hasOwn(PAGE_HUB_TABS, pageId) ? PAGE_HUB_TABS[pageId] : null;
}

/**
 * The tab id an address asks a hub for, or "" when it names none. An old
 * address that redirects into this hub counts as naming its tab, so a hub that
 * is already on screen follows an in-page link before App rewrites it.
 */
export function hubTabFromHash(hash, hubId) {
  const resolved = redirectHash(hash) ?? hash;
  if (hashPageId(resolved) !== hubId) return "";
  try {
    return new URLSearchParams(hashSearch(resolved)).get(HUB_TAB_PARAM) || "";
  } catch {
    return "";
  }
}

/** The address of one tab of a hub. */
export function hubTabHash(hubId, tabId) {
  return `#/${hubId}?${HUB_TAB_PARAM}=${encodeURIComponent(tabId)}`;
}

/**
 * The query string a hosted page sees, with the hub's own `tab` taken out, or
 * null when the address belongs to neither the hub nor the hosted page.
 * `alias` is { page, tab, hosts } (see pages/HostsAndCreatorsHub.jsx).
 */
export function hostedSearch(hash, alias) {
  const page = hashPageId(hash);
  if (page !== alias.page && page !== alias.hosts) return null;
  let params;
  try {
    params = new URLSearchParams(hashSearch(hash));
  } catch {
    return "";
  }
  params.delete(HUB_TAB_PARAM);
  return params.toString();
}

/** The address a hosted page writes for its own query string. */
export function hostedHash(alias, search) {
  const value = typeof search === "string" ? search : "";
  return `${hubTabHash(alias.page, alias.tab)}${value ? `&${value}` : ""}`;
}
