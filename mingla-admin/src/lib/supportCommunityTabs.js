// Issue #4130 (Wave 6) — the old Community & Support console is two pages now:
// Support (the inbox and the Support team) and Community (what hosts ask for
// and talk about).
//
// Issue #4383 — what we TELL hosts and explorers (Email, Blog, Links page,
// Announcements, Roadmap) left these two pages for their own screens in the
// Communications menu group. COMMUNICATIONS_TAB_PAGES below is how an old tab
// address finds its new screen: delete a row and old bookmarks, email alerts
// and Work links to that tab land on the wrong page.
//
// Pure module: no React, no Supabase. The two pages, the address redirects in
// lib/adminRoutes.js and the plain node / Deno tests all read it.
//
// Every tab keeps its id from the console, so each one keeps its row in
// communitySupportCapabilityContract.js and the access area that row names:
// moving a tab between pages never changes who may see it.

/** The Support page's tabs, in order. The first is the default. */
export const SUPPORT_PAGE_TABS = Object.freeze([
  Object.freeze({ id: "support", label: "Inbox" }),
  // #4383 (D1): the Support team list stays next to the inbox.
  Object.freeze({ id: "team", label: "People and roles" }),
]);

/** The Community page's tabs, in order. #4383: it opens on Ideas. */
export const COMMUNITY_PAGE_TABS = Object.freeze([
  Object.freeze({ id: "ideas", label: "Ideas from hosts" }),
  Object.freeze({ id: "questions", label: "Questions" }),
  Object.freeze({ id: "moderation", label: "Moderation" }),
  // #4111 — kept next to Moderation; shown only to the Community area
  // (community_can('moderate')) and Admins.
  Object.freeze({ id: "enquiry-reports", label: "Reported enquiries" }),
  Object.freeze({ id: "brand-groups", label: "Brand groups" }),
  Object.freeze({ id: "feature-guide", label: "Feature guide" }),
  // #4383: renamed to match #4382's Product board (the tab id is unchanged).
  Object.freeze({ id: "product", label: "Product board" }),
]);

/**
 * #4383 — an old Support / Community / console tab id -> the Communications
 * screen (page id) that now holds it. Each screen is a single page, so the
 * old `tab` is dropped and every other query value is kept:
 *   "#/support?tab=blog&view=editor&post=X" -> "#/blog?view=editor&post=X"
 * lib/adminRoutes.js TAB_PAGE_REDIRECTS reads this map; do not restate it.
 */
export const COMMUNICATIONS_TAB_PAGES = Object.freeze({
  email: "email",
  blog: "blog",
  links: "links",
  announcements: "announcements",
  roadmap: "roadmap",
});

/** The Communications screen that now holds an old tab, or null. */
export function communicationsPageForTab(tabId) {
  return typeof tabId === "string" && Object.hasOwn(COMMUNICATIONS_TAB_PAGES, tabId)
    ? COMMUNICATIONS_TAB_PAGES[tabId]
    : null;
}

export const SUPPORT_COMMUNITY_PAGE_TABS = Object.freeze({
  support: SUPPORT_PAGE_TABS,
  community: COMMUNITY_PAGE_TABS,
});

/** The tabs of the Support or Community page, or null for any other page. */
export function pageTabsFor(pageId) {
  return typeof pageId === "string" && Object.hasOwn(SUPPORT_COMMUNITY_PAGE_TABS, pageId)
    ? SUPPORT_COMMUNITY_PAGE_TABS[pageId]
    : null;
}

/**
 * The page that now holds a console tab, or null: "support", "community", or
 * (#4383) the Communications screen's own page id.
 */
export function pageForConsoleTab(tabId) {
  const screen = communicationsPageForTab(tabId);
  if (screen) return screen;
  if (SUPPORT_PAGE_TABS.some((tab) => tab.id === tabId)) return "support";
  if (COMMUNITY_PAGE_TABS.some((tab) => tab.id === tabId)) return "community";
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

/**
 * Where an old #/community-support address goes. Its tab picks the page;
 * no tab, Overview (retired), Availability (now the Support header switch)
 * and anything unknown open Support's inbox. Every other query value
 * (ticket=, signal=, card=, …) is kept, so email alerts and Work links that
 * were sent before the split still land on the right tab.
 *   "#/community-support?tab=roadmap&card=x" -> "#/roadmap?card=x" (#4383)
 *   "#/community-support?tab=support&ticket=t" -> "#/support?ticket=t"
 */
export function consoleRedirectHash(hash) {
  const params = queryOf(hash);
  const tab = params.get("tab") || "";
  const page = pageForConsoleTab(tab) || "support";
  // #4383: a Communications screen has no tabs, so its old tab is dropped.
  const pageTabs = pageTabsFor(page);
  const keepTab = Boolean(pageTabs) && Boolean(pageForConsoleTab(tab)) && tab !== pageTabs[0].id;
  params.delete("tab");
  const next = new URLSearchParams();
  if (keepTab) next.set("tab", tab);
  for (const [key, value] of params) next.append(key, value);
  const query = next.toString();
  return `#/${page}${query ? `?${query}` : ""}`;
}

/**
 * The tab an address asks a Support/Community page for, or the page's first
 * tab when it names none or names one that page does not have.
 */
export function pageTabFromHash(hash, pageId) {
  const tabs = pageTabsFor(pageId);
  if (!tabs) return null;
  const requested = queryOf(hash).get("tab");
  return tabs.some((tab) => tab.id === requested) ? requested : tabs[0].id;
}

/** The address of one tab of the Support or Community page. */
export function pageTabHash(pageId, tabId) {
  const tabs = pageTabsFor(pageId) || [];
  if (!tabs.some((tab) => tab.id === tabId) || tabs[0]?.id === tabId) return `#/${pageId}`;
  return `#/${pageId}?tab=${encodeURIComponent(tabId)}`;
}
