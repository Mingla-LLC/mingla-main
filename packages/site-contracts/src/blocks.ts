/**
 * #2829 AD-4 — the block catalogue: every block type a v2 site can publish,
 * its fields and limits, the page kinds it may sit on, and its Studio label.
 *
 * ONE SOURCE for the runtime validator (artifactV2.ts), the Studio block
 * configs (field names and labels are checked against this list by a drift
 * test), Ari's tool schemas (ariToolSchemas.ts) and Studio labels. Which
 * LAYOUT a block takes is its `variant`, chosen from the variants its design
 * draws (designs.ts).
 *
 * The restaurant types keep their v1 data contracts exactly (AD-4): a v1
 * block becomes a v2 block by gaining a `variant`, and nothing else moves,
 * except `rich_text`, whose paragraphs become the closed rich-text tree.
 */
import { assertRichText } from "./richText.ts";
import { isSlug } from "./routes.ts";
import { FEATURE_ICON_NAMES, STATS_ICON_NAMES } from "./icons.ts";
import {
  boundedText,
  isCanonicalMinglaHref,
  isIanaTimeZone,
  isSafeHref,
  plainObject,
  UUID_RE,
} from "./safety.ts";

export type FieldSpec =
  | { kind: "text"; max: number; required?: boolean; label: string }
  | { kind: "href"; required?: boolean; label: string }
  | { kind: "mingla_href"; required?: boolean; label: string }
  /** A link to one of THIS artifact's media records (checked against the manifest). */
  | { kind: "media_url"; required?: boolean; label: string }
  /** #2829 W6 — a video this artifact carries (a file video or a stream video). */
  | { kind: "video_url"; required?: boolean; label: string }
  | { kind: "uuid"; required?: boolean; label: string }
  /** #2829 W5 — an address segment (a collection entry or category slug). */
  | { kind: "slug"; required?: boolean; label: string }
  /** #2829 W5 — an email address shown to visitors (a fallback contact line). */
  | { kind: "email"; required?: boolean; label: string }
  | { kind: "integer"; min: number; max: number; required?: boolean; label: string }
  | { kind: "number"; min: number; max: number; required?: boolean; label: string }
  | { kind: "boolean"; label: string }
  | { kind: "enum"; values: readonly string[]; required?: boolean; label: string }
  | { kind: "timezone"; label: string }
  | { kind: "currency"; label: string }
  | { kind: "icon"; values: readonly string[]; label: string }
  | { kind: "rich_text"; required?: boolean; label: string }
  /** Media records carried in full (gallery images). */
  | { kind: "media_list"; min: number; max: number; required?: boolean; label: string }
  | { kind: "list"; min: number; max: number; required?: boolean; item: Readonly<Record<string, FieldSpec>>; label: string };

export type PageKindForBlocks = "standard" | "collection_index";

export type BlockSpec = {
  label: string;
  description: string;
  pageKinds: readonly PageKindForBlocks[];
  fields: Readonly<Record<string, FieldSpec>>;
};

const ANY_PAGE: readonly PageKindForBlocks[] = ["standard", "collection_index"];
const eyebrow: FieldSpec = { kind: "text", max: 120, label: "Small line above the heading" };
const heading = (required = false): FieldSpec => ({ kind: "text", max: 120, required, label: "Heading" });
const ctaPair = {
  cta_label: { kind: "text", max: 80, label: "Button label" },
  cta_href: { kind: "href", label: "Button link" },
} as const satisfies Record<string, FieldSpec>;
const menuSections: FieldSpec = {
  kind: "list",
  min: 1,
  max: 20,
  required: true,
  label: "Menu sections (from Mingla)",
  item: {
    name: { kind: "text", max: 120, required: true, label: "Section" },
    description: { kind: "text", max: 500, label: "Section note" },
    items: {
      kind: "list",
      min: 1,
      max: 120,
      required: true,
      label: "Items",
      item: {
        id: { kind: "uuid", required: true, label: "Mingla item" },
        name: { kind: "text", max: 160, required: true, label: "Name" },
        description: { kind: "text", max: 600, label: "Description" },
        price_minor: { kind: "integer", min: 0, max: 100_000_000, label: "Price (minor units)" },
        currency: { kind: "currency", label: "Currency" },
      },
    },
  },
};

