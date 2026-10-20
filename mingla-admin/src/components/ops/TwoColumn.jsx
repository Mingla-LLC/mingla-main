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
