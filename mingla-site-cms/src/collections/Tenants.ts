import type { Access, CollectionConfig } from "payload";
import { noAccess } from "../lib/access";

export const readSignedSessionTenant: Access = ({ req }) => {
  const current = req.user as Record<string, unknown> | null;
  if (
    current?.collection !== "studio-users" ||
    typeof current.rank !== "number" ||
    current.rank < 20 ||
    typeof current.tenantId !== "string" ||
    current.tenantId.length === 0
  ) {
    return false;
  }
  return { id: { equals: current.tenantId } };
};

export const Tenants: CollectionConfig = {
  slug: "tenants",
  admin: { hidden: true },
  access: {
    admin: () => false,
    create: noAccess,
    read: readSignedSessionTenant,
    update: noAccess,
    delete: noAccess,
    readVersions: noAccess,
    unlock: noAccess,
  },
  fields: [
    { name: "name", type: "text", required: true, maxLength: 120 },
    {
      name: "core_site_id",
      type: "text",
      required: true,
      unique: true,
      index: true,
    },
    {
      name: "core_brand_id",
      type: "text",
      required: true,
      unique: true,
      index: true,
    },
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "active",
      options: ["provisioning", "active", "suspended"],
    },
    {
      // #2829 — the site's live address, named by Core at provision time.
      name: "primary_hostname",
      type: "text",
      maxLength: 253,
      admin: { readOnly: true },
    },
    {
      // #2829 — either renderer; new tenants are created for sites-v2.
      name: "renderer_key",
      type: "text",
      required: true,
      defaultValue: "sites-v2",
      admin: { readOnly: true },
      validate: (value: unknown) =>
        value === "restaurant-website-v1" || value === "sites-v2" ? true : "Unknown renderer.",
    },
    {
      name: "renderer_version",
      type: "number",
      required: true,
      defaultValue: 1,
      min: 1,
      admin: { readOnly: true },
    },
  ],
};
