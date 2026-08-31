import type { Block, Field } from "payload";
import {
  BoldFeature,
  HeadingFeature,
  ItalicFeature,
  LinkFeature,
  OrderedListFeature,
  ParagraphFeature,
  UnorderedListFeature,
  lexicalEditor,
} from "@payloadcms/richtext-lexical";
import { safeText, safeUrl } from "../lib/validation";

const short = (
  name: string,
  label: string,
  required = false,
  max = 200,
): Field => ({
  name,
  label,
  type: "text",
  required,
  maxLength: max,
  validate: (value: unknown) =>
    value == null && !required ? true : safeText(value, max),
});
const link = (name = "href", label = "Link", required = true): Field => ({
  name,
  label,
  type: "text",
  required,
  maxLength: 2048,
  validate: safeUrl,
});
const readyMedia = (name = "media", label = "Image"): Field => ({
  name,
  label,
  type: "relationship",
  relationTo: "media",
  required: true,
  filterOptions: ({ req }) => {
    const tenantId = (req.user as { tenantId?: string })?.tenantId;
    return tenantId
      ? { tenant: { equals: tenantId }, state: { equals: "READY" } }
      : false;
  },
});
const accessibleAlt = (): Field => ({
  name: "alt",
  label: "Alternative text",
  type: "text",
  required: false,
  maxLength: 240,
  validate: (value: unknown) =>
    value == null ? true : safeText(value, 240),
  admin: {
    description:
      "Describe meaningful images. Leave empty only when the image is decorative.",
  },
});
const ctaFields: Field[] = [short("label", "Label", true, 80), link()];

export const restaurantBlocks: Block[] = [
  {
    slug: "hero",
    labels: { singular: "Hero", plural: "Heroes" },
    fields: [
      short("heading", "Heading", true, 120),
      short("subheading", "Subheading", false, 300),
      readyMedia(),
      { name: "ctas", type: "array", maxRows: 2, fields: ctaFields },
    ],
  },
  {
    slug: "rich_text",
    labels: { singular: "Rich text", plural: "Rich text" },
    fields: [
      short("heading", "Heading", false, 120),
      {
        name: "content",
        type: "richText",
        required: true,
        editor: lexicalEditor({
          features: () => [
            ParagraphFeature(),
            HeadingFeature({ enabledHeadingSizes: ["h2", "h3", "h4"] }),
            BoldFeature(),
            ItalicFeature(),
            OrderedListFeature(),
            UnorderedListFeature(),
            LinkFeature({ enabledCollections: [] }),
          ],
        }),
      },
    ],
  },
  {
    slug: "media_feature",
    labels: { singular: "Image feature", plural: "Image features" },
    fields: [
      readyMedia(),
      accessibleAlt(),
      short("heading", "Heading", false, 120),
      short("caption", "Caption", false, 500),
      {
        name: "alignment",
        type: "select",
        required: true,
        defaultValue: "left",
        options: ["left", "right"],
      },
    ],
  },
  {
    slug: "cta",
    labels: { singular: "Call to action", plural: "Calls to action" },
    fields: [
      short("heading", "Heading", true, 120),
      short("body", "Body", false, 500),
      ...ctaFields,
    ],
  },
  {
    slug: "offering_grid",
    labels: { singular: "Mingla experiences", plural: "Mingla experiences" },
    fields: [
      short("heading", "Heading", false, 120),
      {
        name: "offering_ids",
        label: "Mingla offering IDs",
        type: "array",
        minRows: 1,
        maxRows: 12,
        required: true,
        fields: [short("offering_id", "Offering ID", true, 80)],
      },
    ],
  },
  {
    slug: "venue_reservation",
    labels: { singular: "Reservation", plural: "Reservations" },
    fields: [
      short("heading", "Heading", true, 120),
      short("body", "Body", false, 500),
      short("reservation_target_id", "Mingla reservation target ID", true, 80),
    ],
  },
  {
    slug: "menu_link",
    labels: { singular: "Menu link", plural: "Menu links" },
    fields: [
      short("heading", "Heading", false, 120),
      short("label", "Label", true, 80),
      link(),
    ],
  },
  {
    slug: "gallery",
    labels: { singular: "Gallery", plural: "Galleries" },
    fields: [
      short("heading", "Heading", false, 120),
      {
        name: "images",
        type: "array",
        minRows: 1,
        maxRows: 12,
        required: true,
        fields: [readyMedia(), accessibleAlt()],
      },
    ],
  },
  {
    slug: "hours_location",
    labels: { singular: "Hours and location", plural: "Hours and locations" },
    fields: [
      short("heading", "Heading", false, 120),
      short("address", "Address", true, 300),
      link("map_url", "Map link", false),
      {
        name: "hours",
        type: "array",
        minRows: 1,
        maxRows: 7,
        fields: [
          short("day", "Day", true, 20),
          short("value", "Hours", true, 80),
        ],
      },
    ],
  },
  {
    slug: "testimonials",
    labels: { singular: "Testimonials", plural: "Testimonials" },
    fields: [
      short("heading", "Heading", false, 120),
      {
        name: "items",
        type: "array",
        minRows: 1,
        maxRows: 8,
        fields: [
          short("name", "Name", true, 120),
          short("quote", "Quote", true, 500),
        ],
      },
    ],
  },
  {
    slug: "faq",
    labels: { singular: "Questions", plural: "Questions" },
    fields: [
      short("heading", "Heading", false, 120),
      {
        name: "items",
        type: "array",
        minRows: 1,
        maxRows: 12,
        fields: [
          short("question", "Question", true, 240),
          short("answer", "Answer", true, 1000),
        ],
      },
    ],
  },
  {
    slug: "contact_handoff",
    labels: { singular: "Contact", plural: "Contact" },
    fields: [
      short("heading", "Heading", true, 120),
      short("body", "Body", false, 500),
      short("label", "Label", true, 80),
      link(),
    ],
  },
  {
    slug: "divider",
    labels: { singular: "Divider", plural: "Dividers" },
    fields: [],
  },
  {
    slug: "spacer",
    labels: { singular: "Spacing", plural: "Spacing" },
    fields: [
      {
        name: "size",
        type: "select",
        required: true,
        defaultValue: "medium",
        options: ["small", "medium", "large"],
      },
    ],
  },
];

export const allowedBlockSlugs = restaurantBlocks.map((block) => block.slug);
