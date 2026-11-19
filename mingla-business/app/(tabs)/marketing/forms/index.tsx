import React, { Suspense } from "react";

// #4514 — Promote › Forms (the host's guest-question forms). The screen loads
// on demand, so none of it is in the eager web bundle. The Blast layout owns
// the safe area, the brand switcher and the section pills.
const BrandFormsListScreen = React.lazy(async () => {
  const mod = await import("../../../../src/components/forms/BrandFormsListScreen");
  return { default: mod.BrandFormsListScreen };
});

export default function BlastFormsRoute(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <BrandFormsListScreen />
    </Suspense>
  );
}