export const BLOCK_CATALOG = {
  hero: {
    label: "Hero",
    description: "The big opening picture with a headline and up to two buttons.",
    pageKinds: ANY_PAGE,
    fields: {
      /*
       * #2829 W7 — the travel designs' hero: a small script line above, the
       * headline set on up to three lines of its own, and the date-and-place
       * search under it. `heading` stays the one-line headline every design
       * reads; `heading_lines`, when given, is how a design that sets lines
       * draws it.
       */
      eyebrow,
      heading: heading(true),
      heading_lines: {
        kind: "list",
        min: 1,
        max: 3,
        label: "Headline, line by line",
        item: { text: { kind: "text", max: 80, required: true, label: "Line" } },
      },
      subheading: { kind: "text", max: 300, label: "Line under the headline" },
      show_search: { kind: "boolean", label: "Show the trip search" },
      media_url: { kind: "media_url", required: true, label: "Picture" },
      video_url: { kind: "video_url", label: "Background film" },
      ctas: {
        kind: "list",
        min: 0,
        max: 2,
        required: true,
        label: "Buttons",
        item: {
          label: { kind: "text", max: 80, required: true, label: "Label" },
          href: { kind: "href", required: true, label: "Link" },
        },
      },
    },
  },
  rich_text: {
    label: "Writing",
    description: "Paragraphs, headings, lists and quotes.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(),
      body: { kind: "rich_text", required: true, label: "Text" },
      /* #2829 W7 — a reading column (narrow, the default) or the full shell. */
      width: { kind: "enum", values: ["narrow", "full"], label: "Width" },
    },
  },
  media_feature: {
    label: "Picture with words",
    description: "A photograph beside a heading and caption, with an optional quote and button.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      media_url: { kind: "media_url", required: true, label: "Picture" },
      alt: { kind: "text", max: 240, required: true, label: "Picture description" },
      heading: heading(),
      caption: { kind: "text", max: 500, label: "Caption" },
      alignment: { kind: "enum", values: ["left", "right"], required: true, label: "Picture side" },
      media_shape: { kind: "enum", values: ["rectangle", "circle"], label: "Picture shape" },
      badge_figure: { kind: "text", max: 24, label: "Badge figure" },
      badge_label: { kind: "text", max: 40, label: "Badge label" },
      quote: { kind: "text", max: 600, label: "Quote" },
      quote_attribution: { kind: "text", max: 120, label: "Quote by" },
      ...ctaPair,
    },
  },
  cta: {
    label: "Call to action",
    description: "A heading, a sentence and one button.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(true),
      body: { kind: "text", max: 500, label: "Sentence" },
      label: { kind: "text", max: 80, required: true, label: "Button label" },
      href: { kind: "href", required: true, label: "Button link" },
    },
  },
  offering_grid: {
    label: "Offerings",
    description: "Trips, events or experiences from Mingla.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(),
      /*
       * #2829 W4 — a LIVE grid: which offerings come from Mingla's feed at
       * request time (with the publication's snapshot as fallback), never from
       * copies in the artifact. `mode` marks a live grid.
       */
      kind: { kind: "enum", values: ["all", "trip", "event", "experience"], label: "Show" },
      mode: { kind: "enum", values: ["upcoming", "past", "all"], label: "Which dates" },
      offering_ids: {
        kind: "list",
        min: 1,
        max: 24,
        label: "Only these offerings",
        item: { id: { kind: "uuid", required: true, label: "Mingla offering" } },
      },
      limit: { kind: "integer", min: 1, max: 24, label: "Show at most" },
      show_filters: { kind: "boolean", label: "Show the date and place search" },
      empty_text: { kind: "text", max: 200, label: "When there is nothing to show" },
      /*
       * #2829 W7 — the line under the heading, a button beside it, and the
       * way on from an empty list ("Get in touch").
       */
      intro: { kind: "text", max: 500, label: "Line under the heading" },
      cta_label: { kind: "text", max: 80, label: "Button label" },
      cta_href: { kind: "href", label: "Button link" },
      empty_cta_label: { kind: "text", max: 80, label: "Button when there is nothing to show" },
      empty_cta_href: { kind: "href", label: "Its link" },
      /*
       * The original (v1) grid: offerings chosen by id with their title and
       * link resolved at publish. Kept so earlier publications and gögi's
       * pages render exactly as before; a block is one or the other.
       */
      offerings: {
        kind: "list",
        min: 1,
        max: 12,
        label: "Offerings",
        item: {
          id: { kind: "uuid", required: true, label: "Mingla offering" },
          label: { kind: "text", max: 200, required: true, label: "Title" },
          summary: { kind: "text", max: 500, label: "Summary" },
          url: { kind: "mingla_href", required: true, label: "Mingla page" },
        },
      },
    },
  },
  venue_reservation: {
    label: "Reservation",
    description: "A button to book a table through Mingla.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(true),
      body: { kind: "text", max: 500, label: "Sentence" },
      url: { kind: "mingla_href", required: true, label: "Mingla booking page" },
    },
  },
  menu_link: {
    label: "Menu link",
    description: "A button to the full menu.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(),
      label: { kind: "text", max: 80, required: true, label: "Button label" },
      href: { kind: "href", required: true, label: "Button link" },
    },
  },
  menu_board: {
    label: "Menu",
    description: "The menu from Mingla, with ordering when a venue is verified.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(),
      note: { kind: "text", max: 300, label: "Note" },
      venue_id: { kind: "uuid", label: "Ordering venue" },
      sections: menuSections,
    },
  },
  menu_preview: {
    label: "Menu taster",
    description: "A few dishes from the Mingla menu beside photographs.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(),
      note: { kind: "text", max: 300, label: "Note" },
      sections: menuSections,
      section_limit: { kind: "integer", min: 1, max: 6, label: "Sections shown" },
      item_limit: { kind: "integer", min: 1, max: 12, label: "Items per section" },
      images: { kind: "media_list", min: 1, max: 4, label: "Photographs" },
      ...ctaPair,
    },
  },
  gallery: {
    label: "Gallery",
    description: "Up to twelve photographs.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(),
      images: { kind: "media_list", min: 1, max: 12, required: true, label: "Photographs" },
    },
  },
  video_feature: {
    label: "Film",
    description: "A film with a still; several in a row become a grid.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      group_heading: { kind: "text", max: 120, label: "Heading over a row of films" },
      group_cta_label: { kind: "text", max: 80, label: "Button under a row of films" },
      group_cta_href: { kind: "href", label: "Button link under a row of films" },
      heading: heading(),
      caption: { kind: "text", max: 600, label: "Caption" },
      video_url: { kind: "video_url", required: true, label: "Film" },
      poster_url: { kind: "media_url", required: true, label: "Still" },
    },
  },
  team: {
    label: "Team",
    description: "The people, with roles and optional portraits.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(),
      caption: { kind: "text", max: 600, label: "Caption" },
      members: {
        kind: "list",
        min: 1,
        max: 24,
        required: true,
        label: "People",
        item: {
          name: { kind: "text", max: 80, required: true, label: "Name" },
          role: { kind: "text", max: 80, label: "Role" },
          media_url: { kind: "href", label: "Portrait" },
          alt: { kind: "text", max: 240, label: "Portrait description" },
        },
      },
      preview_count: { kind: "integer", min: 1, max: 24, label: "People shown" },
      ...ctaPair,
    },
  },
  hours_location: {
    label: "Hours and location",
    description: "Address, map link and opening hours.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(),
      address: { kind: "text", max: 300, required: true, label: "Address" },
      map_url: { kind: "href", label: "Map link" },
      hours: {
        kind: "list",
        min: 1,
        max: 7,
        required: true,
        label: "Hours",
        item: {
          day: { kind: "text", max: 20, required: true, label: "Day" },
          value: { kind: "text", max: 80, required: true, label: "Hours" },
        },
      },
      timezone: { kind: "timezone", label: "Time zone" },
      always_open: { kind: "boolean", label: "Never closes" },
    },
  },
  testimonials: {
    label: "Testimonials",
    description: "Quotes from guests, typed in here or picked from your reviews.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(),
      /*
       * #2829 W5 — reviews from the site's Testimonials collection (only ones
       * confirmed as real reach a publication). `from_collection` marks this
       * form; `testimonial_ids` narrows it to chosen reviews, in that order.
       */
      intro: { kind: "text", max: 500, label: "Line under the heading" },
      from_collection: { kind: "boolean", label: "Show reviews from your Testimonials" },
      testimonial_ids: {
        kind: "list",
        min: 1,
        max: 24,
        label: "Only these reviews",
        item: { id: { kind: "uuid", required: true, label: "Review" } },
      },
      limit: { kind: "integer", min: 1, max: 24, label: "Show at most" },
      ...ctaPair,
      /* The original form (gögi): quotes typed into the block. A block is one or the other. */
      items: {
        kind: "list",
        min: 1,
        max: 8,
        label: "Quotes",
        item: {
          name: { kind: "text", max: 120, required: true, label: "Name" },
          quote: { kind: "text", max: 500, required: true, label: "Quote" },
        },
      },
    },
  },
  faq: {
    label: "Questions",
    description: "Questions and answers that open and close.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(),
      items: {
        kind: "list",
        min: 1,
        max: 12,
        required: true,
        label: "Questions",
        item: {
          question: { kind: "text", max: 240, required: true, label: "Question" },
          answer: { kind: "text", max: 1_000, required: true, label: "Answer" },
        },
      },
    },
  },
  contact_handoff: {
    label: "Get in touch",
    description: "A heading, a sentence and a contact button.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(true),
      body: { kind: "text", max: 500, label: "Sentence" },
      label: { kind: "text", max: 80, required: true, label: "Button label" },
      href: { kind: "href", required: true, label: "Button link" },
    },
  },
  divider: { label: "Divider", description: "A thin line.", pageKinds: ANY_PAGE, fields: {} },
  spacer: {
    label: "Space",
    description: "Breathing room between sections.",
    pageKinds: ANY_PAGE,
    fields: { size: { kind: "enum", values: ["small", "medium", "large"], required: true, label: "Size" } },
  },
  marquee: {
    label: "Ticker",
    description: "A strip of short phrases that scrolls.",
    pageKinds: ANY_PAGE,
    fields: {
      phrases: {
        kind: "list",
        min: 2,
        max: 12,
        required: true,
        label: "Phrases",
        item: { text: { kind: "text", max: 80, required: true, label: "Phrase" } },
      },
    },
  },
  pull_quote: {
    label: "Pull quote",
    description: "One line lifted out, with who said it.",
    pageKinds: ANY_PAGE,
    fields: {
      quote: { kind: "text", max: 600, required: true, label: "Quote" },
      attribution: { kind: "text", max: 120, label: "Said by" },
    },
  },
  stats: {
    label: "Figures",
    description: "A row of figures with a line under each.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(),
      body: { kind: "text", max: 300, label: "Sentence" },
      items: {
        kind: "list",
        min: 1,
        max: 6,
        required: true,
        label: "Figures",
        item: {
          figure: { kind: "text", max: 60, required: true, label: "Figure" },
          label: { kind: "text", max: 240, label: "Label" },
          body: { kind: "text", max: 300, label: "Sentence" },
          icon: { kind: "icon", values: STATS_ICON_NAMES, label: "Icon" },
          highlight: { kind: "boolean", label: "Highlight" },
        },
      },
    },
  },
  map_embed: {
    label: "Map",
    description: "A map of one place, shown when the visitor asks.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(),
      body: { kind: "text", max: 500, label: "Sentence" },
      latitude: { kind: "number", min: -90, max: 90, required: true, label: "Latitude" },
      longitude: { kind: "number", min: -180, max: 180, required: true, label: "Longitude" },
      place_label: { kind: "text", max: 200, required: true, label: "Place name" },
      directions_url: { kind: "href", label: "Directions link" },
    },
  },
  /* ---------------- #2829 W5 — collections, history and forms ---------------- */
  destination_grid: {
    label: "Destinations",
    description: "Your destinations, each opening its own page.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(),
      intro: { kind: "text", max: 500, label: "Line under the heading" },
      destinations: {
        kind: "list",
        min: 1,
        max: 24,
        label: "Only these destinations",
        item: { slug: { kind: "slug", required: true, label: "Destination" } },
      },
      ...ctaPair,
    },
  },
  story_grid: {
    label: "Stories",
    description: "Your stories, newest first, each opening its own page.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(),
      intro: { kind: "text", max: 500, label: "Line under the heading" },
      category: { kind: "slug", label: "Only this category" },
      limit: { kind: "integer", min: 1, max: 24, label: "Show at most" },
      ...ctaPair,
    },
  },
  offering_history: {
    label: "Trips we've run",
    description: "Your ended trips from Mingla, newest first; a run of departures can be grouped under one name.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(true),
      intro: { kind: "text", max: 500, label: "Line under the heading" },
      kind: { kind: "enum", values: ["trip", "event", "experience", "all"], label: "Show" },
      /*
       * #2829 W7b — the owner may list only some ended trips (for example the
       * departures run before Mingla). Empty: every ended trip is listed.
       */
      offering_ids: {
        kind: "list",
        min: 1,
        max: 24,
        label: "Only these trips",
        item: { id: { kind: "uuid", required: true, label: "Mingla trip" } },
      },
      series: {
        kind: "list",
        min: 1,
        max: 12,
        label: "Runs of the same trip",
        item: {
          label: { kind: "text", max: 80, required: true, label: "Name of the run" },
          offering_ids: {
            kind: "list",
            min: 2,
            max: 24,
            required: true,
            label: "Departures",
            item: { id: { kind: "uuid", required: true, label: "Mingla trip" } },
          },
        },
      },
      /*
       * #2829 W7 — the rows that carry a "See the trip" link to their Mingla
       * page. Every ended trip has one; the owner picks which are worth a
       * visit (none by default).
       */
      linked_offering_ids: {
        kind: "list",
        min: 1,
        max: 24,
        label: "Trips that show a \u201cSee the trip\u201d link",
        item: { id: { kind: "uuid", required: true, label: "Mingla trip" } },
      },
      ...ctaPair,
    },
  },
  contact_form: {
    label: "Contact form",
    description: "Visitors send you a message; it arrives in Mingla with their email.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(),
      intro: { kind: "text", max: 500, label: "Line under the heading" },
      show_phone: { kind: "boolean", label: "Ask for a phone number (optional for visitors)" },
      /* #2829 W7b — hints inside the name and email boxes (absent: none). */
      name_placeholder: { kind: "text", max: 80, label: "Name hint" },
      email_placeholder: { kind: "text", max: 80, label: "Email hint" },
      message_label: { kind: "text", max: 80, label: "Message label" },
      message_placeholder: { kind: "text", max: 160, label: "Message hint" },
      submit_label: { kind: "text", max: 40, required: true, label: "Button label" },
      success_text: { kind: "text", max: 300, label: "Thank-you line" },
      fallback_email: { kind: "email", label: "Email shown as another way to reach you" },
    },
  },
  newsletter_signup: {
    label: "Newsletter",
    description: "Visitors join your list; Mingla emails them to confirm first.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(true),
      body: { kind: "text", max: 500, label: "Sentence" },
      placeholder: { kind: "text", max: 80, label: "Email box hint" },
      button_label: { kind: "text", max: 40, required: true, label: "Button label" },
      small_print: { kind: "text", max: 300, label: "Small print" },
    },
  },
  /* ---------------- #2829 W7 — the travel designs' page header, cards and contact tiles ---------------- */
  page_header: {
    label: "Page header",
    description: "The title band at the top of a page, over a photograph or a dark panel, with the way back home.",
    pageKinds: ANY_PAGE,
    fields: {
      heading: heading(true),
      subheading: { kind: "text", max: 300, label: "Line under the title (a new line starts a new line)" },
      media_url: { kind: "media_url", label: "Picture (leave empty for a dark panel)" },
    },
  },
  feature_cards: {
    label: "Cards",
    description: "Up to six short cards, each a title and a sentence, with an optional icon.",
    pageKinds: ANY_PAGE,
    fields: {
      heading: heading(),
      intro: { kind: "text", max: 500, label: "Line under the heading" },
      cards: {
        kind: "list",
        min: 1,
        max: 6,
        required: true,
        label: "Cards",
        item: {
          title: { kind: "text", max: 120, required: true, label: "Title" },
          body: { kind: "text", max: 500, required: true, label: "Sentence" },
          icon: { kind: "icon", values: FEATURE_ICON_NAMES, label: "Icon" },
        },
      },
    },
  },
  contact_details: {
    label: "Contact details",
    description: "Your email and where you are, in tiles.",
    pageKinds: ANY_PAGE,
    fields: {
      heading: heading(),
      body: { kind: "text", max: 500, label: "Sentence" },
      email: { kind: "email", label: "Email" },
      location: { kind: "text", max: 120, label: "Location" },
    },
  },
} as const satisfies Record<string, BlockSpec>;

