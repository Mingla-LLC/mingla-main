// Issue #4571 rework: an error toast stays until it is closed (errors are never
// lost), but only on the page it belongs to. Moving to another page drops the
// old page's errors; opening a card or a filter on the same page keeps them.

/** "outreach" for "#/outreach?tab=hosts&card=…"; "" for no route. */
export function pageOfHash(hash) {
  return String(hash || "").replace(/^#\/?/, "").split(/[?&#]/)[0].split("/")[0];
}

/** The toasts left after moving to `page`: every toast but another page's errors. */
export function toastsForPage(toasts, page) {
  return (Array.isArray(toasts) ? toasts : []).filter((t) => t.variant !== "error" || (t.page ?? page) === page);
}
