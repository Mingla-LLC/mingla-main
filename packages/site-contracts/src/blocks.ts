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
  type ActionIntent,
  isMinglaActionHref,
  isRegionCityTimeZone,
  isSafeHref,
  type MinglaActionScope,
  offersBookingOrPayment,
  plainObject,
  UUID_RE,
} from "./safety.ts";

export type FieldSpec =
  | { kind: "text"; max: number; required?: boolean; label: string }
  | { kind: "href"; required?: boolean; label: string }
  | { kind: "mingla_href"; required?: boolean; label: string }
  /*
   * #4453 PR 2 — a BUTTON link (isMinglaActionHref). `booking: true` (and
   * every action field on a BOOKING_BLOCK_TYPES block) is always a booking
   * action, locked to this site's pages and this brand's Mingla routes.
   * Otherwise the button is a booking action when its label (`labelField`)
   * reads as booking or paying, and informational when it doesn't.
   */
  | { kind: "action_href"; booking?: true; labelField?: string; required?: boolean; label: string }
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
  /** A real Region/City zone (no bare UTC): venue clocks need a city. */
  | { kind: "city_timezone"; label: string }
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
  cta_href: { kind: "action_href", labelField: "cta_label", label: "Button link" },
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
      /*
       * #4453 milestone 5 (§5.5) — the hero booking bar: blank date, time and
       * party (a table), dates and guests (a stay), or a date and guests (an
       * experience), handed to this brand's own Mingla page with the fields
       * pre-filled. `trip_search` is the stored `show_search`. The target is
       * the brand's own venue, stay or experience; Core resolves its page.
       */
      booking_bar: { kind: "enum", values: ["none", "venue_table", "stay", "experience", "trip_search"], label: "Booking bar" },
      booking_target_id: { kind: "uuid", label: "What the booking bar books" },
      /* #4453 milestone 5 (§5.6) — the Mingla rating badge (approved Mingla reviews only; no number is stored). */
      show_rating: { kind: "boolean", label: "Show the Mingla rating" },
      /*
       * #4453 milestone 7b (spec v2 §5.6) — the hero's fact badges: only the
       * owner's own setup "Quick facts" (Q8), copied verbatim. Never a price,
       * count, date or rating.
       */
      fact_badges: {
        kind: "list",
        min: 0,
        max: 3,
        label: "Fact badges",
        item: {
          big: { kind: "text", max: 12, required: true, label: "Big" },
          small: { kind: "text", max: 40, required: true, label: "Small" },
        },
      },
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
          href: { kind: "action_href", booking: true, required: true, label: "Link" },
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
      // #4572: a targetless owner-created band is valid content, but it has
      // no button. The owner editor may add a safe target later.
      href: { kind: "action_href", labelField: "label", label: "Button link" },
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
      kind: { kind: "enum", values: ["all", "trip", "event", "experience", "stay"], label: "Show" },
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
      cta_href: { kind: "action_href", booking: true, label: "Button link" },
      empty_cta_label: { kind: "text", max: 80, label: "Button when there is nothing to show" },
      empty_cta_href: { kind: "action_href", booking: true, label: "Its link" },
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
      href: { kind: "action_href", labelField: "label", required: true, label: "Button link" },
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
      /*
       * #4453 milestone 5 (§5.2) — a caption under a photograph, the owner's
       * words (Ari may caption only what the picture's own description or
       * the owner's words support; held from Ari until milestone 7). Each
       * names one of this block's own photographs.
       */
      captions: {
        kind: "list",
        min: 1,
        max: 12,
        label: "Captions",
        item: {
          media_id: { kind: "uuid", required: true, label: "Photograph" },
          caption: { kind: "text", max: 120, required: true, label: "Caption" },
          sub: { kind: "text", max: 80, label: "Small line" },
        },
      },
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
      group_cta_href: { kind: "action_href", labelField: "group_cta_label", label: "Button link under a row of films" },
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
      timezone: { kind: "city_timezone", label: "Time zone" },
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
      /* #4453 milestone 5 (§5.6) — the "{score} · {count} reviews on Mingla" line (approved Mingla reviews only). */
      show_rating: { kind: "boolean", label: "Show the Mingla rating" },
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
      href: { kind: "action_href", labelField: "label", required: true, label: "Button link" },
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
  /*
   * #4453 milestone 5 (§5.1) — live slots, nights or dates from Mingla, each
   * open one a link to this brand's Mingla page with the booking pre-filled.
   * The block holds only which venue, room or offering and how many days; the
   * slots themselves are read at request time and never stored.
   */
  availability: {
    label: "Live availability",
    description: "Open times, nights or dates, live from Mingla, each one booking through Mingla.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(),
      intro: { kind: "text", max: 300, label: "Line under the heading" },
      source: { kind: "enum", values: ["venue_slots", "experience_slots", "trip_departures", "event_dates", "stay_nights"], required: true, label: "What is shown" },
      offering_id: { kind: "uuid", label: "Venue or offering" },
      stay_offering_id: { kind: "uuid", label: "Room" },
      party_size: { kind: "integer", min: 1, max: 20, label: "Party size (tables)" },
      days: { kind: "integer", min: 3, max: 14, label: "Days shown" },
    },
  },
  /*
   * #4453 milestone 5 (§5.4) — one upcoming event's public ticket tiers, in
   * Mingla's order, read at request time. Hidden, link-only and member-pass
   * tiers never show; the block renders nothing once the event ends.
   */
  ticket_tiers: {
    label: "Ticket tiers",
    description: "The tickets on sale for one of your events, live from Mingla.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(),
      intro: { kind: "text", max: 300, label: "Line under the heading" },
      offering_id: { kind: "uuid", required: true, label: "Event" },
      media_url: { kind: "media_url", label: "Picture" },
    },
  },
  /* #4453 milestone 5 (§5.3) — "what happens when someone comes", the owner's own steps (Q7), copied verbatim. */
  process_steps: {
    label: "How it works",
    description: "The three to five steps a guest goes through, in your words.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(),
      intro: { kind: "text", max: 300, label: "Line under the heading" },
      items: {
        kind: "list",
        min: 3,
        max: 5,
        required: true,
        label: "Steps",
        item: {
          title: { kind: "text", max: 80, required: true, label: "Step" },
          text: { kind: "text", max: 300, label: "What happens" },
          time: { kind: "text", max: 24, label: "How long" },
        },
      },
    },
  },
  /*
   * #4453 milestone 7b (spec v2.1 §1.1, §1.3) — "Keep exploring": links to the
   * site's other pages. The owner (or composer v2) sets only the eyebrow, the
   * heading and the mode; the ITEMS are never stored in Studio: the builder
   * computes them at publish from the menu (teaser: up to 4 pages; next: the
   * following 3 in menu order, wrapping), from pages that are enabled and
   * reviewed, each with its own label, `seo.description` (cut to 120) and
   * `page_header` picture. Fewer than 2 pages: the block is left out.
   */
  page_links: {
    label: "Keep exploring",
    description: "Links to your other pages, picked from your menu when the site is published.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(),
      mode: { kind: "enum", values: ["teaser", "next"], required: true, label: "Which pages" },
      items: {
        kind: "list",
        min: 2,
        max: 4,
        label: "Pages (filled at publish)",
        item: {
          label: { kind: "text", max: 40, required: true, label: "Page name" },
          href: { kind: "action_href", required: true, label: "Page" },
          description: { kind: "text", max: 120, label: "What is on it" },
          media_url: { kind: "media_url", label: "Picture" },
        },
      },
    },
  },
  /*
   * #4453 milestone 7b (spec v2.1 §1.1) — a short table of facts in the
   * owner's own words (setup Q8 "Quick facts", copied verbatim). A row with no
   * value is never drawn.
   */
  facts_table: {
    label: "Facts",
    description: "A short table of facts about your place, in your words.",
    pageKinds: ANY_PAGE,
    fields: {
      eyebrow,
      heading: heading(),
      items: {
        kind: "list",
        min: 1,
        max: 8,
        required: true,
        label: "Facts",
        item: {
          label: { kind: "text", max: 40, required: true, label: "Fact" },
          value: { kind: "text", max: 200, required: true, label: "Detail" },
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
  /*
   * #4453 PR 2 — this site's brand, pages and contact details. With it, every
   * `action_href` must pass isMinglaActionHref. Without it (an artifact
   * published before the booking lock) an action link is held to isSafeHref,
   * so a site already live keeps serving until its next publish.
   */
  action?: MinglaActionScope;
};

/** #4453 PR 2 — blocks whose every button is a booking action (offerings and booking blocks). */
export const BOOKING_BLOCK_TYPES: readonly string[] = ["offering_grid", "offering_history", "venue_reservation", "menu_board", "availability", "ticket_tiers"];

/**
 * #4453 milestone 5 — the block types SITES_BOOKING_BLOCKS offers. They are
 * NOT offered to Ari until the Ari composition PR (milestone 7), so Ari's
 * frozen tool declarations stay byte-identical (#3355). Rendering a stored
 * one is never flagged.
 * [TRANSITIONAL] booking blocks held from Ari's frozen tool declarations — PR 7 (merged) already offers them through the design pass while SITES_ARI_DESIGN_PASS is on; exit: when the frozen pre-#4453 declarations (#3355 I-ARI-ROLLOUT-OFF-IS-MAIN) are retired, these lists stop being held from Ari.
 */
export const BOOKING_BLOCK_NEW_TYPES: readonly BlockType[] = ["availability", "ticket_tiers", "process_steps"];
/** #4453 milestone 5 — new fields on existing blocks, offered with the flag and held from Ari the same way. */
export const BOOKING_BLOCK_NEW_FIELDS: readonly string[] = ["hero.booking_bar", "hero.booking_target_id", "hero.show_rating", "testimonials.show_rating", "gallery.captions"];
/**
 * #4453 milestone 7b — the page-set blocks (spec v2.1 §1.1). Composer v2
 * places them on the design pass (switch-ON path); Ari's own block tools never
 * declare them, so the frozen switch-OFF declarations stay byte-identical
 * (#3355). A Studio editor may add one only with SITES_BOOKING_BLOCKS on (the
 * Studio gate); rendering a stored one is never flagged.
 */
export const PAGE_SET_BLOCK_TYPES: readonly BlockType[] = ["page_links", "facts_table"];
/** The block types Ari's tools declare (every type minus the held booking and page-set blocks). */
export const ARI_BLOCK_TYPES: readonly BlockType[] = BLOCK_TYPES.filter((type) => !BOOKING_BLOCK_NEW_TYPES.includes(type) && !PAGE_SET_BLOCK_TYPES.includes(type));

/** #4453 milestone 7b — does this block use a page-set feature (a page-set block, or hero fact badges)? */
export function usesPageSetFeature(block: { type?: unknown; blockType?: unknown; [key: string]: unknown }): boolean {
  const type = typeof block.type === "string" ? block.type : block.blockType;
  if ((PAGE_SET_BLOCK_TYPES as readonly unknown[]).includes(type)) return true;
  return type === "hero" && Array.isArray(block.fact_badges) && block.fact_badges.length > 0;
}

/**
 * #4453 milestone 5 — does this block use something SITES_BOOKING_BLOCKS
 * offers (a new type, a hero booking bar other than the stored trip search, a
 * rating)? Studio refuses a NEW one while the flag is off; a stored one keeps
 * rendering.
 */
export function usesBookingBlocksFeature(block: { type?: unknown; blockType?: unknown; [key: string]: unknown }): boolean {
  const type = typeof block.type === "string" ? block.type : block.blockType;
  if ((BOOKING_BLOCK_NEW_TYPES as readonly unknown[]).includes(type)) return true;
  if (type === "hero" && typeof block.booking_bar === "string" && !["none", "trip_search"].includes(block.booking_bar)) return true;
  if (type === "gallery" && Array.isArray(block.images) && block.images.some((row) => plainObject(row) && typeof row.caption === "string" && row.caption.trim() !== "")) return true;
  if (type === "gallery" && Array.isArray(block.captions) && block.captions.length > 0) return true;
  return (type === "hero" || type === "testimonials") && block.show_rating === true;
}

/** Whether one action field on one block (or list row) books/pays or only informs. */
export function actionIntentFor(
  blockType: string,
  spec: Extract<FieldSpec, { kind: "action_href" }>,
  row: Record<string, unknown>,
): ActionIntent {
  if (spec.booking || BOOKING_BLOCK_TYPES.includes(blockType)) return "booking";
  return spec.labelField && offersBookingOrPayment(row[spec.labelField]) ? "booking" : "informational";
}

function fieldOk(
  spec: FieldSpec,
  value: unknown,
  ctx: BlockValidationContext,
  row: Record<string, unknown> = {},
  blockType = "",
): boolean {
  const absent = value === undefined || value === null;
  switch (spec.kind) {
    case "text":
      return boundedText(value, spec.max, spec.required === true);
    case "href":
      return absent ? spec.required !== true : isSafeHref(value);
    case "mingla_href":
      return absent ? spec.required !== true : isCanonicalMinglaHref(value);
    case "action_href":
      if (absent) return spec.required !== true;
      return ctx.action ? isMinglaActionHref(value, ctx.action, actionIntentFor(blockType, spec, row)) : isSafeHref(value);
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
    case "city_timezone":
      return absent || isRegionCityTimeZone(value);
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
        return keys.every((key) => fieldOk(spec.item[key]!, row[key], ctx, row, blockType));
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
    if (!fieldOk(field, value[key], ctx, value, value.type)) throw new Error(`ARTIFACT_BLOCK_CONTENT_MISMATCH:${value.type}.${key}`);
  }
  if (value.type === "offering_grid") assertOfferingGridSource(value);
  if (value.type === "testimonials") assertTestimonialsSource(value);
  if (value.type === "availability") assertAvailabilityTarget(value);
  if (value.type === "hero") assertHeroBookingBar(value);
  if (value.type === "gallery") assertGalleryCaptions(value);
}

/* #4453 milestone 5 — a caption names one of the block's own photographs, at most once. */
function assertGalleryCaptions(block: Record<string, unknown>): void {
  if (!Array.isArray(block.captions)) return;
  const ids = new Set((Array.isArray(block.images) ? block.images : []).map((image) => (plainObject(image) ? String(image.id ?? "") : "")));
  const seen = new Set<string>();
  for (const row of block.captions) {
    const mediaId = plainObject(row) ? String(row.media_id ?? "") : "";
    if (!ids.has(mediaId) || seen.has(mediaId)) throw new Error("ARTIFACT_BLOCK_CONTENT_MISMATCH:gallery.captions");
    seen.add(mediaId);
  }
}

/*
 * #4453 milestone 5 — an availability block names exactly the thing its
 * source reads: a room for nights, otherwise a venue or offering; a party
 * size only for table slots.
 */
function assertAvailabilityTarget(block: Record<string, unknown>): void {
  const nights = block.source === "stay_nights";
  const has = (key: string) => block[key] !== undefined && block[key] !== null;
  if (nights ? !has("stay_offering_id") || has("offering_id") : !has("offering_id") || has("stay_offering_id")) {
    throw new Error("ARTIFACT_BLOCK_CONTENT_MISMATCH:availability.target");
  }
  if (has("party_size") && block.source !== "venue_slots") throw new Error("ARTIFACT_BLOCK_CONTENT_MISMATCH:availability.party_size");
}

/* #4453 milestone 5 — a booking bar for a venue, stay or experience names its target; none and the trip search name none. */
function assertHeroBookingBar(block: Record<string, unknown>): void {
  const targeted = ["venue_table", "stay", "experience"].includes(String(block.booking_bar));
  const hasTarget = block.booking_target_id !== undefined && block.booking_target_id !== null;
  if (targeted !== hasTarget) throw new Error("ARTIFACT_BLOCK_CONTENT_MISMATCH:hero.booking_target_id");
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

/** #4453 PR 2 — one action link found in a block: its field ("ctas[1].href") and value. */
export type BlockActionLink = { field: string; href: unknown; intent: ActionIntent };

/**
 * Every `action_href` value a block carries, nested lists included (absent
 * fields are skipped). Takes the catalogue shape, so it reads a v2 block and
 * a Studio block alike (their action field names are the same).
 */
export function blockActionLinks(block: { type?: unknown; blockType?: unknown; [key: string]: unknown }): BlockActionLink[] {
  const type = typeof block.type === "string" ? block.type : block.blockType;
  if (!isBlockType(type)) return [];
  const out: BlockActionLink[] = [];
  const walk = (fields: Readonly<Record<string, FieldSpec>>, row: Record<string, unknown>, prefix: string): void => {
    for (const [key, spec] of Object.entries(fields)) {
      const value = row[key];
      if (spec.kind === "action_href") {
        if (value !== undefined && value !== null && value !== "") {
          out.push({ field: `${prefix}${key}`, href: value, intent: actionIntentFor(type, spec, row) });
        }
      } else if (spec.kind === "list" && Array.isArray(value)) {
        value.forEach((item, index) => {
          if (plainObject(item)) walk(spec.item, item, `${prefix}${key}[${index}].`);
        });
      }
    }
  };
  walk(BLOCK_CATALOG[type].fields, block, "");
  return out;
}

/** The field names of a block type (Studio drift test, Ari schemas). */
export function blockFieldNames(type: BlockType): string[] {
  return Object.keys(BLOCK_CATALOG[type].fields);
}