export type BlockType = keyof typeof BLOCK_CATALOG;
export const BLOCK_TYPES = Object.keys(BLOCK_CATALOG) as BlockType[];

export function isBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(BLOCK_CATALOG, value);
}

/** A v2 block: its type, its layout, and its catalogue fields. */
export type SiteBlock = { type: BlockType; variant: string; [field: string]: unknown };

export type BlockValidationContext = {
  /** URLs of this artifact's media records (hero/feature pictures must be one). */
  mediaUrls: ReadonlySet<string>;
  /** #2829 W6 — URLs of this artifact's videos (file and stream). */
  videoUrls?: ReadonlySet<string>;
  /** Validates one full media record and that it belongs to this artifact. */
  assertMedia: (value: unknown) => void;
};

function fieldOk(spec: FieldSpec, value: unknown, ctx: BlockValidationContext): boolean {
  const absent = value === undefined || value === null;
  switch (spec.kind) {
    case "text":
      return boundedText(value, spec.max, spec.required === true);
    case "href":
      return absent ? spec.required !== true : isSafeHref(value);
    case "mingla_href":
      return absent ? spec.required !== true : isCanonicalMinglaHref(value);
    case "media_url":
      return absent ? spec.required !== true : isSafeHref(value) && ctx.mediaUrls.has(value);
    case "video_url":
      return absent ? spec.required !== true : typeof value === "string" && (ctx.videoUrls?.has(value) ?? false);
    case "uuid":
      return absent ? spec.required !== true : typeof value === "string" && UUID_RE.test(value);
    case "slug":
      return absent ? spec.required !== true : isSlug(value);
    case "email":
      return absent
        ? spec.required !== true
        : typeof value === "string" && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
    case "integer":
      return absent
        ? spec.required !== true
        : typeof value === "number" && Number.isInteger(value) && value >= spec.min && value <= spec.max;
    case "number":
      return absent
        ? spec.required !== true
        : typeof value === "number" && Number.isFinite(value) && value >= spec.min && value <= spec.max;
    case "boolean":
      return absent || typeof value === "boolean";
    case "enum":
      return absent ? spec.required !== true : spec.values.includes(String(value)) && typeof value === "string";
    case "timezone":
      return absent || isIanaTimeZone(value);
    case "currency":
      return absent || (typeof value === "string" && /^[A-Z]{3}$/.test(value));
    case "icon":
      return absent || (typeof value === "string" && spec.values.includes(value));
    case "rich_text":
      if (absent) return spec.required !== true;
      assertRichText(value);
      return true;
    case "media_list":
      if (absent) return spec.required !== true;
      if (!Array.isArray(value) || value.length < spec.min || value.length > spec.max) return false;
      for (const item of value) ctx.assertMedia(item);
      return true;
    case "list":
      if (absent) return spec.required !== true;
      if (!Array.isArray(value) || value.length < spec.min || value.length > spec.max) return false;
      return value.every((row) => {
        if (!plainObject(row)) return false;
        const keys = Object.keys(spec.item);
        if (Object.keys(row).some((key) => !keys.includes(key))) return false;
        return keys.every((key) => fieldOk(spec.item[key]!, row[key], ctx));
      });
  }
}

