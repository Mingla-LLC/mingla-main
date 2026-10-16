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
};

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
  // My agent (issue #3802, Wave 4): everyone who works the pipelines.
  agent: AREA.CRM,
  guide: AREA.CRM,
};

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

export function canOpenPage(access, pageId) {
  return (
    !!access &&
    access.status === "active" &&
    Array.isArray(access.areas) &&
    access.areas.includes(areaForPage(pageId))
  );
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
