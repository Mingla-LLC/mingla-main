// Issue #4130 (Wave 6) — the old Community & Support console became two pages,
// Support and Community. Issue #4420 retired Community and the Roadmap screen:
// Support keeps the inbox and People and roles; the Feature guide is its own
// Communications screen; what hosts suggest and report becomes a ticket on the
// Work board.
//
// Issue #4383 — what we TELL hosts and explorers (Email, Blog, Links page,
// Announcements) has its own Communications screens. COMMUNICATIONS_TAB_PAGES
// below is how an old tab address finds its new screen.
//
// Pure module: no React, no Supabase. The Support page, the address redirects
// in lib/adminRoutes.js and the plain node / Deno tests all read it.
//
// Every redirect below is data: delete a row and old bookmarks, email alerts
// and Work links to that tab land on the wrong page (the #4420 redirect test
// walks every row).

/** The Support page's tabs, in order. The first is the default. */
export const SUPPORT_PAGE_TABS = Object.freeze([
  Object.freeze({ id: "support", label: "Inbox" }),
  // #4383 (D1): the Support team list stays next to the inbox.
  Object.freeze({ id: "team", label: "People and roles" }),
]);

/**
 * #4383 — an old Support / Community / console tab id -> the Communications
 * screen (page id) that now holds it. Each screen is a single page, so the
 * old `tab` is dropped and every other query value is kept:
 *   "#/support?tab=blog&view=editor&post=X" -> "#/blog?view=editor&post=X"
 * lib/adminRoutes.js TAB_PAGE_REDIRECTS reads this map; do not restate it.
 * #4420: Roadmap left this map (its screen is retired; see
 * RETIRED_TAB_REDIRECTS).
 */
export const COMMUNICATIONS_TAB_PAGES = Object.freeze({
  email: "email",
  blog: "blog",
  links: "links",
  announcements: "announcements",
  // #4452 §7.2: Brand groups left Community for its own screen.
  "brand-groups": "brand-groups",
});

/** The Communications screen that now holds an old tab, or null. */
export function communicationsPageForTab(tabId) {
  return typeof tabId === "string" && Object.hasOwn(COMMUNICATIONS_TAB_PAGES, tabId)
    ? COMMUNICATIONS_TAB_PAGES[tabId]
    : null;
}

// #4420 — where the Community page's retired tabs (and the retired Roadmap
// screen) send an old address. `page` is the new page, `set` the query values
// it opens with, and `keep` whether the old address's other query values are
// carried over (only where the new page reads the same values). `fallback`
// is where the address goes instead when the person may not open `page`.
//   - Ideas, Questions and Moderation: hosts bring these to Support now.
//   - Product board: its work is a Ticket on the Work board; someone without
//     the Work board lands on Support instead of being turned away.
//   - Reported enquiries: they arrive in the Support inbox, under Reported.
//   - Feature guide: moved unchanged to its own Communications screen.
//   - Roadmap: the screen is retired; what we tell hosts is Announcements.
const TO_SUPPORT = Object.freeze({ page: "support", set: Object.freeze({}), keep: false });

export const RETIRED_TAB_REDIRECTS = Object.freeze({
  ideas: TO_SUPPORT,
  questions: TO_SUPPORT,
  moderation: TO_SUPPORT,
  product: Object.freeze({ page: "work-board", set: Object.freeze({ type: "tickets" }), keep: false, fallback: "support" }),
  "enquiry-reports": Object.freeze({ page: "support", set: Object.freeze({ filter: "reported" }), keep: true }),
  "feature-guide": Object.freeze({ page: "feature-guide", set: Object.freeze({}), keep: true }),
  roadmap: Object.freeze({ page: "announcements", set: Object.freeze({}), keep: false }),
});

/** Where an address with no usable tab lands: the Support inbox. */
export const RETIRED_DEFAULT_REDIRECT = Object.freeze({ page: "support", set: Object.freeze({}), keep: true });

export const SUPPORT_COMMUNITY_PAGE_TABS = Object.freeze({
  support: SUPPORT_PAGE_TABS,
});

/** The tabs of the Support page, or null for any other page. */
export function pageTabsFor(pageId) {
  return typeof pageId === "string" && Object.hasOwn(SUPPORT_COMMUNITY_PAGE_TABS, pageId)
    ? SUPPORT_COMMUNITY_PAGE_TABS[pageId]
    : null;
}

