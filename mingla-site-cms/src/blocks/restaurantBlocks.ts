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
import { safeText, safeTimeZone, safeUrl } from "../lib/validation";
import { statsIconOptions } from "../lib/statsIcons";

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

/*
 * #3149 wave 4 — an OPTIONAL button, offered on four blocks that had no way to
 * point anywhere: under a team grid, under a run of films, beside a menu
 * taster, and at the foot of a story.
 *
 * Both halves are optional and the site prints the control only when BOTH are
 * filled in. A label with no destination is a word that does nothing; a
 * destination with no label is a link a screen reader cannot announce.
 */
const optionalCta = (
  what: string,
  where: string,
): Field[] => [
  short(
    "cta_label",
    "Button label",
    false,
    80,
    `Optional. The words on the button ${where} — for example \u201c${what}\u201d. Leave both this and the link empty and no button is shown.`,
  ),
  link("cta_href", "Button link", false),
];

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
      /*
       * #3149 wave 4 — the STORY shape. An image feature is what a page uses
       * to tell people what the place is, and everything below is what that
       * section needs to stop reading like a caption under a photograph:
       * a round crop, a badge on it, the line worth quoting, and a way on.
       *
       * Every one is optional, and with all of them empty this block saves and
       * publishes exactly what it always did.
       */
      {
        name: "media_shape",
        label: "Picture shape",
        type: "select",
        required: false,
        options: [
          { value: "rectangle", label: "Rectangle — the usual" },
          { value: "circle", label: "Circle — cropped round" },
        ],
        admin: {
          description:
            "Optional. A round crop suits a portrait or a single dish; leave it empty for the usual rectangle.",
        },
      } satisfies Field,
      short(
        "badge_figure",
        "Badge — big line",
        false,
        24,
        "Optional. A short badge printed on the picture, for example \u201c24/7\u201d. Leave it empty and no badge is shown.",
      ),
      short(
        "badge_label",
        "Badge — small line",
        false,
        40,
        "Optional. The line under the badge\u2019s big one, for example \u201cALWAYS ON\u201d. Shown only when the big line is filled in.",
      ),
      short(
        "quote",
        "Quote",
        false,
        600,
        "Optional. A line worth pulling out, printed large against a gold bar inside this section.",
      ),
      short(
        "quote_attribution",
        "Who said it",
        false,
        120,
        "Optional \u2014 for example \u201cg\u00f6gi, on Instagram\u201d. Leave it empty and the quote stands on its own.",
      ),
      ...optionalCta("More about us", "at the foot of this section"),
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
      /*
       * #3149 wave 4 — NO FIELD FOR THE DESTINATION, deliberately.
       *
       * This block used to demand a "Mingla reservation target ID", which
       * could never resolve: the builder only ever asked Mingla about the ids
       * on `offering_grid` blocks, and the commercial projection returns
       * events, never a reservation target. Every page carrying this block
       * failed to publish, with VALIDATION_FAILED and nothing naming the
       * cause. That is a switch with nothing on the other end, and it is
       * removed rather than papered over.
       *
       * The link is now DERIVED from the brand at publish time — Mingla's own
       * booking page for this brand — so there is nothing to type, nothing to
       * keep in step, and no way to point a "Book a table" button at a
       * stranger.
       */
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
    /*
     * #3149 wave 4 — A TASTE OF THE MENU, AND A BLOCK OF ITS OWN.
     *
     * `menu_board` above is THE menu: every section, with ordering. This is
     * the handful of dishes a home page shows beside a few photographs, with a
     * button through to that page.
     *
     * It could have been three more settings on `menu_board`. It deliberately
     * is not: that block is pinned to presentation-only, and "the menu" and "a
     * taste of the menu" are two different pieces of a restaurant's page
     * rather than one piece with a mode.
     *
     * LIKE `menu_board`, IT HOLDS NO ITEMS. The dishes and prices are
     * projected from Mingla at publish time and merely shortened here, so the
     * website and the app cannot drift into quoting different prices.
     */
    slug: "menu_preview",
    labels: { singular: "Menu taster", plural: "Menu tasters" },
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
            "Optional line under the heading, for example the range of prices. The dishes themselves come from your Mingla menu.",
        },
      } satisfies Field,
      {
        name: "section_limit",
        label: "Show only this many sections",
        type: "number",
        required: false,
        min: 1,
        max: 6,
        admin: {
          description:
            "Optional. Leave it empty to show every section of your Mingla menu here — which is usually the whole menu, and probably not what a taster is for.",
        },
      } satisfies Field,
      {
        name: "item_limit",
        label: "Show only this many items per section",
        type: "number",
        required: false,
        min: 1,
        max: 12,
        admin: {
          description:
            "Optional. Leave it empty to show every item in the sections above.",
        },
      } satisfies Field,
      {
        name: "images",
        label: "Photographs",
        type: "array",
        minRows: 1,
        maxRows: 4,
        required: false,
        fields: [readyMedia(), accessibleAlt()],
        admin: {
          description:
            "Optional. Up to four square photographs shown beside the dishes.",
        },
      } satisfies Field,
      ...optionalCta("Full menu & ordering", "under the dishes"),
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
      /*
       * #3149 wave 4 — and one button under that grid, read off the same first
       * video for the same reason: the button belongs to the run of films, not
       * to any one of them, and four films each carrying it would print it
       * four times.
       */
      short(
        "group_cta_label",
        "Group button label",
        false,
        80,
        "Optional, and only used on the FIRST of several videos in a row. The words on the button printed under the grid \u2014 for example \u201cFollow @yourhandle\u201d.",
      ),
      link("group_cta_href", "Group button link", false),
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
      /*
       * #3149 wave 4 — show some of them, and point at the rest.
       *
       * Ten portraits is an entire screen. A home page shows a handful with a
       * button through to the page that has everybody; leaving this empty
       * shows every member, which is what this block always did.
       */
      {
        name: "preview_count",
        label: "Show only this many people",
        type: "number",
        required: false,
        min: 1,
        max: 24,
        admin: {
          description:
            "Optional. Show only the first few of the people below, with a button to the page that has all of them. Leave it empty to show everybody.",
        },
      } satisfies Field,
      ...optionalCta("All of them", "under the grid of people"),
      {
        name: "members",
        type: "array",
        minRows: 1,
        maxRows: 24,
        fields: [
          short("name", "Name", true, 80),
          short(
            "role",
            "Role",
            false,
            80,
            "Optional. Printed above the name, in your accent colour \u2014 for example \u201cKitchen\u201d or \u201cBar\u201d.",
          ),
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
      /*
       * #3149 wave 4 — THE TWO FIELDS BEHIND A LIVE "OPEN NOW".
       *
       * The hours below are your own words about your week, and no software
       * can read "Open 24 hours" and work out when the kitchen shuts. So a
       * site here never guesses: it prints a live open/closed line ONLY for a
       * place that has said, here, that it never closes — and only when it
       * also knows which clock to read.
       *
       * A place with ordinary opening hours leaves both empty and gets no such
       * line, which is the honest outcome until real opening hours can be
       * modelled.
       */
      {
        name: "always_open",
        label: "Open 24 hours, every day",
        type: "checkbox",
        required: false,
        admin: {
          description:
            "Tick this ONLY if this place never closes. It is what allows your site to show a live \u201copen now\u201d line with the local time; without it, nothing about being open is claimed.",
        },
      } satisfies Field,
      {
        name: "timezone",
        label: "Timezone",
        type: "text",
        required: false,
        maxLength: 60,
        /*
         * Validated as a REAL zone rather than as text. An offset ("+1")
         * drifts across a daylight-saving boundary and an abbreviation
         * ("WAT") is not something a clock can be built from — both would
         * surface as a wrong hour on a real restaurant's page. The public
         * contract refuses them too; this is the message the editor sees
         * first, while they can still fix it.
         */
        validate: safeTimeZone,
        admin: {
          description:
            "The timezone this place is in, as a region and city \u2014 for example Africa/Lagos or Europe/London. Needed for the live local time; without it no time is shown.",
        },
      } satisfies Field,
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
  /*
   * #3149 wave 3 — the four things the reference site has that a page here
   * could not hold at all. Each is a separate choice in Studio because each is
   * a different piece of a restaurant's page, not a setting on another one.
   */
  {
    slug: "marquee",
    labels: { singular: "Scrolling strip", plural: "Scrolling strips" },
    fields: [
      {
        name: "phrases",
        label: "Phrases",
        type: "array",
        minRows: 2,
        maxRows: 12,
        required: true,
        fields: [short("text", "Phrase", true, 80)],
        admin: {
          description:
            "A strip of short lines that scrolls sideways across the page, each separated by a dot, repeating for as long as it is on screen. Two lines at least — for example “24/7 food house”, “Come as you are”. Visitors who have asked their device to reduce motion see them standing still.",
        },
      },
    ],
  },
  {
    slug: "stats",
    labels: { singular: "Numbers row", plural: "Numbers rows" },
    fields: [
      eyebrow(),
      short("heading", "Heading", false, 120),
      short(
        "body",
        "Body",
        false,
        300,
        "Optional. One line under the heading, before the figures.",
      ),
      {
        name: "items",
        label: "Figures",
        type: "array",
        minRows: 1,
        maxRows: 6,
        required: true,
        fields: [
          short(
            "figure",
            "Figure",
            true,
            60,
            "The large line — a number, a time, or a few words. For example “Open 24 hours”.",
          ),
          short(
            "label",
            "Label",
            false,
            240,
            "Optional. The smaller line printed under the figure.",
          ),
          /*
           * #3149 wave 4 — a card, rather than a bare figure: a drawing above
           * the title and a sentence under it, and one card that can be marked
           * as the one to look at.
           *
           * The icon is a NAME FROM A CLOSED LIST that this site draws itself.
           * It is deliberately not a file and not an address: an icon fetched
           * from somewhere else is a request to a stranger on a page that
           * makes none, and one that failed to arrive would leave a hole where
           * the meaning was.
           */
          short(
            "body",
            "Body",
            false,
            300,
            "Optional. A sentence under the figure, for example \u201cSeven days a week, all year.\u201d",
          ),
          {
            name: "icon",
            label: "Icon",
            type: "select",
            required: false,
            options: statsIconOptions,
            admin: {
              description:
                "Optional. A small drawing above the figure, in your accent colour.",
            },
          } satisfies Field,
          {
            name: "highlight",
            label: "Mark this one out",
            type: "checkbox",
            required: false,
            admin: {
              description:
                "Optional. Rings this card in your accent colour so it stands out from the others.",
            },
          } satisfies Field,
        ],
        admin: {
          description:
            "A row of short figures with a line under each. Up to six.",
        },
      },
    ],
  },
  {
    slug: "pull_quote",
    labels: { singular: "Pull quote", plural: "Pull quotes" },
    fields: [
      short(
        "quote",
        "Quote",
        true,
        600,
        "A line worth pulling out of the surrounding writing. It is printed large, against a gold bar down its left edge.",
      ),
      short(
        "attribution",
        "Who said it",
        false,
        120,
        "Optional — for example “gögi, on Instagram”. Leave it empty and the quote stands on its own.",
      ),
    ],
  },
  {
    /*
     * #3149 — COORDINATES, NEVER AN ADDRESS TO LOOK UP.
     *
     * Handing a map a place by name resolves silently and can resolve to the
     * wrong country entirely; two numbers cannot. Both are required, and the
     * public site draws nothing on the page until a visitor asks for the map,
     * so opening the page contacts no map provider at all.
     */
    slug: "map_embed",
    labels: { singular: "Map", plural: "Maps" },
    fields: [
      eyebrow(),
      short("heading", "Heading", false, 120),
      short(
        "body",
        "Body",
        false,
        500,
        "Optional. What to tell someone who is on their way — the landmark to look for, which side of the street you are on.",
      ),
      {
        name: "latitude",
        label: "Latitude",
        type: "number",
        required: true,
        min: -90,
        max: 90,
        admin: {
          description:
            "The first of the two numbers your maps app shows when you drop a pin on your door. Between -90 and 90.",
        },
      },
      {
        name: "longitude",
        label: "Longitude",
        type: "number",
        required: true,
        min: -180,
        max: 180,
        admin: {
          description:
            "The second of the two numbers. Between -180 and 180.",
        },
      },
      short(
        "place_label",
        "What the map shows",
        true,
        200,
        "Read out to anyone using a screen reader, and printed on the panel before the map loads. Say plainly what is being pointed at — the street, or the exact address if you are sure of it.",
      ),
      link("directions_url", "Directions link", false),
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
