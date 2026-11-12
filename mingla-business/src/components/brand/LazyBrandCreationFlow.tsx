/**
 * #3493 — the one lazy owner of the brand creation flows.
 *
 * Metro hoists a module into the eager `__common` chunk when more than one
 * chunk carries it. #4389: the setup flow mounts only on the two full-screen
 * routes (`/brand/new`, `/brand/[id]/setup`); the brand switcher no longer
 * mounts it (that native-modal-over-overlay stack was the freeze). Partner
 * client mode keeps its own flow. Do not add a static import outside tests.
 */
import React from "react";

export const LazyBrandCreationFlow = React.lazy(async () => {
  const mod = await import("./BrandCreationFlow");
  return { default: mod.BrandCreationFlow };
});

export const LazyDraftInProgress = React.lazy(async () => {
  const mod = await import("./BrandCreationFlow");
  return { default: mod.DraftInProgress };
});

export const LazyPartnerClientBrandCreationFlow = React.lazy(async () => {
  const mod = await import("./PartnerClientBrandCreationFlow");
  return { default: mod.BrandCreationFlow };
});
