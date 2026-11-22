import {
  AREA,
  COMMUNITY_OPERATIONS_AREA,
  SUPPORT_OPERATIONS_AREA,
} from "./access.js";
import { COMMUNITY_SUPPORT_TAB_AREA } from "./communitySupportCapabilityContract.js";

/**
 * #3988 — the area that shows each tab. The server derives these areas from
 * the same predicates that guard each tab's RPCs, so this filter never shows a
 * tab the server will refuse. See communitySupportCapabilityContract.js.
 */
export const COMMUNITY_SUPPORT_TAB_CAPABILITY = COMMUNITY_SUPPORT_TAB_AREA;

export function communitySupportCapabilities(access) {
  const areas = Array.isArray(access?.areas) ? access.areas : [];
  const isAdmin = access?.status === "active" && areas.includes(AREA.ADMIN_CONSOLE);
  return {
    isAdmin,
    canSupport: isAdmin || areas.includes(SUPPORT_OPERATIONS_AREA),
    canCommunity: isAdmin || areas.includes(COMMUNITY_OPERATIONS_AREA),
  };
}

// #4130 Wave 6: the Support page filters its tabs here; it opens on the first
// tab this leaves (lib/supportCommunityTabs.js). People and roles is full
// admins only.
// #4383: Email, Blog and Links page are their own screens now, gated by
// lib/access.js PAGE_ADDITIONAL_AREAS (the same areas these tabs had).
export function communitySupportTabsForAccess(access, tabs) {
  const { isAdmin, canSupport } = communitySupportCapabilities(access);
  if (isAdmin) return tabs;

  // #4420: Community's tabs are retired (Reported enquiries arrive in the
  // Support inbox; the Feature guide is its own screen, gated in
  // lib/access.js). The Support page's own tabs remain.
  const allowed = new Set();
  if (canSupport) allowed.add("support");
  return tabs.filter((tab) => allowed.has(tab.id));
}
