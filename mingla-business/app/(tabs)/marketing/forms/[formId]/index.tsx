import React, { Suspense } from "react";

// #4514 — the form builder (the trip question builder, extended in place).
// Lazy: the builder, its preview and the question editor stay out of the
// eager web bundle.
const BrandFormBuilderScreen = React.lazy(async () => {
  const mod = await import("../../../../../src/components/forms/formsOwner");
  return { default: mod.BrandFormBuilderScreen };
});

export default function BlastFormBuilderRoute(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <BrandFormBuilderScreen />
    </Suspense>
  );
}
