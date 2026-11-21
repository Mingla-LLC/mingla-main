import React, { Suspense } from "react";

// #4514 — one form's Responses (Summary, Responses, Not answered, Export).
// Lazy, like the rest of Forms.
const BrandFormResponsesScreen = React.lazy(async () => {
  const mod = await import("../../../../../src/components/forms/formsOwner");
  return { default: mod.BrandFormResponsesScreen };
});

export default function BlastFormResponsesRoute(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <BrandFormResponsesScreen />
    </Suspense>
  );
}
