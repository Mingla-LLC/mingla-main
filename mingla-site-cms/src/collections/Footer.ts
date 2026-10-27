import type { CollectionConfig } from "payload";
import {
  enforceLiveStudioWrite,
  tenantRead,
  tenantVersionRead,
  tenantWrite,
} from "../lib/access";
import { safeText, safeUrl } from "../lib/validation";
import { bindRequestTenant, singletonPerTenant } from "../lib/tenantIntegrity";

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
    beforeChange: [singletonPerTenant("footer"), bindRequestTenant],
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
    /*
     * #2829 W2 — the richer footer the travel designs use (W3/W7 render it).
     * "Powered by Mingla" is not a field: every site shows it (A1.1).
     */
    {
      name: "tagline_lines",
      type: "array",
      maxRows: 3,
      fields: [
        {
          name: "text",
          type: "text",
          required: true,
          maxLength: 80,
          validate: (value: unknown) => safeText(value, 80),
        },
      ],
    },
    {
      name: "location",
      type: "text",
      maxLength: 120,
      validate: (value: unknown) => (value == null || value === "" ? true : safeText(value, 120)),
    },
    { name: "email", type: "email" },
    {
      name: "columns",
      type: "array",
      maxRows: 4,
      fields: [
        {
          name: "heading",
          type: "text",
          required: true,
          maxLength: 40,
          validate: (value: unknown) => safeText(value, 40),
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
            { name: "href", type: "text", required: true, maxLength: 2048, validate: safeUrl },
          ],
        },
      ],
    },
    {
      name: "socials",
      type: "array",
      maxRows: 8,
      fields: [
        {
          name: "network",
          type: "select",
          required: true,
          options: ["instagram", "tiktok", "facebook", "x", "youtube", "linkedin", "threads", "whatsapp"]
            .map((value) => ({ label: value === "x" ? "X" : value[0]!.toUpperCase() + value.slice(1), value })),
        },
        { name: "url", type: "text", required: true, maxLength: 2048, validate: safeUrl },
      ],
    },
    {
      name: "copyright",
      type: "text",
      maxLength: 160,
      admin: { description: "You can use {year} and {site_name}." },
      validate: (value: unknown) => (value == null || value === "" ? true : safeText(value, 160)),
    },
    {
      name: "built_by",
      type: "group",
      fields: [
        {
          name: "label",
          type: "text",
          maxLength: 80,
          validate: (value: unknown) => (value == null || value === "" ? true : safeText(value, 80)),
        },
        { name: "url", type: "text", maxLength: 2048, validate: safeUrl },
      ],
    },
  ],
};
