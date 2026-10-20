// Issue #3980 — below 1180px the detail of a two-column screen sits under
// the list: bring it into view and move focus to its heading.
export function revealDetail(detailRef, headingRef) {
  if (typeof window === "undefined") return;
  requestAnimationFrame(() => {
    if (window.innerWidth < 1180) detailRef?.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    headingRef?.current?.focus?.({ preventScroll: window.innerWidth >= 1180 });
  });
}
