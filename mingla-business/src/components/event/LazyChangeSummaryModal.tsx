import React from "react";

import type { ChangeSummaryModalProps } from "./ChangeSummaryModal";

const DeferredChangeSummaryModal = React.lazy(async () => {
  const module = await import("./ChangeSummaryModal");
  return { default: module.ChangeSummaryModal };
});

/**
 * #4420 — the "Review changes" sheet is shared by the published event and the
 * published trip editors. Both mount it hidden, so it suspends harmlessly while
 * its own chunk loads, and one dynamic boundary keeps Metro from hoisting it
 * (two chunks reach it) into the eager `__common` boot chunk.
 */
export const ChangeSummaryModal: React.FC<ChangeSummaryModalProps> = (props) => (
  <React.Suspense fallback={null}>
    <DeferredChangeSummaryModal {...props} />
  </React.Suspense>
);
