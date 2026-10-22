import React from "react";

import type { FollowerCountLineProps } from "./FollowerCountLine";

const DeferredFollowerCountLine = React.lazy(async () => {
  const module = await import("./FollowerCountLine");
  return { default: module.FollowerCountLine };
});

/** Keep secondary social proof out of the eager public-page payload. */
export function LazyFollowerCountLine(
  props: FollowerCountLineProps,
): React.ReactElement {
  return (
    <React.Suspense fallback={null}>
      <DeferredFollowerCountLine {...props} />
    </React.Suspense>
  );
}
