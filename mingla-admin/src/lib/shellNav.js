// Issue #3802 (admin shell) — the small decisions the frame makes about the
// menu: which groups are folded, and what the breadcrumb reads.
//
// Pure module: no React, no Supabase. The storage is always handed in, so
// every function here can be run by a plain test.
//
// Invariant: I-3802-ADMIN-SHELL-ONE-FRAME (docs/INVARIANT_REGISTRY.md).

/** Where the folded groups are remembered, per browser. */
export const NAV_FOLD_STORAGE_KEY = "mingla-admin:menu-folded-groups";

/**
 * This browser's storage, or null when it is switched off. Reading the
 * property itself can throw (blocked site data, some private windows).
 */
export function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The labels of the groups this person folded. Anything missing, blocked or
 * not a list of names reads as "nothing folded": the menu then shows every
 * group, which is always a correct menu.
 */
export function readFoldedGroups(storage) {
  try {
    const raw = storage?.getItem(NAV_FOLD_STORAGE_KEY);
    if (typeof raw !== "string") return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((label) => typeof label === "string" && label !== ""))];
  } catch {
    return [];
  }
}

/**
 * Remember the folded groups. Returns whether it was stored. A browser that
 * refuses is not an error for the person: the fold still works until the page
 * is reloaded, it just is not remembered.
 */
export function writeFoldedGroups(storage, labels) {
  try {
    if (!storage) return false;
    storage.setItem(NAV_FOLD_STORAGE_KEY, JSON.stringify(labels));
    return true;
  } catch {
    return false;
  }
}

/** Fold the group if it is open, open it if it is folded. Returns a new list. */
export function toggleFoldedGroup(folded, label) {
  return folded.includes(label) ? folded.filter((l) => l !== label) : [...folded, label];
}

/**
 * Is this group's list of pages shown?
 *   - a group with no label never folds
 *   - the group holding the page you are on is always open
 *   - otherwise it is open unless it was folded
 */
export function isGroupOpen(group, folded, activePageId) {
  if (!canFoldGroup(group, activePageId)) return true;
  return !(Array.isArray(folded) && folded.includes(group.label));
}

/** Does this group hold this page? Never throws on a broken group. */
export function groupHoldsPage(group, pageId) {
  return Array.isArray(group?.items) && group.items.some((item) => item?.id === pageId);
}

/**
 * May this group's heading fold it right now? Only a group with a label that
 * does NOT hold the page you are on. The group you are in is always open, so
 * its heading is words, not a switch: a click there would change nothing on
 * screen, and must not quietly change what is remembered either.
 */
export function canFoldGroup(group, activePageId) {
  return typeof group?.label === "string" && group.label !== "" && !groupHoldsPage(group, activePageId);
}

/**
 * The breadcrumb for a page: "Group › Page" when the page sits in a named
 * group, the page alone otherwise (the top of the menu, a role home, or an id
 * the menu does not know). `title` is the page's own title, already resolved
 * for this person (lib/access.js pageTitle), so a role home reads "My day".
 * The group is words only: it carries no action.
 */
export function breadcrumbFor(pageId, title, navGroups) {
  const group = (Array.isArray(navGroups) ? navGroups : []).find((g) => groupHoldsPage(g, pageId));
  const page = { label: title };
  return group && typeof group.label === "string" && group.label !== "" ? [{ label: group.label }, page] : [page];
}
