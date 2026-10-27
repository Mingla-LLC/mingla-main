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

export function communitySupportTabsForAccess(access, tabs) {
  const { isAdmin, canSupport, canCommunity } = communitySupportCapabilities(access);
  if (isAdmin) return tabs;

  const allowed = new Set();
  if (canCommunity) {
    allowed.add("overview");
    allowed.add("ideas");
    allowed.add("questions");
    allowed.add("moderation");
    // #4111: admin_* enquiry-report RPCs guard on issue_4111_is_mingla_staff,
    // the same people community_can('moderate') admits.
    allowed.add("enquiry-reports");
  }
  if (canSupport) {
    allowed.add("support");
    allowed.add("feature-guide");
    allowed.add("brand-groups");
    // Kept for old deep-link permission checks. The console no longer renders
    // an Availability tab; presence lives in the page header.
    allowed.add("availability");
  }
  return tabs.filter((tab) => allowed.has(tab.id));
}

export function defaultCommunitySupportTab(access) {
  const { isAdmin, canSupport, canCommunity } = communitySupportCapabilities(access);
  if (isAdmin || canCommunity) return "overview";
  if (canSupport) return "support";
  return null;
}
