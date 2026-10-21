/**
 * #3493 — the one lazy owner of BrandCreationFlow.
 *
 * Metro hoists a module into the eager `__common` chunk when more than one
 * chunk carries it, and a static importer plus a dynamic one is still two. The
 * `/brand/new` route and the brand switcher's create mode both mount the flow,
 * so both go through this loader and the flow ships in a single chunk of its
 * own. Do not add a static `import { BrandCreationFlow }` outside tests.
 */
import React from "react";

export const LazyBrandCreationFlow = React.lazy(async () => {
  const mod = await import("./BrandCreationFlow");
  return { default: mod.BrandCreationFlow };
});
