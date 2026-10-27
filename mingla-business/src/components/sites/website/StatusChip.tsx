import React from "react";
import { Chip } from "./ui";
import type { WebsiteController } from "./useWebsiteController";

/** #2829 W9r — the site's status in one word (server truth: offline wins). */
export function SiteStatusChip({ controller }: { controller: WebsiteController }): React.ReactElement {
  const site = controller.site.data;
  if (!site) return <Chip label="Not created yet" />;
  if (site.owner_offline_at) return <Chip label="Offline" tone="err" testID="status-chip" />;
  if (controller.publicationOperation || site.status === "publishing") return <Chip label="Publishing…" tone="info" testID="status-chip" />;
  if (site.status === "provisioning") return <Chip label="Setting up…" tone="info" testID="status-chip" />;
  if (site.active_publication_id) return <Chip label="Live" tone="ok" testID="status-chip" />;
  return <Chip label="Draft" tone="neutral" testID="status-chip" />;
}
