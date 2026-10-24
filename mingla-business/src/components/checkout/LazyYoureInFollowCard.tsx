import React from "react";

import type { YoureInFollowCardProps } from "./YoureInFollowCard";

const DeferredYoureInFollowCard = React.lazy(async () => {
  const module = await import("./YoureInFollowCard");
  return { default: module.YoureInFollowCard };
});

/** Render the non-critical follow card after the purchase confirmation itself. */
export function LazyYoureInFollowCard(
  props: YoureInFollowCardProps,
): React.ReactElement {
  return (
    <React.Suspense fallback={null}>
      <DeferredYoureInFollowCard {...props} />
    </React.Suspense>
  );
}
