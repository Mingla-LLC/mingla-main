/**
 * #4389 — web build of LazyBrandPaystackOnboardView: the Nigerian bank card
 * loads on intent in its own chunk (React.lazy, null fallback), so the four
 * web chunks that show it do not hoist it into the eager __common chunk. The
 * card appears a moment after its screen; nothing else on the screen waits.
 */
import React from "react";

import type { BrandPaystackOnboardViewProps } from "./BrandPaystackOnboardView";

export type { BrandPaystackOnboardViewProps } from "./BrandPaystackOnboardView";

const Card = React.lazy(async () => {
  const mod = await import("./BrandPaystackOnboardView");
  return { default: mod.BrandPaystackOnboardView };
});

export const BrandPaystackOnboardView: React.FC<BrandPaystackOnboardViewProps> = (props) => (
  <React.Suspense fallback={null}>
    <Card {...props} />
  </React.Suspense>
);
