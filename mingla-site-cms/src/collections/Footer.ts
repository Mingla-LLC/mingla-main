import type { CollectionConfig } from "payload";
import {
  enforceLiveStudioWrite,
  tenantRead,
  tenantVersionRead,
  tenantWrite,
} from "../lib/access";
import { safeText, safeUrl } from "../lib/validation";
import { singletonPerTenant } from "../lib/tenantIntegrity";

export const Footer: CollectionConfig = {
  slug: "footer",
  labels: { singular: "Footer", plural: "Footer" },
  admin: { useAsTitle: "label", hideAPIURL: true },
  access: {
    admin: ({ req }) => Boolean(req.user),
    create: tenantWrite,
    read: tenantRead,
    update: tenantWrite,
    delete: () => false,
    readVersions: tenantVersionRead,
    unlock: tenantWrite,
  },
  versions: { drafts: { autosave: false }, maxPerDoc: 50 },
  hooks: {
    beforeOperation: [enforceLiveStudioWrite],
    beforeChange: [singletonPerTenant("footer")],
  },
  fields: [
    {
      name: "label",
      type: "text",
      defaultValue: "Website footer",
      admin: { readOnly: true },
    },
    {
      name: "address",
      type: "textarea",
      maxLength: 300,
      validate: (value: unknown) => (value == null ? true : safeText(value, 300)),
    },
    {
      name: "hours_summary",
      type: "textarea",
      maxLength: 500,
      validate: (value: unknown) => (value == null ? true : safeText(value, 500)),
    },
    {
      name: "legal_text",
      type: "textarea",
      maxLength: 500,
      validate: (value: unknown) => (value == null ? true : safeText(value, 500)),
    },
    {
      name: "links",
      type: "array",
      maxRows: 8,
      fields: [
        {
          name: "label",
          type: "text",
          required: true,
          maxLength: 80,
          validate: (value: unknown) => safeText(value, 80),
        },
        {
          name: "href",
          type: "text",
          required: true,
          maxLength: 2048,
          validate: safeUrl,
        },
      ],
    },
  ],
};