/**
 * Validates one v2 block against the catalogue. Unknown types or keys throw
 * `ARTIFACT_BLOCK_TYPE_MISMATCH`; a field outside its rules throws
 * `ARTIFACT_BLOCK_CONTENT_MISMATCH`. The variant is checked by the artifact
 * against the design (artifactV2.ts).
 */
export function assertSiteBlock(value: unknown, ctx: BlockValidationContext): asserts value is SiteBlock {
  if (!plainObject(value) || !isBlockType(value.type)) throw new Error("ARTIFACT_BLOCK_TYPE_MISMATCH");
  const spec: BlockSpec = BLOCK_CATALOG[value.type];
  const allowed = ["type", "variant", ...Object.keys(spec.fields)];
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("ARTIFACT_BLOCK_TYPE_MISMATCH");
  if (typeof value.variant !== "string" || !/^[a-z][a-z0-9-]{1,39}$/.test(value.variant)) {
    throw new Error("ARTIFACT_BLOCK_TYPE_MISMATCH");
  }
  for (const [key, field] of Object.entries(spec.fields)) {
    if (!fieldOk(field, value[key], ctx)) throw new Error(`ARTIFACT_BLOCK_CONTENT_MISMATCH:${value.type}.${key}`);
  }
  if (value.type === "offering_grid") assertOfferingGridSource(value);
  if (value.type === "testimonials") assertTestimonialsSource(value);
}

