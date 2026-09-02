import type { CollectionConfig } from "payload";
import {
  enforceLiveStudioWrite,
  tenantRead,
  tenantVersionRead,
  tenantWrite,
} from "../lib/access";
import { boundedColor, safeText, safeUrl } from "../lib/validation";
import {
  assertReadyTenantMedia,
  singletonPerTenant,
} from "../lib/tenantIntegrity";

export const SiteSettings: CollectionConfig = {
  slug: "site-settings",
  labels: { singular: "Site settings & SEO", plural: "Site settings & SEO" },
  admin: { useAsTitle: "display_name", hideAPIURL: true },
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
      singletonPerTenant("site-settings"),
      async ({ data, originalDoc, req }) => {
        await assertReadyTenantMedia(req, [
          data.logo ?? originalDoc?.logo,
          data.social_image ?? originalDoc?.social_image,
        ]);
        return data;
      },
    ],
  },
  fields: [
    {
      name: "display_name",
      type: "text",
      required: true,
      maxLength: 120,
      validate: (value: unknown) => safeText(value, 120),
    },
    {
      name: "short_description",
      type: "textarea",
      maxLength: 300,
      validate: (value: unknown) => (value == null ? true : safeText(value, 300)),
    },
    {
      name: "logo",
      type: "relationship",
      relationTo: "media",
      filterOptions: ({ req }) => {
        const tenantId = (req.user as { tenantId?: string })?.tenantId;
        return tenantId ? { tenant: { equals: tenantId }, state: { equals: "READY" } } : false;
      },
    },
    { name: "background_color", type: "text", validate: boundedColor },
    { name: "foreground_color", type: "text", validate: boundedColor },
    { name: "accent_color", type: "text", validate: boundedColor },
    {
      name: "typography",
      type: "select",
      defaultValue: "editorial-serif",
      options: ["modern-sans", "editorial-serif"],
    },
    {
      name: "canonical_url",
      type: "text",
      required: true,
      defaultValue: "https://gogi.sites.usemingla.com",
      admin: { readOnly: true },
      validate: safeUrl,
    },
    {
      name: "seo_title",
      type: "text",
      maxLength: 70,
      validate: (value: unknown) => (value == null ? true : safeText(value, 70)),
    },
    {
      name: "seo_description",
      type: "textarea",
      maxLength: 170,
      validate: (value: unknown) => (value == null ? true : safeText(value, 170)),
    },
    {
      name: "social_image",
      type: "relationship",
      relationTo: "media",
      filterOptions: ({ req }) => {
        const tenantId = (req.user as { tenantId?: string })?.tenantId;
        return tenantId ? { tenant: { equals: tenantId }, state: { equals: "READY" } } : false;
      },
    },
    {
      name: "analytics_consent_mode",
      type: "select",
      defaultValue: "optional",
      options: [{ label: "Optional analytics", value: "optional" }],
      admin: { readOnly: true },
    },
    {
      name: "renderer_key",
      type: "text",
      defaultValue: "restaurant-website-v1",
      hidden: true,
    },
  ],
};
