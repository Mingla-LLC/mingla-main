import type { CollectionConfig } from "payload";
import { noAccess } from "../lib/access";

/*
 * #2829 W9b (L4) — the six design checks' results, stored per draft revision
 * (the draft digest Publish checks). A site's FIRST publish needs a run on
 * the exact draft being published; every result is a warning otherwise.
 * Written and read only by Studio's signed endpoints (overrideAccess with the
 * tenant named explicitly); not a Studio screen.
 */
export const DesignCheckRuns: CollectionConfig = {
  slug: "design-check-runs",
  admin: { hidden: true },
  access: {
    admin: () => false,
    create: noAccess,
    read: noAccess,
    update: noAccess,
    delete: noAccess,
    readVersions: noAccess,
    unlock: noAccess,
  },
  fields: [
    { name: "draft_digest", type: "text", required: true, index: true },
    { name: "results", type: "json", required: true },
    { name: "warning_count", type: "number", required: true },
    { name: "run_by", type: "select", required: true, options: ["ari", "user"] },
  ],
};
