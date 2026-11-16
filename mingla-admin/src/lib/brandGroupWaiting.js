// #4452 §7.2 — Brand groups left Community for its own screen; its "waiting on
// Mingla" count moved from the Community tab to the menu item's badge. The
// panel's onCounts publishes here and the Sidebar reads it. Pure module: no
// React, no Supabase (the node tests load it directly).

export const BRAND_GROUP_WAITING_EVENT = "mingla:brand-group-waiting";

let current = 0;

/** The last count the Brand groups panel reported (0 until it has loaded). */
export function brandGroupWaiting() {
  return current;
}

/** The panel's onCounts: store the count and tell the menu. */
export function publishBrandGroupWaiting(waiting) {
  const n = Number.isFinite(Number(waiting)) && Number(waiting) > 0 ? Math.floor(Number(waiting)) : 0;
  if (n === current) return;
  current = n;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(BRAND_GROUP_WAITING_EVENT, { detail: n }));
}
