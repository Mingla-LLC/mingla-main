import React from "react";
import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * #2830 — the Website "Edit with Ari" entry point.
 *
 * IT REDIRECTS RATHER THAN RENDERING, and that is a measured decision, not a
 * shortcut. Importing `AriChatScreen` here gave the module a SECOND consumer,
 * and Metro hoists anything shared between two chunks into `__common` — the
 * payload every Business user downloads before anything renders. Measured:
 * 2,436,294 B to 2,569,912 B, a 133KB regression on the boot path for people
 * who may never open Ari. `React.lazy` does not help; sharing is what hoists,
 * not eagerness.
 *
 * So the split view lives WITH the Ari screen, behind `sitesIntent=edit`, and
 * this route just carries the brand across. One consumer, no hoist, and the
 * two-column layout Seth approved is unchanged.
 */
export default function BrandWebsiteAriRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const brandId = Array.isArray(params.id) ? params.id[0] : params.id;
  const safeBrandId = typeof brandId === "string" ? brandId : "";
  return (
    <Redirect
      href={
        `/(tabs)/ari?brandId=${encodeURIComponent(safeBrandId)}&sitesIntent=edit` as never
      }
    />
  );
}