/**
 * The page that now holds a console tab, or null: "support", a
 * Communications screen, or (#4420) the page a retired tab redirects to.
 */
export function pageForConsoleTab(tabId) {
  const screen = communicationsPageForTab(tabId);
  if (screen) return screen;
  if (SUPPORT_PAGE_TABS.some((tab) => tab.id === tabId)) return "support";
  if (typeof tabId === "string" && Object.hasOwn(RETIRED_TAB_REDIRECTS, tabId)) return RETIRED_TAB_REDIRECTS[tabId].page;
  return null;
}

function queryOf(hash) {
  const text = typeof hash === "string" ? hash : "";
  const at = text.indexOf("?");
  try {
    return new URLSearchParams(at < 0 ? "" : text.slice(at + 1));
  } catch {
    return new URLSearchParams();
  }
}

function hashFor(page, setValues, rest) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(setValues || {})) next.set(key, value);
  if (rest) for (const [key, value] of rest) if (!next.has(key)) next.append(key, value);
  const query = next.toString();
  return `#/${page}${query ? `?${query}` : ""}`;
}

/**
 * The new address of an old Support / Community / console address, from its
 * tab. Never null: an unknown or missing tab opens the Support inbox.
 *   "#/community-support?tab=support&ticket=t" -> "#/support?ticket=t"
 *   "#/community?tab=ideas&post=p"              -> "#/support"
 *   "#/community?tab=product&signal=s"          -> "#/work-board?type=tickets" (Support without the Work board)
 *   "#/community?tab=feature-guide"             -> "#/feature-guide"
 */
export function consoleRedirectHash(hash) {
  const params = queryOf(hash);
  const tab = params.get("tab") || "";
  params.delete("tab");
  // #4383: a Communications screen has no tabs, so its old tab is dropped.
  const screen = communicationsPageForTab(tab);
  if (screen) return hashFor(screen, null, params);
  // Support's own tabs keep their tab (the inbox is its first, so it needs none).
  if (SUPPORT_PAGE_TABS.some((t) => t.id === tab)) {
    return hashFor("support", tab === SUPPORT_PAGE_TABS[0].id ? null : { tab }, params);
  }
  if (Object.hasOwn(RETIRED_TAB_REDIRECTS, tab)) {
    const rule = RETIRED_TAB_REDIRECTS[tab];
    return hashFor(rule.page, rule.set, rule.keep ? params : null);
  }
  // #4452 (B1): Brand groups once wrote #/community?group=… with no tab.
  if (!tab && (params.has("group") || params.has("brand"))) return hashFor("brand-groups", null, params);
  return hashFor(RETIRED_DEFAULT_REDIRECT.page, RETIRED_DEFAULT_REDIRECT.set, RETIRED_DEFAULT_REDIRECT.keep ? params : null);
}

/**
 * #4420 — the page an old address falls back to when the person may not open
 * the page it redirects to, or null. Only the Product board has one: its
 * tickets live on the Work board, and anyone else goes to Support.
 */
export function consoleRedirectFallback(hash) {
  const tab = queryOf(hash).get("tab") || "";
  return Object.hasOwn(RETIRED_TAB_REDIRECTS, tab) ? RETIRED_TAB_REDIRECTS[tab].fallback || null : null;
}

/**
 * #4420 — an old Roadmap screen address (#/roadmap, #/roadmap?card=…) opens
 * Announcements; the roadmap card it named has no screen any more.
 */
export function roadmapRedirectHash() {
  const rule = RETIRED_TAB_REDIRECTS.roadmap;
  return hashFor(rule.page, rule.set, null);
}

/**
 * The tab an address asks the Support page for, or its first tab when it
 * names none or names one that page does not have.
 */
export function pageTabFromHash(hash, pageId) {
  const tabs = pageTabsFor(pageId);
  if (!tabs) return null;
  const requested = queryOf(hash).get("tab");
  return tabs.some((tab) => tab.id === requested) ? requested : tabs[0].id;
}

/** The address of one tab of the Support page. */
export function pageTabHash(pageId, tabId) {
  const tabs = pageTabsFor(pageId) || [];
  if (!tabs.some((tab) => tab.id === tabId) || tabs[0]?.id === tabId) return `#/${pageId}`;
  return `#/${pageId}?tab=${encodeURIComponent(tabId)}`;
}
