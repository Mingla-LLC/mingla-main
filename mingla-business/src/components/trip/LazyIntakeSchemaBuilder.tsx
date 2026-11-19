/**
 * #4514 — the question builder, loaded on demand through ONE lazy owner.
 *
 * The trip create wizard, the trip edit accordion and the brand form builder
 * all draw the same builder. Loading it through this single `import()` keeps
 * it (with the editor and type picker) in one async chunk. Imported statically
 * by two lazy routes and a third, Metro would hoist about 40 KB of it into the
 * eager `__common` chunk every Host web visitor downloads first.
 */

import React from "react";

import type { IntakeSchemaBuilderProps } from "./IntakeSchemaBuilder";

const Builder = React.lazy(async () => {
  const mod = await import("./IntakeSchemaBuilder");
  return { default: mod.IntakeSchemaBuilder };
});

export const LazyIntakeSchemaBuilder: React.FC<IntakeSchemaBuilderProps> = (props) => (
  <React.Suspense fallback={null}>
    <Builder {...props} />
  </React.Suspense>
);

export default LazyIntakeSchemaBuilder;
