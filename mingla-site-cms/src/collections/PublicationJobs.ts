import type { CollectionConfig } from "payload";
import { noAccess } from "../lib/access";

export const PublicationJobs: CollectionConfig = {
  slug: "publication-jobs",
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
    { name: "operation_id", type: "text", required: true, unique: true },
    { name: "source_revision_id", type: "text", required: true },
    { name: "source_digest", type: "text", required: true },
    { name: "validation_result", type: "json" },
    { name: "artifact_key", type: "text" },
    { name: "artifact_digest", type: "text" },
    {
      name: "status",
      type: "select",
      required: true,
      options: [
        "queued",
        "validating",
        "materializing",
        "probing",
        "published",
        "failed",
        "ambiguous",
      ],
    },
    { name: "retry_count", type: "number", defaultValue: 0 },
    { name: "failure_code", type: "text" },
  ],
};
