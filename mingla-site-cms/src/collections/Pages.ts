import type {
  CollectionBeforeChangeHook,
  CollectionBeforeDeleteHook,
  CollectionConfig,
} from "payload";
import { restaurantBlocks } from "../blocks/restaurantBlocks";
import { enforceLiveStudioWrite, tenantRead, tenantWrite } from "../lib/access";
import { PAGE_ROLES, safeText } from "../lib/validation";
import { assertReadyTenantMedia, requestTenant } from "../lib/tenantIntegrity";

const roleSlug: Record<string, string> = {
  home: "/",
  about: "about",
  menu: "menu",
  gallery: "gallery",
  contact: "contact",
};
const enforcePage: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  const tenantId = requestTenant(req);
  const role = String(data.role || originalDoc?.role || "");
  if (!PAGE_ROLES.includes(role as never)) throw new Error("VALIDATION_FAILED");
  if (
    operation === "update" &&
    Number(data.revision) !== Number(originalDoc?.revision)
  )
    throw new Error("REVISION_CONFLICT");
  const existing = await req.payload.find({
    collection: "pages",
    overrideAccess: req.context?.minglaSignedCore === true,
    req,
    depth: 0,
    limit: 1,
    where: {
      and: [
        { tenant: { equals: tenantId } },
        { role: { equals: role } },
        ...(originalDoc?.id ? [{ id: { not_equals: originalDoc.id } }] : []),
      ],
    },
  });
  if (existing.totalDocs > 0) throw new Error("VALIDATION_FAILED");
  const blocks = Array.isArray(data.blocks) ? data.blocks : originalDoc?.blocks ?? [];
  const mediaValues: unknown[] = [];
  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") throw new Error("VALIDATION_FAILED");
    const block = raw as Record<string, unknown>;
    if (block.media) mediaValues.push(block.media);
    if (Array.isArray(block.images)) {
      for (const image of block.images) {
        if (image && typeof image === "object") mediaValues.push((image as Record<string, unknown>).media);
      }
    }
  }
  await assertReadyTenantMedia(req, mediaValues);
  return {
    ...data,
    slug: roleSlug[role],
    enabled: role === "home" ? true : data.enabled,
    revision: operation === "create" ? 1 : Number(originalDoc.revision) + 1,
  };
};
const protectHome: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const page = await req.payload.findByID({
    collection: "pages",
    id,
    overrideAccess: false,
    req,
    depth: 0,
  });
  if (page.role === "home") throw new Error("INVALID_STATE");
};

export const Pages: CollectionConfig = {
  slug: "pages",
  labels: { singular: "Page", plural: "Pages" },
  admin: {
    useAsTitle: "title",
    hideAPIURL: true,
    defaultColumns: ["title", "role", "enabled", "revision", "updatedAt"],
  },
  access: {
    admin: ({ req }) => Boolean(req.user),
    create: tenantWrite,
    read: tenantRead,
    update: tenantWrite,
    delete: tenantWrite,
    readVersions: tenantRead,
    unlock: tenantWrite,
  },
  versions: { drafts: { autosave: false }, maxPerDoc: 50 },
  hooks: {
    beforeOperation: [enforceLiveStudioWrite],
    beforeChange: [enforcePage],
    beforeDelete: [protectHome],
  },
  fields: [
    {
      name: "role",
      type: "select",
      required: true,
      options: PAGE_ROLES.map((role) => ({
        label: role[0].toUpperCase() + role.slice(1),
        value: role,
      })),
    },
    { name: "slug", type: "text", required: true, admin: { readOnly: true } },
    {
      name: "title",
      type: "text",
      required: true,
      maxLength: 120,
      validate: (value: unknown) => safeText(value, 120),
    },
    { name: "enabled", type: "checkbox", defaultValue: true },
    {
      name: "nav_label",
      type: "text",
      required: true,
      maxLength: 40,
      validate: (value: unknown) => safeText(value, 40),
    },
    { name: "nav_order", type: "number", required: true, min: 0, max: 4 },
    {
      name: "revision",
      type: "number",
      required: true,
      defaultValue: 1,
      admin: { readOnly: true },
    },
    {
      name: "blocks",
      type: "blocks",
      blocks: restaurantBlocks,
      minRows: 0,
      maxRows: 40,
    },
    {
      name: "seo",
      type: "group",
      fields: [
        {
          name: "title",
          type: "text",
          maxLength: 70,
          validate: (value: unknown) => (value == null ? true : safeText(value, 70)),
        },
        {
          name: "description",
          type: "textarea",
          maxLength: 170,
          validate: (value: unknown) => (value == null ? true : safeText(value, 170)),
        },
      ],
    },
  ],
};
