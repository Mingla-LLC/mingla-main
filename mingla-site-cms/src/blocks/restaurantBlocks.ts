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

/*
 * #3149 — `description` is built HERE rather than spread onto the result.
 *
 * `{ ...short(...), admin }` widens the returned value to the whole Payload
 * `Field` union and stops type-checking: TypeScript can no longer tell which
 * member it is, and every field in the file starts resolving as a
 * `collapsible`. Building it inside keeps the literal contextually typed.
 */
const short = (
  name: string,
  label: string,
  required = false,
  max = 200,
  description?: string,
): Field => ({
  name,
  label,
  type: "text",
  required,
  maxLength: max,
  validate: (value: unknown) =>
    value == null && !required ? true : safeText(value, max),
  admin: description ? { description } : undefined,
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
/*
 * #3149 — the small line above a heading, in the brand's own words.
 *
 * The published website used to print a fixed word here — "Gallery", "Film",
 * "Team" — because a block had nowhere to carry the brand's own. That is
 * Mingla writing copy for a restaurant on the restaurant's own website. This
 * is the field that makes it theirs, and leaving it empty now means the line
 * simply is not printed.
 */
const eyebrow = (): Field =>
  short(
    "eyebrow",
    "Eyebrow",
    false,
    60,
    "Optional. The small line printed above this section\u2019s heading, in your words \u2014 for example \u201cThe place\u201d above \u201cCome as you are\u201d. Leave it empty and no line is printed.",
  );

const ctaFields: Field[] = [short("label", "Label", true, 80), link()];

export const restaurantBlocks: Block[] = [
  {
    slug: "hero",
    labels: { singular: "Hero", plural: "Heroes" },
    fields: [
      short("heading", "Heading", true, 120),
      short("subheading", "Subheading", false, 300),
      // The still image. REQUIRED even when a video is chosen: it is the
      // poster, and it is what a visitor sees on a slow connection, with data
      // saver on, or when they have asked for reduced motion.
      readyMedia(),
      {
        name: "video",
        label: "Background video",
        type: "relationship",
        relationTo: "media",
        required: false,
        filterOptions: ({ req }) => {
          const tenantId = (req.user as { tenantId?: string })?.tenantId;
          return tenantId
            ? {
              tenant: { equals: tenantId },
              state: { equals: "READY" },
              detected_mime: { equals: "video/mp4" },
            }
            : false;
        },
        admin: {
          description:
            "Optional. Plays silently behind the heading. The image above is still required — it shows first, and it is what people who ask for reduced motion see.",
        },
      },
      { name: "ctas", type: "array", maxRows: 2, fields: ctaFields },
    ],
  },
  {
    slug: "rich_text",
    labels: { singular: "Rich text", plural: "Rich text" },
    fields: [
      eyebrow(),
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
      eyebrow(),
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
      eyebrow(),
      short("heading", "Heading", true, 120),
      short("body", "Body", false, 500),
      ...ctaFields,
    ],
  },
  {
    slug: "offering_grid",
    labels: { singular: "Mingla experiences", plural: "Mingla experiences" },
    fields: [
      eyebrow(),
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
      eyebrow(),
      short("heading", "Heading", true, 120),
      short("body", "Body", false, 500),
      short("reservation_target_id", "Mingla reservation target ID", true, 80),
    ],
  },
  {
    slug: "menu_link",
    labels: { singular: "Menu link", plural: "Menu links" },
    fields: [
      eyebrow(),
      short("heading", "Heading", false, 120),
      short("label", "Label", true, 80),
      link(),
    ],
  },
  {
    /*
     * #2830 — the real menu.
     *
     * DELIBERATELY HOLDS NO ITEMS. Mingla owns menus and prices; #2829 is
     * explicit that it stays the authority for them. If a brand could type
     * items here, the website and the app would drift and a customer would
     * read one price on the site and pay another in the app. So this block
     * carries only presentation, and the items are projected from Mingla at
     * publish time.
     */
    slug: "menu_board",
    labels: { singular: "Menu", plural: "Menus" },
    fields: [
      eyebrow(),
      short("heading", "Heading", false, 120),
      {
        name: "note",
        label: "Note",
        type: "text",
        required: false,
        maxLength: 300,
        validate: (value: unknown) =>
          value == null ? true : safeText(value, 300),
        admin: {
          description:
            "Optional line above the menu, for example service times. Items and prices come from your Mingla menu.",
        },
      } satisfies Field,
    ],
  },
  {
    slug: "video_feature",
    labels: { singular: "Video", plural: "Videos" },
    fields: [
      eyebrow(),
      /*
       * #3149 — several videos in a row are published as ONE grid of films,
       * not as a stack of full-width sections. This titles that grid, and it
       * is read off the FIRST video in the run.
       */
      short(
        "group_heading",
        "Group heading",
        false,
        120,
        "Optional, and only used on the FIRST of several videos placed one after another \u2014 they are shown together as a grid, and this is the heading printed above that grid. Leave it empty and the grid is printed with no heading.",
      ),
      short("heading", "Heading", false, 120),
      short("caption", "Caption", false, 600),
      {
        name: "video",
        label: "Video",
        type: "relationship",
        relationTo: "media",
        required: true,
        filterOptions: ({ req }) => {
          const tenantId = (req.user as { tenantId?: string })?.tenantId;
          return tenantId
            ? {
              tenant: { equals: tenantId },
              state: { equals: "READY" },
              detected_mime: { equals: "video/mp4" },
            }
            : false;
        },
      },
      // Required, like the hero's: a video that has not arrived must still
      // leave something on the page.
      { ...readyMedia("poster", "Poster image") },
    ],
  },
  {
    slug: "team",
    labels: { singular: "Team", plural: "Teams" },
    fields: [
      eyebrow(),
      short("heading", "Heading", false, 120),
      short("caption", "Caption", false, 600),
      {
        name: "members",
        type: "array",
        minRows: 1,
        maxRows: 24,
        fields: [
          short("name", "Name", true, 80),
          short("role", "Role", false, 80),
          // Optional on purpose: a person can be published by name alone.
          {
            name: "media",
            label: "Portrait",
            type: "relationship",
            relationTo: "media",
            required: false,
            filterOptions: ({ req }) => {
              const tenantId = (req.user as { tenantId?: string })?.tenantId;
              return tenantId
                ? { tenant: { equals: tenantId }, state: { equals: "READY" } }
                : false;
            },
          },
          accessibleAlt(),
        ],
      },
    ],
  },
  {
    slug: "gallery",
    labels: { singular: "Gallery", plural: "Galleries" },
    fields: [
      eyebrow(),
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
      eyebrow(),
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
      eyebrow(),
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
      eyebrow(),
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
      eyebrow(),
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
