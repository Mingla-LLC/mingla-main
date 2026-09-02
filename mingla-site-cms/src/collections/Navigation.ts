import type { CollectionConfig } from "payload";
import {
  enforceLiveStudioWrite,
  tenantRead,
  tenantVersionRead,
  tenantWrite,
} from "../lib/access";
import { assertTenantPages, singletonPerTenant } from "../lib/tenantIntegrity";

export const Navigation: CollectionConfig = {
  slug: "navigation",
  labels: { singular: "Navigation", plural: "Navigation" },
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
    beforeChange: [
      singletonPerTenant("navigation"),
      async ({ data, originalDoc, req }) => {
        await assertTenantPages(req, data.pages ?? originalDoc?.pages ?? []);
        return data;
      },
    ],
  },
  fields: [
    {
      name: "label",
      type: "text",
      defaultValue: "Main navigation",
      admin: { readOnly: true },
    },
    {
      name: "pages",
      type: "relationship",
      relationTo: "pages",
      hasMany: true,
      maxRows: 5,
      filterOptions: ({ req }) => {
        const tenantId = (req.user as { tenantId?: string })?.tenantId;
        return tenantId ? { tenant: { equals: tenantId }, enabled: { equals: true } } : false;
      },
    },
  ],
};
