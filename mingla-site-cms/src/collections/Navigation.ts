import type { CollectionConfig, Field } from "payload";
import {
  enforceLiveStudioWrite,
  tenantRead,
  tenantVersionRead,
  tenantWrite,
} from "../lib/access";
import { assertTenantPages, bindRequestTenant, singletonPerTenant } from "../lib/tenantIntegrity";
import { safeText } from "../lib/validation";
import {
  MAX_NAV_CHILDREN,
  MAX_NAV_ITEMS,
  MAX_NAV_LABEL_LENGTH,
} from "../contracts/generated/limits.ts";

/*
 * #2829 W2 — the header menu: up to eight items, each pointing at one of the
 * site's pages (a collection list is a page too) or a secure external link,
 * each with up to eight dropdown children of the same shape (no grandchild).
 * Plus an optional header button and a text wordmark shown when there is no
 * logo. The logo itself stays in Site settings (one owner).
 */
function secureExternalUrl(value: unknown): true | string {
  if (value == null || value === "") return true;
  if (typeof value !== "string" || value.length > 2048) return "Enter a secure web link.";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? true
      : "Only secure (https) web links are allowed.";
  } catch {
    return "Enter a secure web link.";
  }
}

const targetFields: Field[] = [
  {
    name: "label",
    type: "text",
    required: true,
    maxLength: MAX_NAV_LABEL_LENGTH,
    validate: (value: unknown) => safeText(value, MAX_NAV_LABEL_LENGTH),
  },
  {
    name: "target_type",
    type: "select",
    required: true,
    defaultValue: "page",
    options: [
      { label: "A page on this site", value: "page" },
      { label: "Another website", value: "url" },
    ],
  },
  {
    name: "page",
    type: "relationship",
    relationTo: "pages",
    admin: { condition: (_data, sibling) => sibling?.target_type !== "url" },
    filterOptions: ({ req }) => {
      const tenantId = (req.user as { tenantId?: string })?.tenantId;
      return tenantId ? { tenant: { equals: tenantId } } : false;
    },
    validate: (value: unknown, { siblingData }: { siblingData: Record<string, unknown> }) =>
      siblingData?.target_type === "url" || (value != null && value !== "")
        ? true
        : "Choose a page.",
  },
  {
    name: "url",
    type: "text",
    maxLength: 2048,
    admin: { condition: (_data, sibling) => sibling?.target_type === "url" },
    validate: (value: unknown, { siblingData }: { siblingData: Record<string, unknown> }) =>
      siblingData?.target_type !== "url"
        ? true
        : value == null || value === ""
          ? "Enter a secure web link."
          : secureExternalUrl(value),
  },
];

type NavRow = { target_type?: unknown; page?: unknown; children?: NavRow[] };

export function navigationPageRefs(data: Record<string, unknown>): unknown[] {
  const refs: unknown[] = [];
  const visit = (row: NavRow | undefined) => {
    if (row && row.target_type !== "url" && row.page) refs.push(row.page);
  };
  for (const item of (data.items as NavRow[] | undefined) ?? []) {
    visit(item);
    for (const child of item.children ?? []) visit(child);
  }
  visit(data.header_cta as NavRow | undefined);
  return refs;
}

export const Navigation: CollectionConfig = {
  slug: "navigation",
  labels: { singular: "Navigation", plural: "Navigation" },
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
    beforeChange: [
      singletonPerTenant("navigation"),
      async ({ data, originalDoc, req }) => {
        // Every linked page must be one of THIS site's pages.
        await assertTenantPages(
          req,
          navigationPageRefs({ ...(originalDoc ?? {}), ...data }),
        );
        return data;
      },
      bindRequestTenant,
    ],
  },
  fields: [
    {
      name: "label",
      type: "text",
      defaultValue: "Main navigation",
      admin: { readOnly: true },
    },
    {
      name: "items",
      type: "array",
      maxRows: MAX_NAV_ITEMS,
      fields: [
        ...targetFields,
        {
          name: "children",
          type: "array",
          maxRows: MAX_NAV_CHILDREN,
          fields: targetFields,
        },
      ],
    },
    {
      name: "header_cta",
      label: "Header button",
      type: "group",
      fields: [
        {
          name: "label",
          type: "text",
          maxLength: MAX_NAV_LABEL_LENGTH,
          validate: (value: unknown) =>
            value == null || value === "" ? true : safeText(value, MAX_NAV_LABEL_LENGTH),
        },
        { ...targetFields[1]!, required: false } as Field,
        {
          name: "page",
          type: "relationship",
          relationTo: "pages",
          admin: { condition: (_data, sibling) => sibling?.target_type !== "url" },
          filterOptions: ({ req }) => {
            const tenantId = (req.user as { tenantId?: string })?.tenantId;
            return tenantId ? { tenant: { equals: tenantId } } : false;
          },
        },
        {
          name: "url",
          type: "text",
          maxLength: 2048,
          admin: { condition: (_data, sibling) => sibling?.target_type === "url" },
          validate: secureExternalUrl,
        },
      ],
    },
    {
      name: "wordmark",
      type: "text",
      maxLength: 60,
      admin: { description: "Text shown in the header when you have no logo." },
      validate: (value: unknown) => (value == null || value === "" ? true : safeText(value, 60)),
    },
  ],
};
