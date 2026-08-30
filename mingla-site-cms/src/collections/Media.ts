import type { CollectionConfig, FieldAccess } from "payload";
import {
  enforceLiveStudioWrite,
  tenantMediaCreate,
  tenantRead,
  tenantWrite,
} from "../lib/access";
import { MEDIA_STATES, safeText } from "../lib/validation";

const systemMediaField: FieldAccess = ({ req }) =>
  req.context?.minglaMediaGrant === true ||
  req.context?.minglaSignedCore === true;
const systemFieldAccess = {
  create: systemMediaField,
  read: systemMediaField,
  update: systemMediaField,
};

export const Media: CollectionConfig = {
  slug: "media",
  labels: { singular: "Image", plural: "Media" },
  admin: { useAsTitle: "original_filename_safe", hideAPIURL: true },
  upload: {
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    filesRequiredOnCreate: false,
  },
  hooks: { beforeOperation: [enforceLiveStudioWrite] },
  access: {
    admin: ({ req }) => Boolean(req.user),
    create: tenantMediaCreate,
    read: tenantRead,
    update: tenantWrite,
    delete: () => false,
    readVersions: tenantRead,
    unlock: tenantWrite,
  },
  fields: [
    {
      name: "state",
      type: "select",
      required: true,
      defaultValue: "UPLOADING",
      options: [...MEDIA_STATES],
      admin: { readOnly: true },
      access: { create: systemMediaField, update: systemMediaField },
    },
    {
      name: "original_filename_safe",
      type: "text",
      required: true,
      maxLength: 160,
      validate: (value: unknown) => safeText(value, 160),
    },
    {
      name: "declared_mime",
      type: "select",
      required: true,
      options: ["image/jpeg", "image/png", "image/webp"],
    },
    { name: "detected_mime", type: "text", admin: { readOnly: true }, access: systemFieldAccess },
    { name: "bytes", type: "number", admin: { readOnly: true }, access: { create: systemMediaField, update: systemMediaField } },
    { name: "width", type: "number", admin: { readOnly: true }, access: systemFieldAccess },
    { name: "height", type: "number", admin: { readOnly: true }, access: systemFieldAccess },
    { name: "checksum", type: "text", admin: { readOnly: true }, access: systemFieldAccess },
    { name: "quarantine_key", type: "text", hidden: true, access: systemFieldAccess },
    { name: "approved_master_key", type: "text", hidden: true, access: systemFieldAccess },
    { name: "rendition_manifest", type: "json", admin: { readOnly: true }, access: systemFieldAccess },
    {
      name: "rejection_code",
      type: "select",
      options: [
        "TYPE_NOT_ALLOWED",
        "TOO_LARGE",
        "DIMENSIONS_TOO_LARGE",
        "MIME_MISMATCH",
        "DECODE_FAILED",
        "CHECKSUM_MISMATCH",
        "METADATA_RETAINED",
        "PROCESSING_FAILED",
      ],
      admin: { readOnly: true },
      access: systemFieldAccess,
    },
    { name: "created_by", type: "text", hidden: true, access: systemFieldAccess },
    { name: "quarantine_delete_by", type: "date", hidden: true, access: systemFieldAccess },
    { name: "recovery_until", type: "date", hidden: true, access: systemFieldAccess },
    { name: "tombstoned_at", type: "date", hidden: true, access: systemFieldAccess },
  ],
};
