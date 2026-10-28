import {
  ValidationError,
  type CollectionBeforeChangeHook,
  type CollectionBeforeDeleteHook,
  type CollectionConfig,
} from "payload";
import { siteBlocks } from "../blocks/siteBlocks";
import {
  enforceLiveStudioWrite,
  tenantRead,
  tenantVersionRead,
  tenantWrite,
} from "../lib/access";
import { safeText } from "../lib/validation";
import { assertReadyTenantMedia, bindRequestTenant, requestTenant } from "../lib/tenantIntegrity";
import { collectMediaIds } from "../lib/mediaFields";
import { assertHeroVideoLengths } from "../lib/videoRules";
import { findAllTenantPages } from "../lib/tenantPages";
import { pageTreePaths, relationId, treePageOf, type TreeProblem } from "../lib/pageTree";
import {
  MAX_BLOCKS_PER_PAGE,
  MAX_PAGE_TITLE_LENGTH,
  MAX_SLUG_LENGTH,
} from "../contracts/generated/limits.ts";
import { COLLECTION_KINDS, SLUG_PATTERN } from "../contracts/generated/routes.ts";

/*
 * #2829 AD-5 — pages are a tree with owner-chosen addresses.
 *
 * The six fixed restaurant roles are gone: a page has a free slug, an optional
 * parent (at most three levels deep), and a kind. The whole tenant's tree is
 * re-checked on every write — the change applied in memory first — so no edit
 * can leave two pages at one address, a parent loop, a page four levels deep,
 * or a second home page. Refusals are VALIDATION_FAILED, before anything is
 * stored.
 */
const enforcePage: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  const tenantId = requestTenant(req);
  if (
    operation === "update" &&
    Number(data.revision) !== Number(originalDoc?.revision)
  )
    throw new Error("REVISION_CONFLICT");
  const merged = { ...(originalDoc ?? {}), ...data } as Record<string, unknown>;
  const slug = typeof merged.slug === "string" ? merged.slug.trim() : "";
  const kind = merged.kind === "collection_index" ? "collection_index" : "standard";
  const others = (await findAllTenantPages(req, tenantId, {
    overrideAccess: req.context?.minglaSignedCore === true,
  })).filter((page) => !originalDoc?.id || String(page.id) !== String(originalDoc.id));
  const selfId = originalDoc?.id ? String(originalDoc.id) : "__new__";
  const tree = pageTreePaths([
    ...others.map((page) => treePageOf(page)),
    {
      id: selfId,
      slug: slug === "" ? null : slug,
      parent: relationId(merged.parent),
      kind,
      collection: merged.collection_kind,
    },
  ], { requireHome: false });
  if (!tree.ok) {
    // A field-level refusal Studio shows beside the field (HTTP 400), in
    // plain words, instead of a bare 500.
    throw new ValidationError({
      collection: "pages",
      errors: [TREE_PROBLEM_COPY[tree.problem]],
      req,
    });
  }
  const blocks = Array.isArray(data.blocks) ? data.blocks : originalDoc?.blocks ?? [];
  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") throw new Error("VALIDATION_FAILED");
  }
  // #2829 — every media field the page schema declares (hero video, film
  // video and poster, team portraits, gallery, SEO image…) must be this
  // site's own ready media; a hand list let new fields through unchecked.
  const mediaValues = [...collectMediaIds(Pages.fields, { ...merged, blocks })];
  await assertReadyTenantMedia(req, mediaValues);
  // #2829 W6 — a hero background video is at most 15 seconds (plain reason).
  await assertHeroVideoLengths(req, blocks);
  const isHome = slug === "";
  return {
    ...data,
    slug,
    kind,
    collection_kind: kind === "collection_index" ? merged.collection_kind : null,
    parent: isHome ? null : merged.parent ?? null,
    // The home page is always on; a site must have one.
    enabled: isHome ? true : data.enabled,
    revision: operation === "create" ? 1 : Number(originalDoc.revision) + 1,
  };
};

const TREE_PROBLEM_COPY: Record<TreeProblem, { path: string; message: string }> = {
  PAGE_LIMIT_EXCEEDED: { path: "slug", message: "A website can have up to 100 pages." },
  HOME_MISSING: { path: "slug", message: "Your website needs a home page (a page with no address)." },
  HOME_DUPLICATE: { path: "slug", message: "Only your home page can have an empty address. Give this page an address." },
  HOME_HAS_PARENT: { path: "parent", message: "Your home page can't sit under another page." },
  SLUG_INVALID: { path: "slug", message: "Use lowercase letters, numbers and single hyphens, for example our-story." },
  SLUG_RESERVED: { path: "slug", message: "That address is used by Mingla. Choose another one." },
  PARENT_MISSING: { path: "parent", message: "Choose a parent page from this website." },
  PARENT_IS_HOME: { path: "parent", message: "Pages can't sit under the home page. Leave the parent empty instead." },
  PARENT_CYCLE: { path: "parent", message: "A page can't sit under itself or one of its own sub-pages." },
  DEPTH_EXCEEDED: { path: "parent", message: "Pages can be at most three levels deep." },
  SLUG_DUPLICATE: { path: "slug", message: "Another page already uses this address. Choose a different one." },
  COLLECTION_INVALID: { path: "collection_kind", message: "Choose what this page lists." },
};

