import { ValidationError, type CollectionConfig, type PayloadRequest } from "payload";
import {
  enforceLiveStudioWrite,
  tenantRead,
  tenantVersionRead,
  tenantWrite,
} from "../lib/access";
import { safeText, safeTimeZone, safeUrl } from "../lib/validation";
import { MAX_REDIRECTS } from "../contracts/generated/limits.ts";
import {
  COLLECTION_KINDS,
  DEFAULT_SITE_ROUTES,
  isBasePath,
  redirectRuleProblem,
} from "../contracts/generated/routes.ts";
import { DESIGN_KEYS, DESIGNS } from "../contracts/generated/designs.ts";
import { BUTTON_SHAPES, MOTION_PRESETS, RADIUS_PRESETS } from "../contracts/generated/tokens.ts";
import { validateFontsField, validateTokensField } from "../lib/siteLook";
import {
  assertReadyTenantMedia,
  bindRequestTenant,
  singletonPerTenant,
} from "../lib/tenantIntegrity";
import { collectMediaIds } from "../lib/mediaFields";
import { reportLookSavedHook } from "../lib/lookSavedReport";


/** #2829 — `https://<tenant primary host>`, or null while it is unknown. */
async function tenantLiveAddress(
  req: PayloadRequest,
  tenant: unknown,
): Promise<string | null> {
  const tenantId = tenant && typeof tenant === "object"
    ? (tenant as { id?: unknown }).id
    : tenant;
  if (typeof tenantId !== "string" && typeof tenantId !== "number") return null;
  try {
    const record = await req.payload.findByID({
      collection: "tenants",
      id: String(tenantId),
      overrideAccess: true,
      depth: 0,
    });
    const host = record.primary_hostname;
    return typeof host === "string" && /^[a-z0-9.-]{4,253}$/.test(host)
      ? `https://${host}`
      : null;
  } catch {
    return null;
  }
}

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
      /*
       * #2829 S-10 — the look is checked on EVERY save, drafts included
       * (Payload skips field validators on draft saves, and Studio, Ari and
       * the Business app all save drafts). Only token values of fixed types
       * and catalogue fonts are ever stored — never CSS.
       */
      ({ data, req }) => {
        const errors: Array<{ path: string; message: string }> = [];
        if ("tokens" in data) {
          const verdict = validateTokensField(data.tokens);
          if (verdict !== true) errors.push({ path: "tokens", message: verdict });
        }
        if ("fonts" in data) {
          const verdict = validateFontsField(data.fonts);
          if (verdict !== true) errors.push({ path: "fonts", message: verdict });
        }
        if (errors.length) throw new ValidationError({ collection: "site-settings", errors, req });
        return data;
      },
      async ({ data, originalDoc, req }) => {
        // #2829 — every media field the settings schema declares.
        await assertReadyTenantMedia(req, [
          ...collectMediaIds(SiteSettings.fields, { ...(originalDoc ?? {}), ...data }),
        ]);
        return data;
      },
      bindRequestTenant,
    ],
    // #2829 W9a — Core learns the look was saved ("Your look" on the plan).
    afterChange: [reportLookSavedHook()],
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
     * #2829 AD-2 — the site's look: its design, and the owner's exact choices
     * on top of the design's defaults. Any colour and any Google font; Studio
     * shows readability warnings and never changes a colour. Stored as token
     * values of fixed types (validated by site-contracts), never as CSS.
     */
    {
      name: "design",
      label: "Design",
      type: "select",
      defaultValue: "atelier",
      options: DESIGN_KEYS.map((key) => ({ value: key, label: DESIGNS[key].label })),
      admin: {
        description: "Switching design keeps all your content.",
        components: { Field: "@/components/studio/DesignPicker#default" },
      },
    },
    {
      name: "tokens",
      label: "Colours",
      type: "json",
      validate: validateTokensField,
      admin: { components: { Field: "@/components/studio/TokenEditor#default" } },
    },
    {
      name: "fonts",
      label: "Fonts",
      type: "json",
      validate: validateFontsField,
      admin: { components: { Field: "@/components/studio/FontPicker#default" } },
    },
    {
      name: "radius",
      label: "Corners",
      type: "select",
      defaultValue: "design",
      options: RADIUS_PRESETS.map((value) => ({
        value,
        label: { design: "As designed", sharp: "Sharp", soft: "Soft", round: "Round" }[value],
      })),
    },
    {
      name: "button_shape",
      label: "Buttons",
      type: "select",
      defaultValue: "design",
      options: BUTTON_SHAPES.map((value) => ({
        value,
        label: { design: "As designed", pill: "Pill", rounded: "Rounded", square: "Square" }[value],
      })),
    },
    {
      name: "motion",
      label: "Motion",
      type: "select",
      defaultValue: "design",
      options: MOTION_PRESETS.map((value) => ({
        value,
        label: { design: "As designed", calm: "Calm", lively: "Lively", none: "None" }[value],
      })),
      admin: { description: "Visitors who ask their device for reduced motion always get none." },
    },
    {
      /*
       * #2829 W9r — past Mingla trips the owner hid from the website (display
       * only; the trip itself is untouched). Not in Studio's form: written
       * only by the Business app's Past trips switch, whose Core-signed call
       * raises `minglaOfferingVisibility` after Core checked rank 50. Any other
       * write keeps the stored list.
       */
      name: "hidden_offering_ids",
      type: "json",
      admin: { hidden: true },
      validate: (value: unknown) =>
        value == null || (Array.isArray(value) && value.length <= 500 &&
          value.every((id) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)))
          ? true
          : "Hidden trips must be a list of Mingla trip ids.",
      hooks: {
        beforeChange: [
          ({ value, previousValue, req }) =>
            req.context?.minglaOfferingVisibility === true ? value : (previousValue ?? null),
        ],
      },
    },
    {
      // #2829 — "Live address": computed from the tenant's primary host on
      // every read and write; never typed, never defaulted to one brand.
      name: "canonical_url",
      type: "text",
      label: "Live address",
      admin: {
        readOnly: true,
        description: "Your website's address. Mingla sets it for you.",
      },
      validate: (value: unknown) => (value == null || value === "" ? true : safeUrl(value)),
      hooks: {
        beforeChange: [async ({ req, data }) => tenantLiveAddress(req, data?.tenant)],
        afterRead: [async ({ req, data }) => tenantLiveAddress(req, data?.tenant)],
      },
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
    /*
     * #2829 AD-5 — where each collection's detail pages live, the site's
     * language and timezone, and the owner's own redirects. Validated against
     * the shared route contract so Studio refuses exactly what the runtime
     * would refuse.
     */
    {
      name: "routes",
      type: "group",
      admin: { description: "Where each kind of detail page lives, for example trips/<name>." },
      fields: COLLECTION_KINDS.map((kind) => ({
        name: kind,
        type: "text" as const,
        maxLength: 60,
        admin: {
          description: kind === "stories"
            ? `Default "${DEFAULT_SITE_ROUTES[kind]}". Leave empty to put stories at the site root.`
            : `Default "${DEFAULT_SITE_ROUTES[kind]}".`,
        },
        validate: (value: unknown) =>
          value == null || (value === "" && kind === "stories") || isBasePath(kind, value)
            ? true
            : "Use lowercase letters, numbers and single hyphens, not a reserved word.",
      })),
    },
    {
      name: "language",
      type: "text",
      defaultValue: "en",
      maxLength: 35,
      validate: (value: unknown) =>
        value == null || value === "" ||
        (typeof value === "string" && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value))
          ? true
          : "Use a language tag, for example en or en-GB.",
    },
    { name: "timezone", type: "text", maxLength: 60, validate: safeTimeZone },
    {
      name: "redirects",
      type: "array",
      maxRows: MAX_REDIRECTS,
      admin: { description: "Send an old address to a new one, for example /destinations to /stamped-destinations." },
      fields: [
        { name: "from", type: "text", required: true, maxLength: 200 },
        { name: "to", type: "text", required: true, maxLength: 2048 },
        {
          name: "status",
          type: "select",
          required: true,
          defaultValue: "308",
          options: [
            { label: "Permanent (308)", value: "308" },
            { label: "Permanent, legacy (301)", value: "301" },
          ],
        },
      ],
      validate: (value: unknown) => {
        const rows = Array.isArray(value) ? value : [];
        for (const row of rows as Array<Record<string, unknown>>) {
          const problem = redirectRuleProblem({ from: row.from, to: row.to, status: Number(row.status) });
          if (problem) return `The redirect from ${String(row.from ?? "")} is not valid (${problem}).`;
        }
        return true;
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
      defaultValue: "sites-v2",
      hidden: true,
    },
  ],
};
