import {
  ValidationError,
  type CollectionBeforeChangeHook,
  type CollectionConfig,
  type Field,
  type FieldAccess,
} from "payload";
import {
  enforceLiveStudioWrite,
  tenantRead,
  tenantVersionRead,
  tenantWrite,
} from "../lib/access";
import { safeText } from "../lib/validation";
import { siteRichTextEditor } from "../lib/richTextEditor";
import { assertReadyTenantMedia, bindRequestTenant, requestTenant } from "../lib/tenantIntegrity";
import { collectMediaIds } from "../lib/mediaFields";
import { SLUG_PATTERN } from "../contracts/generated/routes.ts";
import { MAX_SLUG_LENGTH } from "../contracts/generated/limits.ts";
import {
  MAX_COLLECTION_GALLERY,
  MAX_DESTINATION_SEASONS,
  MAX_DID_YOU_KNOW,
  MAX_RELATED_OFFERINGS,
  MAX_SEASON_ACTIVITIES,
  MAX_TESTIMONIAL_QUOTE,
} from "../contracts/generated/collections.ts";

/*
 * #2829 W5 — the site's own content collections: destinations, stories (and
 * their categories) and testimonials. Tenant-scoped like pages (the
 * multi-tenant plugin adds the tenant and every read is limited to it), drafts
 * like pages, editable by Studio members of rank 20 and above, every write
 * re-authorised against Core (enforceLiveStudioWrite).
 *
 * Only `enabled` entries are published, and a testimonial only when someone
 * confirmed it is real. Past trips are NOT here (amendment A1.3): they are
 * ended Mingla trips, read from Mingla's feed.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const text = (name: string, label: string, max: number, required = false, description?: string): Field => ({
  name,
  label,
  type: "text",
  required,
  maxLength: max,
  validate: (value: unknown) => (value == null || value === "" ? (required ? "Required." : true) : safeText(value, max)),
  ...(description ? { admin: { description } } : {}),
});

const area = (name: string, label: string, max: number, required = false, description?: string): Field => ({
  name,
  label,
  type: "textarea",
  required,
  maxLength: max,
  validate: (value: unknown) => (value == null || value === "" ? (required ? "Required." : true) : safeText(value, max)),
  ...(description ? { admin: { description } } : {}),
});

const slugField = (description: string): Field => ({
  name: "slug",
  label: "Address",
  type: "text",
  required: true,
  maxLength: MAX_SLUG_LENGTH,
  validate: (value: unknown) =>
    typeof value === "string" && value.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(value)
      ? true
      : "Use lowercase letters, numbers and single hyphens, for example bali.",
  admin: { description },
});

const tenantMedia = (name: string, label: string, required = false): Field => ({
  name,
  label,
  type: "relationship",
  relationTo: "media",
  required,
  filterOptions: ({ req }) => {
    const tenantId = (req.user as { tenantId?: string })?.tenantId;
    return tenantId ? { tenant: { equals: tenantId }, state: { equals: "READY" } } : false;
  },
});

const offeringId = (): Field => ({
  name: "offering_id",
  label: "Mingla trip, event or experience id",
  type: "text",
  required: true,
  validate: (value: unknown) => (typeof value === "string" && UUID_RE.test(value) ? true : "Paste the Mingla id."),
});

const seoGroup = (): Field => ({
  name: "seo",
  type: "group",
  fields: [
    text("title", "Search title", 70),
    text("description", "Search description", 160),
    { name: "noindex", label: "Hide from search engines", type: "checkbox", defaultValue: false },
  ],
});

const enabledField = (): Field => ({
  name: "enabled",
  label: "Show on the website",
  type: "checkbox",
  defaultValue: true,
  admin: { description: "Untick to keep this out of your next publish without deleting it." },
});

/*
 * #2829 W9r — the owner's order in the Business app (Website › Content). Not
 * shown in Studio; null until the collection is reordered, so entries keep
 * creation order (and stories/reviews keep newest first) until then.
 */
const sortField = (): Field => ({
  name: "sort_order",
  type: "number",
  min: 0,
  max: 10_000,
  admin: { hidden: true },
});

/** #2829 W9r — who saved this entry last (a Core user id; names come from Core). */
const updatedByField = (): Field => ({
  name: "updated_by",
  type: "text",
  maxLength: 64,
  admin: { hidden: true },
});