/*
 * #2829 W5 — a testimonials block is EITHER the original typed-in quotes
 * (`items`) OR reviews from the Testimonials collection (`from_collection`).
 * Never both, never neither.
 */
function assertTestimonialsSource(block: Record<string, unknown>): void {
  const fromCollection = block.from_collection === true;
  const typed = Array.isArray(block.items);
  const collectionFields = ["testimonial_ids", "limit"].some((key) => block[key] !== undefined && block[key] !== null);
  if (fromCollection === typed || (typed && collectionFields) || block.from_collection === false) {
    throw new Error("ARTIFACT_BLOCK_CONTENT_MISMATCH:testimonials.source");
  }
}

/** #2829 W5 — does this block read Mingla's live offerings feed when it renders? */
export function blockReadsFeed(block: { type: string; mode?: unknown }): boolean {
  return isLiveOfferingGrid(block) || block.type === "offering_history";
}

const LIVE_GRID_FIELDS = [
  "kind", "mode", "offering_ids", "limit", "show_filters", "empty_text",
  "intro", "cta_label", "cta_href", "empty_cta_label", "empty_cta_href",
] as const;

/** #2829 W4 — true for a live (feed) grid, false for an original v1 grid. */
export function isLiveOfferingGrid(block: { type: string; mode?: unknown }): boolean {
  return block.type === "offering_grid" && typeof block.mode === "string";
}

/*
 * #2829 W4 — an offering grid is EITHER live (`mode` set; offerings come from
 * Mingla at request time) OR an original v1 grid (`offerings` listed). Never
 * both, never neither: a grid with nothing to say is refused at publish.
 */
function assertOfferingGridSource(block: Record<string, unknown>): void {
  const live = typeof block.mode === "string";
  const legacy = Array.isArray(block.offerings);
  const liveFieldsPresent = LIVE_GRID_FIELDS.some((key) => block[key] !== undefined && block[key] !== null);
  if (live === legacy || (legacy && liveFieldsPresent)) {
    throw new Error("ARTIFACT_BLOCK_CONTENT_MISMATCH:offering_grid.source");
  }
}

/** The field names of a block type (Studio drift test, Ari schemas). */
export function blockFieldNames(type: BlockType): string[] {
  return Object.keys(BLOCK_CATALOG[type].fields);
}
