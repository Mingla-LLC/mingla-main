import type { CollectionConfig } from "payload";
import { noAccess, tenantRead } from "../lib/access";
import { MAX_WORK_LOG_DECISION, workLogCitesProblem } from "../contracts/generated/ariToolSchemas.ts";

/*
 * #2829 W9b — "Why it looks like this": one row per change Ari (or a
 * teammate) made to a site's draft, with the reason in plain words and at
 * least one citation (the owner's own words, a Mingla record, or the owner's
 * photo or video).
 *
 * Append-only: Studio members read their own site's rows; nobody edits or
 * deletes them (rows are written by the Core-signed Ari path with the tenant
 * named explicitly). Included in "Download everything"; never published to
 * visitors (the artifact builder does not read this collection).
 */
export const WORK_LOG_PARTS = [
  "plan",
  "draft",
  "composition",
  "variant",
  "tokens",
  "copy",
  "imagery",
  "collection",
  "trip_guide",
] as const;
export type WorkLogPart = (typeof WORK_LOG_PARTS)[number];

export const WorkLog: CollectionConfig = {
  slug: "work-log",
  labels: { singular: "Why it looks like this", plural: "Why it looks like this" },
  admin: {
    useAsTitle: "decision",
    hideAPIURL: true,
    defaultColumns: ["decision", "part", "actor", "createdAt"],
    description: "Every change Ari made to your website, why, and what it was based on. Never shown to visitors.",
  },
  access: {
    admin: ({ req }) => Boolean(req.user),
    read: tenantRead,
    create: noAccess,
    update: noAccess,
    delete: noAccess,
    readVersions: noAccess,
    unlock: noAccess,
  },
  defaultSort: "-createdAt",
  fields: [
    { name: "part", label: "What changed", type: "select", required: true, options: [...WORK_LOG_PARTS] },
    {
      name: "decision",
      label: "Why",
      type: "textarea",
      required: true,
      maxLength: MAX_WORK_LOG_DECISION,
    },
    {
      name: "cites",
      label: "Based on",
      type: "json",
      required: true,
      validate: (value: unknown) => workLogCitesProblem(value) ?? true,
    },
    { name: "actor", label: "Who", type: "select", required: true, options: ["ari", "user"] },
    { name: "actor_user_id", type: "text", maxLength: 64, admin: { hidden: true } },
    { name: "tool", label: "Ari tool", type: "text", maxLength: 64 },
    { name: "target", label: "Where", type: "text", maxLength: 200 },
    // The draft revision the change produced (a page revision, the settings
    // revision, or an entry revision), so a reader can line it up with History.
    { name: "revision", type: "text", maxLength: 200, admin: { hidden: true } },
  ],
};
