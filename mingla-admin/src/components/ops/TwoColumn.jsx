// Issue #3980 — every ops screen is two columns: the list or grid on the
// left and the live detail on the right. Below 1180px the detail stacks
// under the list. No overlay, no sideways scroll.
import { forwardRef } from "react";

export const TWO_COLUMN_CLASS = "grid min-w-0 grid-cols-1 gap-4 min-[1180px]:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]";

export const TwoColumn = forwardRef(function TwoColumn({ list, detail, detailLabel = "Details" }, detailRef) {
  return (
    <div className={TWO_COLUMN_CLASS}>
      <div className="min-w-0">{list}</div>
      <section ref={detailRef} aria-label={detailLabel} className="min-w-0 self-start min-[1180px]:sticky min-[1180px]:top-4">
        {detail}
      </section>
    </div>
  );
});

/** Below 1180px the detail sits under the list: bring it into view. */
export function revealDetail(detailRef, headingRef) {
  if (typeof window === "undefined") return;
  requestAnimationFrame(() => {
    if (window.innerWidth < 1180) detailRef?.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    headingRef?.current?.focus?.({ preventScroll: window.innerWidth >= 1180 });
  });
}