const CORE_USER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Core user behind a write: a Business member (signed by Core) or a Studio member. */
export function editorCoreUserId(user: unknown): string | null {
  if (!user || typeof user !== "object") return null;
  const record = user as { id?: unknown; core_user_id?: unknown };
  for (const value of [record.core_user_id, record.id]) {
    if (typeof value === "string" && CORE_USER_RE.test(value)) return value.toLowerCase();
  }
  return null;
}

const SYSTEM_STAMPS = ["updated_by", "confirmed_by", "confirmed_at", "drafted_by"] as const;

/**
 * Runs FIRST on every write: a caller never sets who edited or who confirmed
 * (Studio's form sends hidden fields back; the Business app's calls never
 * name them). The hooks after it write the real values.
 */
const stripSystemStamps: CollectionBeforeChangeHook = ({ data }) => {
  const next = { ...data };
  for (const key of SYSTEM_STAMPS) delete next[key];
  return next;
};

/*
 * #2829 W9b — "drafted by Ari from …": set once, when Ari's signed path
 * creates the entry (context flag raised only there); never by a caller.
 */
const draftedByField = (): Field => ({
  name: "drafted_by",
  label: "Drafted by",
  type: "select",
  options: ["ari"],
  admin: { readOnly: true, description: "Ari drafted this from the owner's own words or material." },
});

const stampAriDraft: CollectionBeforeChangeHook = ({ data, operation, originalDoc, req }) => {
  if (operation === "create" && req.context?.minglaAriDraft === true && req.context?.minglaSignedCore === true) {
    return { ...data, drafted_by: "ari" };
  }
  return originalDoc?.drafted_by === "ari" ? { ...data, drafted_by: "ari" } : data;
};

/** Stamps `updated_by` on every write. */
const stampEditor: CollectionBeforeChangeHook = ({ data, req }) => {
  const editor = editorCoreUserId(req.user);
  return editor ? { ...data, updated_by: editor } : data;
};

/*
 * A NEW access object per collection: the multi-tenant plugin wraps these
 * functions in place, so one shared object would be wrapped once per
 * collection and stack the tenant condition.
 */
const access = () => ({
  admin: ({ req }: { req: { user?: unknown } }) => Boolean(req.user),
  create: tenantWrite,
  read: tenantRead,
  update: tenantWrite,
  delete: tenantWrite,
  readVersions: tenantVersionRead,
  unlock: tenantWrite,
});

// #2829 — every entry belongs to the editor's own site (bindRequestTenant).
const sessionTenantOnly = bindRequestTenant;

/** One entry per address per site (checked on every write, the change applied first). */
function uniqueSlug(collection: "destinations" | "stories" | "categories"): CollectionBeforeChangeHook {
  return async ({ data, originalDoc, req }) => {
    const slug = typeof data.slug === "string" ? data.slug : originalDoc?.slug;
    if (typeof slug !== "string") return data;
    const tenant = requestTenant(req);
    const clash = await req.payload.find({
      collection,
      req,
      overrideAccess: req.context?.minglaSignedCore === true,
      draft: true,
      depth: 0,
      pagination: false,
      where: {
        and: [
          { tenant: { equals: tenant } },
          { slug: { equals: slug } },
          ...(originalDoc?.id ? [{ id: { not_equals: originalDoc.id } }] : []),
        ],
      },
    });
    if (clash.docs.length > 0) {
      throw new ValidationError({
        collection,
        errors: [{ path: "slug", message: "Another entry already uses this address. Choose a different one." }],
        req,
      });
    }
    return data;
  };
}

/**
 * Pictures must be this site's own ready media — every media field the
 * collection's schema declares (#2829: derived, never a hand list).
 */
function readyMedia(fields: () => Field[]): CollectionBeforeChangeHook {
  return async ({ data, originalDoc, req }) => {
    await assertReadyTenantMedia(req, [...collectMediaIds(fields(), { ...(originalDoc ?? {}), ...data })]);
    return data;
  };
}


