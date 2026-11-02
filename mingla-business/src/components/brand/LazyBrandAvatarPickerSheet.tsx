/**
 * #3355 — the one lazy owner of BrandAvatarPickerSheet.
 *
 * Brand Edit and Ari's in-chat logo upload both open the same picker. Metro
 * hoists a module into the eager `__common` chunk when more than one chunk
 * carries it (#3493), so both go through this loader and the picker, its
 * upload hook and its service ship in one chunk that loads when the owner
 * opens it. Do not add a static `import { BrandAvatarPickerSheet }` outside
 * tests.
 */
import React from "react";

export const LazyBrandAvatarPickerSheet = React.lazy(async () => {
  const mod = await import("./BrandAvatarPickerSheet");
  return { default: mod.BrandAvatarPickerSheet };
});