/*
 * The home page cannot be deleted, and neither can a page that still has
 * pages under it (its children would lose their address).
 */
const protectPage: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const page = await req.payload.findByID({
    collection: "pages",
    id,
    overrideAccess: false,
    req,
    depth: 0,
  });
  if (!page.slug) throw new Error("INVALID_STATE");
  const children = await findAllTenantPages(req, requestTenant(req), {
    where: { parent: { equals: id } },
  });
  if (children.length > 0) throw new Error("INVALID_STATE");
};

function slugField(value: unknown): true | string {
  if (value == null || value === "") return true; // the home page
  if (typeof value !== "string" || value.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(value)) {
    return "Use lowercase letters, numbers and single hyphens, for example our-story.";
  }
  return true;
}

export const Pages: CollectionConfig = {
  slug: "pages",
  labels: { singular: "Page", plural: "Pages" },
  admin: {
    useAsTitle: "title",
    hideAPIURL: true,
    defaultColumns: ["title", "slug", "parent", "kind", "enabled", "updatedAt"],
  },
  access: {
    admin: ({ req }) => Boolean(req.user),
    create: tenantWrite,
    read: tenantRead,
    update: tenantWrite,
    delete: tenantWrite,
    readVersions: tenantVersionRead,
    unlock: tenantWrite,
  },
  versions: { drafts: { autosave: false }, maxPerDoc: 50 },
  hooks: {
    beforeOperation: [enforceLiveStudioWrite],
    beforeChange: [enforcePage, bindRequestTenant],
    beforeDelete: [protectPage],
  },
  fields: [
    {
      name: "title",
      type: "text",
      required: true,
      maxLength: MAX_PAGE_TITLE_LENGTH,
      validate: (value: unknown) => safeText(value, MAX_PAGE_TITLE_LENGTH),
    },
    {
      name: "slug",
      type: "text",
      maxLength: MAX_SLUG_LENGTH,
      validate: slugField,
      admin: {
        description:
          "The page's address, for example our-story. Leave empty only for your home page.",
      },
    },
    {
      name: "parent",
      type: "relationship",
      relationTo: "pages",
      admin: {
        description: "Put this page under another page (up to three levels deep).",
      },
      filterOptions: ({ req, id }) => {
        const tenantId = (req.user as { tenantId?: string })?.tenantId;
        if (!tenantId) return false;
        return {
          tenant: { equals: tenantId },
          ...(id ? { id: { not_equals: id } } : {}),
        };
      },
    },
    {
      name: "kind",
      type: "select",
      required: true,
      defaultValue: "standard",
      options: [
        { label: "Standard page", value: "standard" },
        { label: "List of trips, events, experiences, destinations or stories", value: "collection_index" },
      ],
    },
    {
      name: "collection_kind",
      type: "select",
      options: COLLECTION_KINDS.map((value) => ({
        label: value[0]!.toUpperCase() + value.slice(1),
        value,
      })),
      admin: { condition: (data) => data?.kind === "collection_index" },
      validate: (value: unknown, { siblingData }: { siblingData: Record<string, unknown> }) =>
        siblingData?.kind !== "collection_index" || (COLLECTION_KINDS as readonly unknown[]).includes(value)
          ? true
          : "Choose what this page lists.",
    },
    {
      name: "planned_offering",
      type: "select",
      options: [
        { label: "Trips", value: "trips" },
        { label: "Events", value: "events" },
        { label: "Experiences", value: "experiences" },
      ],
      admin: {
        description: "What this page is for, so it can show an honest empty state until it has content.",
      },
    },
    { name: "enabled", type: "checkbox", defaultValue: true },
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
      blocks: siteBlocks,
      minRows: 0,
      maxRows: MAX_BLOCKS_PER_PAGE,
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
          // Spec says 160; kept at the existing 170 so no published page's
          // description becomes unsaveable (#2829 W2 decision).
          maxLength: 170,
          validate: (value: unknown) => (value == null ? true : safeText(value, 170)),
        },
        {
          name: "image",
          type: "relationship",
          relationTo: "media",
          filterOptions: ({ req }) => {
            const tenantId = (req.user as { tenantId?: string })?.tenantId;
            return tenantId ? { tenant: { equals: tenantId }, state: { equals: "READY" } } : false;
          },
        },
        { name: "noindex", type: "checkbox", defaultValue: false },
      ],
    },
  ],
};