export const Destinations: CollectionConfig = {
  slug: "destinations",
  labels: { singular: "Destination", plural: "Destinations" },
  admin: { useAsTitle: "title", hideAPIURL: true, defaultColumns: ["title", "slug", "country", "enabled", "updatedAt"] },
  access: access(),
  versions: { drafts: { autosave: false }, maxPerDoc: 50 },
  hooks: {
    beforeOperation: [enforceLiveStudioWrite],
    beforeChange: [
      sessionTenantOnly,
      stripSystemStamps,
      stampAriDraft,
      uniqueSlug("destinations"),
      readyMedia(() => Destinations.fields),
      stampEditor,
    ],
  },
  fields: [
    text("title", "Name", 120, true),
    slugField("Where this destination's page lives, under your destinations address — for example bali."),
    text("country", "Country", 80),
    tenantMedia("featured_image", "Main picture"),
    text("tagline", "Short line", 200),
    area("summary", "Summary", 600),
    {
      name: "facts",
      label: "Quick facts (in your words)",
      type: "group",
      fields: [
        text("language", "Language", 120),
        text("currency", "Currency", 120),
        text("religion", "Religion", 120),
        text("timezone", "Time zone", 120),
      ],
    },
    text("story_heading", "Heading over your story", 120),
    { name: "body", label: "Your story", type: "richText", editor: siteRichTextEditor() },
    {
      name: "seasons",
      label: "When to go",
      type: "array",
      maxRows: MAX_DESTINATION_SEASONS,
      fields: [
        text("heading", "Season", 120, true),
        area("body", "What it is like", 1000),
        { name: "activities", type: "array", maxRows: MAX_SEASON_ACTIVITIES, fields: [text("text", "Activity", 120, true)] },
        tenantMedia("image", "Picture"),
      ],
    },
    { name: "did_you_know", label: "Did you know?", type: "array", maxRows: MAX_DID_YOU_KNOW, fields: [area("text", "Fact", 400, true)] },
    {
      name: "related_offerings",
      label: "Trips here (from Mingla)",
      type: "array",
      maxRows: MAX_RELATED_OFFERINGS,
      admin: { description: "Mingla trips to list on this page. A trip that is no longer public simply stops showing." },
      fields: [offeringId()],
    },
    { name: "gallery", label: "Gallery", type: "array", maxRows: MAX_COLLECTION_GALLERY, fields: [tenantMedia("media", "Picture", true), text("alt", "Describe the picture", 240)] },
    seoGroup(),
    enabledField(),
    sortField(),
    updatedByField(),
    draftedByField(),
  ],
};

export const Categories: CollectionConfig = {
  slug: "categories",
  labels: { singular: "Story category", plural: "Story categories" },
  admin: { useAsTitle: "title", hideAPIURL: true },
  access: access(),
  versions: { drafts: { autosave: false }, maxPerDoc: 50 },
  hooks: { beforeOperation: [enforceLiveStudioWrite], beforeChange: [sessionTenantOnly, stripSystemStamps, uniqueSlug("categories"), stampEditor] },
  fields: [text("title", "Name", 80, true), slugField("A short address word for this category."), sortField(), updatedByField()],
};

export const Stories: CollectionConfig = {
  slug: "stories",
  labels: { singular: "Story", plural: "Stories" },
  admin: { useAsTitle: "title", hideAPIURL: true, defaultColumns: ["title", "slug", "published_at", "enabled", "updatedAt"] },
  access: access(),
  versions: { drafts: { autosave: false }, maxPerDoc: 50 },
  hooks: {
    beforeOperation: [enforceLiveStudioWrite],
    beforeChange: [sessionTenantOnly, stripSystemStamps, stampAriDraft, uniqueSlug("stories"), readyMedia(() => Stories.fields), stampEditor],
  },
  fields: [
    text("title", "Title", 160, true),
    slugField("Where this story lives on your site — for example our-first-trip."),
    {
      name: "published_at",
      label: "Date",
      type: "date",
      required: true,
      admin: { date: { pickerAppearance: "dayOnly", displayFormat: "d MMM yyyy" } },
    },
    {
      name: "category",
      type: "relationship",
      relationTo: "categories",
      filterOptions: ({ req }) => {
        const tenantId = (req.user as { tenantId?: string })?.tenantId;
        return tenantId ? { tenant: { equals: tenantId } } : false;
      },
    },
    tenantMedia("featured_image", "Main picture"),
    area("excerpt", "Short summary", 400),
    { name: "content", label: "Story", type: "richText", required: true, editor: siteRichTextEditor() },
    seoGroup(),
    enabledField(),
    sortField(),
    updatedByField(),
    draftedByField(),
  ],
};

