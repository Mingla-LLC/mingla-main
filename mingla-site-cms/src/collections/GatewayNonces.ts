import type { CollectionConfig } from "payload";
import { noAccess } from "../lib/access";

/**
 * Durable replay ledger for Core -> CMS requests. This collection is never
 * available to Studio users or through Payload's customer-facing navigation.
 */
export const GatewayNonces: CollectionConfig = {
  slug: "gateway-nonces",
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
    {
      name: "nonce",
      type: "text",
      required: true,
      unique: true,
      index: true,
      maxLength: 64,
    },
    {
      name: "direction",
      type: "select",
      required: true,
      options: ["core_to_cms"],
    },
    { name: "site_id", type: "text", required: true, index: true },
    { name: "operation_id", type: "text", required: true, index: true },
    { name: "expires_at", type: "date", required: true, index: true },
  ],
};
