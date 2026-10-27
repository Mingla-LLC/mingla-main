import type { CollectionConfig } from "payload";
import { noAccess } from "../lib/access";

/**
 * #2829 AD-3 — the shared cache of downloaded Google font files.
 *
 * NOT tenant-scoped, on purpose: fonts are public open-source works stored
 * under their own content digest, so one brand having fetched "Fraunces 400"
 * tells another brand nothing, and sharing the row stops every publish from
 * refetching the same file. No Studio user can read or write it; only the
 * publication builder touches it, server-side, with overrideAccess.
 */
export const FontAssets: CollectionConfig = {
  slug: "font-assets",
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
    // The exact family request the face belongs to (family|weights|italic|subsets|v).
    { name: "request_key", type: "text", required: true, index: true, maxLength: 300 },
    { name: "family", type: "text", required: true, maxLength: 64 },
    { name: "weight", type: "number", required: true, min: 100, max: 900 },
    { name: "style", type: "select", required: true, options: ["normal", "italic"] },
    { name: "unicode_range", type: "text", required: true, maxLength: 2000 },
    { name: "digest", type: "text", required: true, index: true, maxLength: 64 },
    { name: "bytes", type: "number", required: true, min: 1 },
  ],
};