/*
 * #2829 — "confirmed as real" can be set only by a brand admin or owner
 * (rank 50, §37 answer 2): in Studio, or from the Business app's confirm box,
 * whose Core-signed call raises `minglaConfirmReview` after Core checked the
 * rank. Every other Core-signed call (the path Ari's tools use) is refused.
 * An unconfirmed review is never published.
 */
export const confirmedRealAccess: FieldAccess = ({ req }) => {
  const rank = (req.user as { rank?: unknown } | null | undefined)?.rank;
  const admin = typeof rank === "number" && rank >= 50;
  if (req.context?.minglaSignedCore === true) return req.context?.minglaConfirmReview === true && admin;
  return Boolean(req.user) && admin;
};

/*
 * #2829 W9r — Mingla records who confirmed a review and when; unconfirming
 * clears that and hides the review; an unconfirmed review is never shown.
 */
export const reviewConfirmation: CollectionBeforeChangeHook = ({ data, originalDoc, req }) => {
  const confirmed = data.confirmed_real ?? originalDoc?.confirmed_real ?? false;
  const wasConfirmed = originalDoc?.confirmed_real === true;
  const next: Record<string, unknown> = { ...data };
  if (confirmed === true && !wasConfirmed) {
    next.confirmed_by = editorCoreUserId(req.user);
    next.confirmed_at = new Date().toISOString();
  } else if (confirmed !== true) {
    next.confirmed_by = null;
    next.confirmed_at = null;
    next.enabled = false;
  }
  return next;
};

export const Testimonials: CollectionConfig = {
  slug: "testimonials",
  labels: { singular: "Review", plural: "Reviews" },
  admin: { useAsTitle: "reviewer", hideAPIURL: true, defaultColumns: ["reviewer", "review_date", "trip_name", "confirmed_real", "enabled"] },
  access: access(),
  versions: { drafts: { autosave: false }, maxPerDoc: 50 },
  hooks: { beforeOperation: [enforceLiveStudioWrite], beforeChange: [sessionTenantOnly, stripSystemStamps, stampAriDraft, reviewConfirmation, stampEditor] },
  fields: [
    area("quote", "Review, word for word", MAX_TESTIMONIAL_QUOTE, true, "Copy it exactly, typos included. Do not shorten it or join two reviews."),
    text("reviewer", "Reviewer", 80, true, "Exactly as they are shown where they left the review."),
    {
      name: "review_date",
      label: "Date written",
      type: "date",
      required: true,
      admin: { date: { pickerAppearance: "dayOnly", displayFormat: "d MMM yyyy" } },
    },
    text("trip_name", "Trip", 120, false, "Which trip they were on, if you know."),
    {
      name: "related_offering",
      label: "Mingla trip id (optional)",
      type: "text",
      validate: (value: unknown) => (value == null || value === "" || (typeof value === "string" && UUID_RE.test(value)) ? true : "Paste the Mingla id."),
    },
    area("source_note", "Where this review comes from", 500, true, "For your records only, never shown — for example “WeTravel profile, copied March 2026”."),
    {
      name: "confirmed_real",
      label: "I confirm this is a real review from a real traveller",
      type: "checkbox",
      defaultValue: false,
      access: { create: confirmedRealAccess, update: confirmedRealAccess },
      admin: { description: "Reviews are published only once confirmed. Only a brand admin or the owner can confirm." },
    },
    {
      name: "confirmed_by",
      type: "text",
      maxLength: 64,
      admin: { hidden: true },
    },
    {
      name: "confirmed_at",
      type: "date",
      admin: { hidden: true },
    },
    // #2829 W9r — a new review starts hidden (it can't show until confirmed).
    { ...enabledField(), defaultValue: false } as Field,
    sortField(),
    updatedByField(),
    draftedByField(),
  ],
};

export const SITE_CONTENT_COLLECTIONS: CollectionConfig[] = [Destinations, Categories, Stories, Testimonials];
