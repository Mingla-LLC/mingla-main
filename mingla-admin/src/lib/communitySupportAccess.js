import {
  AREA,
  COMMUNITY_OPERATIONS_AREA,
  SUPPORT_OPERATIONS_AREA,
} from "./access.js";

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
  if (canCommunity) allowed.add("overview");
  if (canSupport) {
    allowed.add("support");
    allowed.add("brand-groups");
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
