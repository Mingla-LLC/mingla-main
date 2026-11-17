const HOSTS_KINDS = new Set(["card", "host", "creator", "content", "event", "expected", "drafts", "calendar"]);

/** Whether this teammate may open a side panel of this kind. */
export function sideAllowed(side, { canHosts, canBrands }) {
  if (!side) return false;
  if (side.kind === "brand") return !!canBrands;
  return HOSTS_KINDS.has(side.kind) && !!canHosts;
}
