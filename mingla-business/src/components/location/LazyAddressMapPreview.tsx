/**
 * #3355 — the one lazy owner of AddressMapPreview.
 *
 * The event "Where" step and Brand Edit's address field show the same map
 * preview. The Where step rides the eager `__common` chunk, so a static import
 * there would put the preview on every visitor's boot path (#3493). Both go
 * through this loader; the preview (an image from the static-map proxy) loads
 * with its own small chunk. Do not add a static `import { AddressMapPreview }`
 * outside tests.
 */
import React from "react";

export const LazyAddressMapPreview = React.lazy(async () => {
  const mod = await import("./AddressMapPreview");
  return { default: mod.AddressMapPreview };
});
