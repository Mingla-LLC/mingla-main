import React from "react";

// Both Experience routes import this one tiny owner. The full wizard is loaded
// only after navigation, so sharing create/edit cannot hoist it into __common.
export const LazyExperienceCreatorWizard = React.lazy(async () => {
  const module = await import("./ExperienceCreatorWizard");
  return { default: module.ExperienceCreatorWizard };
});

export type { ExperienceWizardInitialDraft } from "./ExperienceCreatorWizard";
