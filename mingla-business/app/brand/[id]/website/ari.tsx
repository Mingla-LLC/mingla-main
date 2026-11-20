// orch-strict-grep-allow safearea-on-fullscreen-routes — Redirect-only route renders no visible surface before leaving.

import React from "react";
import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * #2830 — the Website "Edit with Ari" entry point.
 *
 * IT REDIRECTS RATHER THAN RENDERING, and that is a measured decision, not a
 * shortcut. Importing `AriChatScreen` statically here gave the module a second
 * consumer, and Metro hoists anything shared between two chunks into
 * `__common` — the payload every Business user downloads before anything
 * renders. Measured: 2,436,294 B to 2,569,912 B, a 133KB regression on the boot
 * path. The screen loads only through inline `React.lazy` imports from the Ari
 * tab and Website setup (I-ARI-CHAT-ONE-CHUNK).
 */
export default function BrandWebsiteAriRoute(): React.ReactElement {
  const params = useLocalSearchParams<{
    id: string | string[];
    intent?: string | string[];
    part?: string | string[];
  }>();
  const brandId = Array.isArray(params.id) ? params.id[0] : params.id;
  const safeBrandId = typeof brandId === "string" ? brandId : "";
  const requestedIntent = Array.isArray(params.intent) ? params.intent[0] : params.intent;
  const requestedPart = Array.isArray(params.part) ? params.part[0] : params.part;
  const part = typeof requestedPart === "string" && requestedPart.length > 0 ? requestedPart : null;
  // #2830 — setup with Ari lives on the one setup screen; old links land there.
  if (requestedIntent === "setup") {
    return (
      <Redirect
        href={
          `/brand/${encodeURIComponent(safeBrandId)}/website/setup?ari=1${part ? `&step=${encodeURIComponent(part)}` : ""}` as never
        }
      />
    );
  }
  // #4453 — the full Ari chat with the website in view stays one tap away
  // (the workspace's "Open the full Ari chat" asks for it by name).
  if (requestedIntent === "chat") {
    return (
      <Redirect
        href={`/(tabs)/ari?brandId=${encodeURIComponent(safeBrandId)}&sitesIntent=edit` as never}
      />
    );
  }
  // #4453 — editing with Ari happens in the Website workspace's Ari mode: its
  // own light panel, so the chat screen's chunk is still never loaded here.
  // A brand with no website yet lands on the Website screen, which says so.
  return (
    <Redirect
      href={`/brand/${encodeURIComponent(safeBrandId)}/website?mode=ari` as never}
    />
  );
}
