// Issue #3802 — the single place the admin app decides what a person may open.
//
// Pure module: no React, no Supabase import. Sidebar, command palette and route
// resolution all derive from this file and from the `areas` the server returned
// for the signed-in person. The app never maps a role to areas itself.
//
// Invariant: I-PROPOSED-3802-ADMIN-PAGES-DEFAULT-TO-FULL-ADMIN
// (docs/INVARIANT_REGISTRY.md).

export const ROLE_LABELS = {
  owner: "Owner",
  admin: "Admin",
  growth: "Sales and marketing",
  partner: "Founding partner",
};

export const INVITABLE_ROLES = ["admin", "growth", "partner"];

export const ROLE_HOME_TITLES = { growth: "My day", partner: "Company view" };

export const AREA = {
  ADMIN_CONSOLE: "admin_console",
  TEAM_MANAGE: "team_manage",
  ROLE_HOME: "role_home",
  // Hosts and Creators (issue #3802, Wave 1). The server decides who holds it.
  CRM: "crm",
  // Beta leads, for the whole team (issue #3802, Wave 1).
  BETA_LEADS: "beta_leads",
  // Shared email drafts and sending, for the whole team (issue #4255, D5).
  EMAIL_DRAFTS: "email_drafts",
};

// Issue #4255 (D3): owner, admin and Founding partner are the full-admin
// seats. The server decides access through the areas it sends; this list only
// says which labels name a full-admin seat in the UI (for example, who sees
// admin-only wording on a card).
export const FULL_ADMIN_ROLES = Object.freeze(["owner", "admin", "partner"]);

/** Is this person an active full admin (owner, admin or Founding partner)? */
export function isFullAdmin(access) {
  return Boolean(
    access &&
      access.status === "active" &&
      FULL_ADMIN_ROLES.includes(access.role) &&
      Array.isArray(access.areas) &&
      access.areas.includes(AREA.ADMIN_CONSOLE),
  );
}

// Issue #3720 operational capabilities. These are intentionally outside AREA:
// AREA remains the role-to-area contract pinned by #3802, while these values
// come from a separate server-owned capability RPC. They can open only the
// Community & Support console and never imply full admin access.
export const COMMUNITY_SUPPORT_AREA = "community_support";
export const SUPPORT_OPERATIONS_AREA = "community_support_support";
export const COMMUNITY_OPERATIONS_AREA = "community_support_community";
export const TEAM_NOTIFICATIONS_AREA = "team_notifications";
export const DATA_ROOM_AREA = "data_room";
// Issue #4255: the Blog tab, computed by the server from
// issue_4137_blog_can_write (any active teammate).
export const BLOG_AREA = "blog";

export const PAGE_ADDITIONAL_AREAS = Object.freeze({
  "community-support": Object.freeze([COMMUNITY_SUPPORT_AREA]),
  notifications: Object.freeze([TEAM_NOTIFICATIONS_AREA]),
  "data-room": Object.freeze([DATA_ROOM_AREA]),
  // Issue #4255: the Email and Blog tabs on the Support page, for every
  // teammate. A pseudo page id (never in the menu) so it widens Support only,
  // never Community.
  "support-content": Object.freeze([AREA.EMAIL_DRAFTS, BLOG_AREA]),
});

// Every page id NOT listed here needs AREA.ADMIN_CONSOLE. A page added by any
// other piece of work is therefore owner/admin-only without touching this file.
// The default is admin_console. NEVER invert this default.
export const PAGE_AREA_OVERRIDES = {
  home: AREA.ROLE_HOME,
  admin: AREA.TEAM_MANAGE,
  hosts: AREA.CRM,
  creators: AREA.CRM,
  drafts: AREA.CRM,
  "beta-leads": AREA.BETA_LEADS,
  "content-calendar": AREA.CRM,
  // Work board and Agent log (issue #3980): everyone who works the pipelines.
  "work-board": AREA.CRM,
  "agent-log": AREA.CRM,
  // My agent (issue #3802, Wave 4): everyone who works the pipelines.
  agent: AREA.CRM,
  guide: AREA.CRM,
};

