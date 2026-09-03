import type { CollectionConfig } from "payload";
import {
  enforceLiveStudioWrite,
  tenantRead,
  tenantVersionRead,
  tenantWrite,
} from "../lib/access";
import { boundedColor, safeText, safeUrl } from "../lib/validation";
import { FONT_PAIRINGS, FONT_PAIRING_KEYS } from "../lib/fontPairings";
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
    /*
     * #2830 — the brand's own look. These fields already existed and were read
     * by nobody: the runtime stylesheet hardcoded the pilot customer's palette,
     * so a brand could set a colour here and see no change. They now drive the
     * published site.
     */
    {
      name: "background_color",
      label: "Background colour",
      type: "text",
      validate: boundedColor,
      admin: { description: "Six-digit hex, for example #101013." },
    },
    {
      name: "foreground_color",
      label: "Text colour",
      type: "text",
      validate: boundedColor,
      admin: { description: "Six-digit hex, for example #f0eee9." },
    },
    {
      name: "accent_color",
      label: "Accent colour",
      type: "text",
      validate: boundedColor,
      admin: {
        description:
          "Six-digit hex. Used for buttons, links and section rules, for example #cda052.",
      },
    },
    {
      name: "typography",
      label: "Fonts",
      type: "select",
      defaultValue: "condensed-display",
      // Options come from the shared pairing list so the editor can never offer
      // a font the published site does not serve.
      options: FONT_PAIRING_KEYS.map((value) => ({
        value,
        label: FONT_PAIRINGS[value].label,
      })),
      admin: {
        description:
          "Both faces are served from your own website, so nothing is requested from another company.",
      },
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
