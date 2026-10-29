/**
 * #3355 — the small capability handshake intentionally lives apart from the
 * untrusted rendition parser. `agentChatService` is shared by more than one
 * route, so importing the full parser there would promote ~10 KB of Host-only
 * rendering code into the public web boot chunk.
 */

import type { AriRenditionGraphicVariant } from "./AriRenditionGraphic";

export const ARI_RENDITION_BLOCK_TYPES = [
  "paragraph",
  "list",
  "key_value",
  "metrics",
  "table",
  "timeline",
  "progress",
  "choices",
  "input",
  "code",
  "sources",
  "callout",
] as const;

export interface AriUiCapabilitiesV2 {
  protocol_version: 2;
  max_schema_version: 2;
  block_version: 1;
  action_version: 1;
  block_types: typeof ARI_RENDITION_BLOCK_TYPES[number][];
  graphic_types: AriRenditionGraphicVariant[];
  platform: "ios" | "android" | "web" | "unknown";
  app_version: string;
  runtime_version: string | null;
}

export function buildAriUiCapabilities(input: {
  platform: string;
  appVersion: string | null | undefined;
  runtimeVersion: string | null | undefined;
}): AriUiCapabilitiesV2 {
  const platform = input.platform === "ios" || input.platform === "android" || input.platform === "web"
    ? input.platform
    : "unknown";
  return {
    protocol_version: 2,
    max_schema_version: 2,
    block_version: 1,
    action_version: 1,
    block_types: [...ARI_RENDITION_BLOCK_TYPES],
    graphic_types: ["event", "media", "site", "research", "social"],
    platform,
    app_version: input.appVersion?.trim() || "unknown",
    runtime_version: input.runtimeVersion?.trim() || null,
  };
}