// Issue #4130 (Wave 0) — a page that replaced older pages is open to whoever
// could open any of them (the union, never wider), and each of its tabs only
// to whoever could open the page that tab shows. The old ids keep their area
// above: they are how this union is worked out. Support and Community
// (#4130 Wave 6) were split from the Community & Support console, so they
// carry its access exactly; each tab inside stays gated by its own area
// (lib/communitySupportAccess.js). Kept in step with PAGE_HUB_TABS in lib/adminRoutes.js (tested).
export const PAGE_ACCESS_UNION = Object.freeze({
  outreach: Object.freeze(["hosts", "creators"]),
  inbound: Object.freeze(["beta-leads", "tool-leads"]),
  people: Object.freeze(["users", "business-people"]),
  brands: Object.freeze(["business-brands", "brand-sites", "business-venues", "claims"]),
  placepool: Object.freeze(["placepool", "launch-cities", "signals", "deck-tuner", "place-intelligence-trial"]),
  "platform-health": Object.freeze(["api-health", "stripe-mode", "queue-health"]),
  settings: Object.freeze(["settings"]),
  // #4130 (Seth): Team and roles is the owner's again (team_manage only);
  // Careers is its own page with its own access, so it is not merged here.
  support: Object.freeze(["community-support", "support-content"]),
  community: Object.freeze(["community-support"]),
});

export const TEAM_NAV_GROUP = {
  label: null,
  items: [{ id: "home", label: "Home", icon: "Home" }],
};

/**
 * The server's answer, checked. Returns { email, role, status, areas } or null.
 * `areas` is exactly what the server sent; it is never derived from the role.
 */
export function normalizeAccess(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (typeof raw.role !== "string" || !Object.hasOwn(ROLE_LABELS, raw.role)) return null;
  if (raw.status !== "active" && raw.status !== "invited") return null;
  return {
    email: typeof raw.email === "string" ? raw.email : "",
    role: raw.role,
    status: raw.status,
    areas: Array.isArray(raw.areas) ? raw.areas.filter((a) => typeof a === "string") : [],
  };
}

export function areaForPage(pageId) {
  // Object.hasOwn on purpose: "constructor", "__proto__" and friends fall to
  // the default instead of resolving to something inherited.
  return typeof pageId === "string" && Object.hasOwn(PAGE_AREA_OVERRIDES, pageId)
    ? PAGE_AREA_OVERRIDES[pageId]
    : AREA.ADMIN_CONSOLE;
}

/**
 * May this person open the page as it stood before #4130 merged pages? A hub
 * uses this for each of its tabs: a tab is shown only to whoever could open
 * the old page it shows.
 */
export function canOpenOwnPage(access, pageId) {
  if (!access || access.status !== "active" || !Array.isArray(access.areas)) return false;
  if (access.areas.includes(areaForPage(pageId))) return true;
  const additional =
    typeof pageId === "string" && Object.hasOwn(PAGE_ADDITIONAL_AREAS, pageId)
      ? PAGE_ADDITIONAL_AREAS[pageId]
      : [];
  return additional.some((area) => access.areas.includes(area));
}

export function canOpenPage(access, pageId) {
  if (typeof pageId === "string" && Object.hasOwn(PAGE_ACCESS_UNION, pageId)) {
    return PAGE_ACCESS_UNION[pageId].some((oldId) => canOpenOwnPage(access, oldId));
  }
  return canOpenOwnPage(access, pageId);
}

/** Where this person lands: their role home, else the dashboard, else nowhere. */
export function homePageFor(access) {
  if (canOpenPage(access, "home")) return "home";
  if (canOpenPage(access, "overview")) return "overview";
  return null;
}

/**
 * Which page to show for a requested address.
 *   unknown address     -> home, quietly
 *   allowed             -> the page
 *   known, not allowed  -> home, denied: true (the caller says so on screen)
 */
export function resolveRoute(requestedId, access, knownPageIds) {
  const home = homePageFor(access);
  if (home === null) return { pageId: null, denied: false, requestedId };
  const known = Array.isArray(knownPageIds) && knownPageIds.includes(requestedId);
  if (!known) return { pageId: home, denied: false, requestedId };
  if (canOpenPage(access, requestedId)) return { pageId: requestedId, denied: false, requestedId };
  return { pageId: home, denied: true, requestedId };
}

/** The menu for this person: only items they may open; empty groups dropped. */
export function visibleNavGroups(navGroups, access) {
  return [TEAM_NAV_GROUP, ...(Array.isArray(navGroups) ? navGroups : [])]
    .map((group) => ({
      ...group,
      items: (group.items || []).filter((item) => canOpenPage(access, item.id)),
    }))
    .filter((group) => group.items.length > 0);
}

export function pageTitle(pageId, access, navItems) {
  if (pageId === "home") {
    return (access && ROLE_HOME_TITLES[access.role]) || TEAM_NAV_GROUP.items[0].label;
  }
  const item = Array.isArray(navItems) ? navItems.find((t) => t.id === pageId) : null;
  return item?.label || "Dashboard";
}
