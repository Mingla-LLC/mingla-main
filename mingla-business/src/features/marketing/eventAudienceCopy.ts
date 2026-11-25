/**
 * #4596 — how an event audience is named and described: RSVP guests, paid
 * buyers or both ("people"), the pending duplicate-check note, the zero-reach
 * captions and who may pick an event audience. Pure and dependency-free, so
 * the boot-path Audiences tab can use it without the composer's model.
 */


/**
 * Whether this role may pick an event audience. Mirrors the server rule in
 * issue_4273_assert_sources_allowed: an `event:` source needs event_manager
 * (rank 40) or above; a marketing manager (20) is refused at quote.
 */
export const EVENT_AUDIENCE_MIN_RANK = 40;
export function canPickEventAudience(rank: number): boolean {
  return rank >= EVENT_AUDIENCE_MIN_RANK;
}

/** Who an event audience is, for its copy: RSVP guests, paid buyers or both. */
export type EventAudienceShape = "guests" | "buyers" | "people";

export interface EventAudienceFacts {
  eventType: string | null;
  buyerCount: number;
  guestCount: number;
}

/**
 * An event with both paid buyers and RSVP guests is "people"; an RSVP event (or
 * any event whose audience is guests only) is "guests"; otherwise "buyers".
 */
export function eventAudienceShape(facts: EventAudienceFacts): EventAudienceShape {
  if (facts.buyerCount > 0 && facts.guestCount > 0) return "people";
  if (facts.eventType === "rsvp" || facts.guestCount > 0) return "guests";
  return "buyers";
}

/** "1 guest", "3 buyers", "1 person", "4 people". */
export function eventAudienceCount(shape: EventAudienceShape, count: number): string {
  const one = count === 1;
  switch (shape) {
    case "guests":
      return `${count} ${one ? "guest" : "guests"}`;
    case "buyers":
      return `${count} ${one ? "buyer" : "buyers"}`;
    case "people":
      return `${count} ${one ? "person" : "people"}`;
    default: {
      const unreachable: never = shape;
      return unreachable;
    }
  }
}

const EVENT_CARD_LABEL: Record<EventAudienceShape, string> = {
  guests: "GUESTS",
  buyers: "BUYERS",
  people: "PEOPLE",
};
const EVENT_ROW_PREFIX: Record<EventAudienceShape, string> = {
  guests: "Guests of",
  buyers: "Buyers of",
  people: "People at",
};
const EVENT_ROW_SUBTITLE: Record<EventAudienceShape, string> = {
  guests: "Event guests",
  buyers: "Event buyers",
  people: "Event buyers and guests",
};
const EVENT_ROW_MEANING: Record<EventAudienceShape, string> = {
  guests: "Automatic guest group",
  buyers: "Automatic buyer group",
  people: "Automatic buyer and guest group",
};
const EVENT_NOUN: Record<EventAudienceShape, string> = {
  guests: "Guests",
  buyers: "Buyers",
  people: "People",
};

/** The Blasts screen card label: GUESTS, BUYERS or PEOPLE. */
export const eventCardLabel = (shape: EventAudienceShape): string => EVENT_CARD_LABEL[shape];

/** The Blasts screen header: "{n} guests · {m} reachable". */
export function eventHeaderCounts(shape: EventAudienceShape, people: number, reachable: number): string {
  return `${eventAudienceCount(shape, people)} · ${reachable} reachable`;
}

/** The picker row name: "Guests of {title}" / "Buyers of {title}" / "People at {title}". */
export function eventRowName(shape: EventAudienceShape, title: string | null): string {
  return `${EVENT_ROW_PREFIX[shape]} ${title ?? "Untitled event"}`;
}

/** The picker row meta line: "{n} guests · Event guests". */
export function eventRowMeta(shape: EventAudienceShape, people: number): string {
  return `${eventAudienceCount(shape, people)} · ${EVENT_ROW_SUBTITLE[shape]}`;
}

/** What the picker row means, spoken by screen readers. */
export const eventRowMeaning = (shape: EventAudienceShape): string => EVENT_ROW_MEANING[shape];

/** Under a disabled Send blast button when nobody here can get email. */
export function eventZeroReachCaption(shape: EventAudienceShape): string {
  return `No one here can get email yet. ${EVENT_NOUN[shape]} who opted out or have no email are left out.`;
}

/** Going guests the Book cannot message until the host reviews a duplicate. */
export function pendingReviewNote(count: number): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? "guest" : "guests"} waiting on a duplicate check in your Book won't get this until you review them.`;
}

/** The composer's hold when the combined quote reaches nobody. */
export const COMBINED_ZERO_REACH_COPY =
  "No one in this audience can receive this. Pick another audience or method.";

