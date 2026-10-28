/**
 * #2829 W9a — what an empty planned page says, VERBATIM from the design
 * contract's rules table ("Pages, menu and empty states", approved by Seth on
 * Oct 5): every page for something the brand offers or plans to offer is
 * built, and a planned page may be empty but never fake.
 *
 * These are Mingla's fixed words for an empty state, not the brand's: the
 * composer never writes any other text it was not given (brand fields and
 * the owner's answers only). A test pins every string to the rules table.
 *
 * No imports: the Business app reads this file directly.
 */

export type PlannedPageKey = "trips" | "events" | "experiences" | "menu" | "visit" | "rooms";

export type PlannedPageEmptyState = {
  /** The honest line shown while the page has nothing on it (the rules table, verbatim). */
  readonly text: string;
  /** What the email form under it says. */
  readonly form_heading: string;
  readonly form_button: string;
};

export const PLANNED_PAGE_EMPTY_STATES: Readonly<Record<PlannedPageKey, PlannedPageEmptyState>> = {
  trips: {
    text: "No trips on sale yet. Tell us where you want to go",
    form_heading: "Tell us where you want to go",
    form_button: "Send",
  },
  events: {
    text: "Nothing on the calendar yet. Hear first",
    form_heading: "Hear first",
    form_button: "Tell me first",
  },
  experiences: {
    text: "Experiences opening soon",
    form_heading: "Hear first",
    form_button: "Tell me first",
  },
  menu: {
    text: "Our menu is on its way",
    form_heading: "Hear first",
    form_button: "Tell me first",
  },
  visit: {
    text: "Message to book",
    form_heading: "Message to book",
    form_button: "Send",
  },
  rooms: {
    text: "Rooms opening soon",
    form_heading: "Ask about a stay",
    form_button: "Send",
  },
};

/** Restaurant reservations before table bookings are switched on (rules table). */
export const RESERVATIONS_OFF_TEXT = "Call or message to book";

/** The menu label and main button each planned page carries (rules table). */
export const PLANNED_PAGE_LABELS: Readonly<Record<PlannedPageKey, { menu: string; action: string }>> = {
  trips: { menu: "Trips", action: "See the trips" },
  events: { menu: "Events", action: "See what's on" },
  experiences: { menu: "Experiences", action: "See the experiences" },
  menu: { menu: "Menu", action: "Reserve a table" },
  visit: { menu: "Visit", action: "Book a visit" },
  rooms: { menu: "Rooms", action: "Reserve this stay" },
};
