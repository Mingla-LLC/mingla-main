/**
 * #4111 — the smart message sheet's topic builder (D5).
 *
 * PURE: no React, no react-native, no network. Explorer (app-mobile) and the
 * business web wrapper both feed it what they already have (the brand's
 * offerings, its claimed venue, the signed-in guest's own plans from
 * `brand_enquiry_my_plans`) and render what it returns. Nothing the brand does
 * not offer is ever shown (Constitution #9): an empty group is dropped.
 *
 * Step 1 groups, in order (only non-empty ones are returned):
 *   plans          "Your plans with {Brand}"   signed-in only
 *   coming_up      "Coming up"                 ≤4 upcoming / happening now (+ See all)
 *   past           "Past"                      last 90 days
 *   venue          "At the venue"              brand has a claimed venue
 *   something_else "Something else"            always
 *
 * Step 2 reasons depend on the pick (`reasonsForPick`). The reason keys are the
 * server's: `issue_4111_reason_label` in
 * supabase/migrations/20271221014111_issue_4111_brand_enquiry_rpcs.sql turns
 * each one into the topic label the brand sees.
 */

export type EnquiryEntry = "brand_page" | "offering" | "calendar" | "cancel_page";

export type EnquiryContextKind =
  | "order"
  | "rsvp"
  | "reservation"
  | "stay"
  | "venue_order"
  | "offering"
  | "venue"
  | "none";

/** One row of `brand_enquiry_my_plans` (camel-cased by the caller). */
export interface EnquiryPlan {
  kind: "order" | "rsvp" | "reservation" | "stay" | "venue_order";
  id: string;
  title: string;
  startsAt: string | null;
  summary: string | null;
  isUpcoming: boolean;
  canCancel: boolean;
  canCancelUrl: string | null;
  canRequestRefund: boolean;
}

export type EnquiryOfferingKind = "event" | "rsvp" | "trip" | "experience" | "stay";

/** An offering the page already loaded. `id` is the events.id / stay offering id. */
export interface EnquiryOffering {
  id: string;
  title: string;
  kind: EnquiryOfferingKind;
  startsAt: string | null;
  endsAt?: string | null;
  /** upcoming and happening-now offerings both count as "coming up". */
  when: "upcoming" | "happening_now" | "past";
  /** Optional refund-policy line ("Refunds up to 7 days before"). */
  refundPolicyLine?: string | null;
}

export interface EnquiryVenue {
  id: string;
  name: string;
  /** Guest food ordering is switched on for this venue. */
  orderingEnabled: boolean;
  /** The venue takes online reservations ("Book now"). */
  reservationsOnline: boolean;
}

export type EnquiryReasonKey =
  | "change_transfer"
  | "refund_cancel"
  | "cant_find_tickets"
  | "access_needs"
  | "something_else"
  | "change_time_party"
  | "cancel"
  | "running_late"
  | "missing_wrong_item"
  | "refund"
  | "bring_guest"
  | "cant_make_it"
  | "question_before_booking"
  | "group_booking"
  | "dates_times"
  | "lost_something"
  | "feedback"
  | "photos_recordings"
  | "itinerary"
  | "payment_deposit"
  | "group_custom_trip"
  | "table_reservation"
  | "private_hire"
  | "food_order"
  | "general_question"
  | "work_with"
  | "other";

export interface EnquiryReason {
  key: EnquiryReasonKey;
  label: string;
}

export type EnquiryGroupKey = "plans" | "coming_up" | "past" | "venue" | "something_else";

export type EnquiryPickShape =
  | "ticket_order"
  | "booking"
  | "food_order"
  | "rsvp"
  | "upcoming_offering"
  | "past_offering"
  | "trip"
  | "table"
  | "direct";

export interface EnquiryPick {
  /** Stable key: `${contextKind}:${contextId}` or `topic:${reason}`. */
  key: string;
  group: EnquiryGroupKey;
  shape: EnquiryPickShape;
  title: string;
  subtitle: string | null;
  /** Icon hint for the row: a plan/offering thumb, or a topic glyph. */
  icon: "plan" | "offering" | "table" | "party" | "food" | "question" | "collab" | "other";
  contextKind: EnquiryContextKind;
  contextId: string | null;
  /** Empty → skip step 2 and write straight away with `directReason`. */
  reasons: EnquiryReason[];
  directReason: EnquiryReasonKey | null;
  plan?: EnquiryPlan;
  offering?: EnquiryOffering;
  venue?: EnquiryVenue;
}

export interface EnquiryGroup {
  key: EnquiryGroupKey;
  title: string;
  picks: EnquiryPick[];
  /** More picks exist than are shown ("See all"). */
  hiddenPicks: EnquiryPick[];
}

export interface BuildEnquiryTopicsInput {
  brandName: string;
  signedIn: boolean;
  plans?: ReadonlyArray<EnquiryPlan>;
  offerings?: ReadonlyArray<EnquiryOffering>;
  venue?: EnquiryVenue | null;
  /** "Work with {Brand}" subline; defaults to "Collabs, press, bookings". */
  workWithSubtitle?: string;
  nowMs?: number;
}

export const COMING_UP_LIMIT = 4;
export const PAST_LIMIT = 4;
const PAST_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

const R = (key: EnquiryReasonKey, label: string): EnquiryReason => ({ key, label });

const TICKET_REASONS: EnquiryReason[] = [
  R("change_transfer", "Change or transfer"),
  R("refund_cancel", "Refund or cancel"),
  R("cant_find_tickets", "Can't find my tickets"),
  R("access_needs", "Access needs"),
  R("something_else", "Something else"),
];
const BOOKING_REASONS: EnquiryReason[] = [
  R("change_time_party", "Change time or party size"),
  R("cancel", "Cancel"),
  R("running_late", "Running late"),
  R("access_needs", "Access needs"),
  R("something_else", "Something else"),
];
const FOOD_REASONS: EnquiryReason[] = [
  R("missing_wrong_item", "Missing or wrong item"),
  R("refund", "Refund"),
  R("something_else", "Something else"),
];
const RSVP_REASONS: EnquiryReason[] = [
  R("bring_guest", "Bring a guest"),
  R("cant_make_it", "Can't make it"),
  R("access_needs", "Access needs"),
  R("something_else", "Something else"),
];
const UPCOMING_REASONS: EnquiryReason[] = [
  R("question_before_booking", "Question before I book"),
  R("group_booking", "Group booking"),
  R("access_needs", "Access needs"),
  R("dates_times", "Dates and times"),
  R("something_else", "Something else"),
];
const PAST_REASONS: EnquiryReason[] = [
  R("lost_something", "Lost something"),
  R("feedback", "Feedback"),
  R("photos_recordings", "Photos or recordings"),
  R("refund", "Refund"),
  R("something_else", "Something else"),
];
const TRIP_REASONS: EnquiryReason[] = [
  R("itinerary", "Itinerary"),
  R("payment_deposit", "Payment or deposit"),
  R("group_custom_trip", "Group or custom trip"),
  R("something_else", "Something else"),
];

/** Step 2 reasons for a pick shape. `table` and `direct` have none. */
export const reasonsForShape = (shape: EnquiryPickShape): EnquiryReason[] => {
  switch (shape) {
    case "ticket_order":
      return TICKET_REASONS;
    case "booking":
      return BOOKING_REASONS;
    case "food_order":
      return FOOD_REASONS;
    case "rsvp":
      return RSVP_REASONS;
    case "upcoming_offering":
      return UPCOMING_REASONS;
    case "past_offering":
      return PAST_REASONS;
    case "trip":
      return TRIP_REASONS;
    case "table":
    case "direct":
      return [];
    default: {
      const never: never = shape;
      return never;
    }
  }
};

export const reasonsForPick = (pick: EnquiryPick): EnquiryReason[] => reasonsForShape(pick.shape);

const SHORT_DATE: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };

/** "Sat 8 Nov" — empty string when there is no usable date. */
export const enquiryDateLabel = (iso: string | null | undefined): string => {
  if (iso === null || iso === undefined) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  try {
    return new Date(ms).toLocaleDateString("en-GB", SHORT_DATE).replace(/,/g, "");
  } catch {
    return "";
  }
};

const OFFERING_KIND_LABEL: Record<EnquiryOfferingKind, string> = {
  event: "Event",
  rsvp: "RSVP",
  trip: "Trip",
  experience: "Experience",
  stay: "Stay",
};

const joinParts = (parts: Array<string | null | undefined>): string | null => {
  const kept = parts.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  return kept.length > 0 ? kept.join(" · ") : null;
};

const planShape = (plan: EnquiryPlan): EnquiryPickShape => {
  switch (plan.kind) {
    case "order":
      return "ticket_order";
    case "reservation":
    case "stay":
      return "booking";
    case "venue_order":
      return "food_order";
    case "rsvp":
      return "rsvp";
    default: {
      const never: never = plan.kind;
      return never;
    }
  }
};

export const planPick = (plan: EnquiryPlan): EnquiryPick => {
  const shape = planShape(plan);
  return {
    key: `${plan.kind}:${plan.id}`,
    group: "plans",
    shape,
    title: plan.title,
    subtitle: joinParts([enquiryDateLabel(plan.startsAt), plan.summary]),
    icon: "plan",
    contextKind: plan.kind,
    contextId: plan.id,
    reasons: reasonsForShape(shape),
    directReason: null,
    plan,
  };
};

export const offeringPick = (offering: EnquiryOffering): EnquiryPick => {
  const past = offering.when === "past";
  const shape: EnquiryPickShape = past
    ? "past_offering"
    : offering.kind === "trip"
      ? "trip"
      : "upcoming_offering";
  return {
    key: `offering:${offering.id}`,
    group: past ? "past" : "coming_up",
    shape,
    title: offering.title,
    subtitle: joinParts([
      offering.when === "happening_now" ? "Happening now" : enquiryDateLabel(offering.startsAt),
      OFFERING_KIND_LABEL[offering.kind],
    ]),
    icon: "offering",
    contextKind: "offering",
    contextId: offering.id,
    reasons: reasonsForShape(shape),
    directReason: null,
    offering,
  };
};

const topicPick = (
  group: EnquiryGroupKey,
  reason: EnquiryReasonKey,
  title: string,
  subtitle: string | null,
  icon: EnquiryPick["icon"],
  venue: EnquiryVenue | null,
): EnquiryPick => {
  const shape: EnquiryPickShape = reason === "table_reservation" ? "table" : "direct";
  return {
    key: `topic:${reason}`,
    group,
    shape,
    title,
    subtitle,
    icon,
    contextKind: venue === null ? "none" : "venue",
    contextId: venue === null ? null : venue.id,
    reasons: [],
    directReason: reason,
    venue: venue ?? undefined,
  };
};

const startMs = (iso: string | null | undefined): number => {
  const ms = iso === null || iso === undefined ? Number.NaN : Date.parse(iso);
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
};

/** The step 1 groups, in order, non-empty only. */
export const buildEnquiryTopicGroups = (input: BuildEnquiryTopicsInput): EnquiryGroup[] => {
  const brandName = input.brandName.trim().length > 0 ? input.brandName.trim() : "this brand";
  const nowMs = input.nowMs ?? Date.now();
  const groups: EnquiryGroup[] = [];
  const seen = new Set<string>();
  const firstSeen = (pick: EnquiryPick): boolean => {
    if (seen.has(pick.key)) return false;
    seen.add(pick.key);
    return true;
  };

  if (input.signedIn && (input.plans?.length ?? 0) > 0) {
    // brand_enquiry_my_plans already orders: upcoming first (soonest), then past.
    const picks = (input.plans ?? []).map(planPick);
    picks.forEach((p) => seen.add(p.key));
    groups.push({ key: "plans", title: `Your plans with ${brandName}`, picks, hiddenPicks: [] });
  }

  const offerings = input.offerings ?? [];
  const comingUp = offerings
    .filter((o) => o.when !== "past")
    .slice()
    .sort((a, b) => {
      // Happening now first, then soonest.
      const rank = (o: EnquiryOffering): number => (o.when === "happening_now" ? 0 : 1);
      return rank(a) - rank(b) || startMs(a.startsAt) - startMs(b.startsAt) || a.id.localeCompare(b.id);
    })
    .map(offeringPick)
    .filter(firstSeen);
  if (comingUp.length > 0) {
    groups.push({
      key: "coming_up",
      title: "Coming up",
      picks: comingUp.slice(0, COMING_UP_LIMIT),
      hiddenPicks: comingUp.slice(COMING_UP_LIMIT),
    });
  }

  const past = offerings
    .filter((o) => {
      if (o.when !== "past") return false;
      const endMs = Date.parse(o.endsAt ?? o.startsAt ?? "");
      // No date at all: keep (the page said it is past). Older than 90 days: drop.
      return !Number.isFinite(endMs) || nowMs - endMs <= PAST_WINDOW_MS;
    })
    .slice()
    .sort((a, b) => {
      const end = (o: EnquiryOffering): number => {
        const ms = Date.parse(o.endsAt ?? o.startsAt ?? "");
        return Number.isFinite(ms) ? ms : 0;
      };
      return end(b) - end(a) || a.id.localeCompare(b.id);
    })
    .map(offeringPick)
    .filter(firstSeen);
  if (past.length > 0) {
    groups.push({
      key: "past",
      title: "Past",
      picks: past.slice(0, PAST_LIMIT),
      hiddenPicks: past.slice(PAST_LIMIT),
    });
  }

  const venue = input.venue ?? null;
  if (venue !== null) {
    const picks: EnquiryPick[] = [
      topicPick("venue", "table_reservation", "Table or reservation", "Book or ask about a table", "table", venue),
      topicPick("venue", "private_hire", "Private hire or big group", "Birthdays, parties, takeovers", "party", venue),
    ];
    if (venue.orderingEnabled) {
      picks.push(topicPick("venue", "food_order", "Food order", "Ask about an order", "food", venue));
    }
    groups.push({ key: "venue", title: "At the venue", picks, hiddenPicks: [] });
  }

  groups.push({
    key: "something_else",
    title: "Something else",
    picks: [
      topicPick("something_else", "general_question", "General question", "Anything else", "question", null),
      topicPick(
        "something_else",
        "work_with",
        `Work with ${brandName}`,
        input.workWithSubtitle ?? "Collabs, press, bookings",
        "collab",
        null,
      ),
      topicPick("something_else", "other", "Other", null, "other", null),
    ],
    hiddenPicks: [],
  });

  return groups;
};

/** Every pick across the groups, shown or behind "See all". */
export const allEnquiryPicks = (groups: ReadonlyArray<EnquiryGroup>): EnquiryPick[] =>
  groups.flatMap((g) => [...g.picks, ...g.hiddenPicks]);

/**
 * An entry point's prefill (an offering page, a calendar plan, the cancel
 * page). The pick is found in the groups when it is there; otherwise it is
 * built from the descriptor so the sheet can still open at step 2.
 */
export interface EnquiryPrefill {
  contextKind: EnquiryContextKind;
  contextId: string;
  /** Used when the pick is not already in the groups. */
  offering?: EnquiryOffering;
  plan?: EnquiryPlan;
  /** Optional reason to preselect at step 2 (cancel page → "cancel"). */
  reason?: EnquiryReasonKey;
}

export const resolveEnquiryPrefill = (
  groups: ReadonlyArray<EnquiryGroup>,
  prefill: EnquiryPrefill | null | undefined,
): EnquiryPick | null => {
  if (prefill === null || prefill === undefined) return null;
  const found = allEnquiryPicks(groups).find(
    (p) => p.contextKind === prefill.contextKind && p.contextId === prefill.contextId,
  );
  if (found !== undefined) return found;
  if (prefill.plan !== undefined && prefill.plan.id === prefill.contextId) return planPick(prefill.plan);
  if (prefill.offering !== undefined && prefill.offering.id === prefill.contextId) {
    return offeringPick(prefill.offering);
  }
  return null;
};

/** Self-serve fix shown before writing (design table "Self-serve shown first"). */
export type EnquirySelfServe =
  | { kind: "find_tickets" }
  | { kind: "refund_policy"; line: string }
  | { kind: "cancel_self"; url: string | null }
  | { kind: "request_refund" }
  | { kind: "book_table" };

export const selfServeFor = (
  pick: EnquiryPick,
  reason: EnquiryReasonKey | null,
): EnquirySelfServe | null => {
  if (pick.shape === "table") {
    return pick.venue?.reservationsOnline === true ? { kind: "book_table" } : null;
  }
  if (reason === null) return null;
  if (pick.shape === "ticket_order") {
    if (reason === "cant_find_tickets") return { kind: "find_tickets" };
    const line = pick.offering?.refundPolicyLine;
    if (reason === "refund_cancel" && typeof line === "string" && line.trim().length > 0) {
      return { kind: "refund_policy", line: line.trim() };
    }
    return null;
  }
  if (pick.shape === "booking" && reason === "cancel" && pick.plan?.canCancel === true) {
    return { kind: "cancel_self", url: pick.plan.canCancelUrl };
  }
  if (pick.shape === "food_order" && reason === "refund" && pick.plan?.canRequestRefund === true) {
    return { kind: "request_refund" };
  }
  return null;
};

/** The reason that is sent for a pick + chosen chip. */
export const sendReasonFor = (
  pick: EnquiryPick,
  chosen: EnquiryReasonKey | null,
): EnquiryReasonKey | null => (pick.reasons.length === 0 ? pick.directReason : chosen);

export const ENQUIRY_BODY_MIN = 10;
export const ENQUIRY_BODY_MAX = 2000;
export const ENQUIRY_NAME_MAX = 80;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface TableRequestDetails {
  date?: string;
  time?: string;
  partySize?: string;
}

/**
 * The text the brand receives. A table request's optional date, time and party
 * size ride at the top of the message so the host sees them without opening
 * anything (design table: "The requested date, time and size").
 */
export const composeEnquiryBody = (message: string, table?: TableRequestDetails | null): string => {
  const trimmed = message.trim();
  if (table === null || table === undefined) return trimmed;
  const lines = [
    table.date?.trim() ? `Date: ${table.date.trim()}` : null,
    table.time?.trim() ? `Time: ${table.time.trim()}` : null,
    table.partySize?.trim() ? `Party size: ${table.partySize.trim()}` : null,
  ].filter((l): l is string => l !== null);
  return lines.length > 0 ? `${lines.join("\n")}\n\n${trimmed}` : trimmed;
};

export type EnquiryDraftError = "body_short" | "body_long" | "name" | "email" | "phone";

export interface EnquiryDraftInput {
  body: string;
  signedIn: boolean;
  name?: string;
  email?: string;
  /** Entered but not a valid number. */
  phoneInvalid?: boolean;
}

export const validateEnquiryDraft = (input: EnquiryDraftInput): EnquiryDraftError[] => {
  const errors: EnquiryDraftError[] = [];
  const body = input.body.trim();
  if (body.length < ENQUIRY_BODY_MIN) errors.push("body_short");
  if (body.length > ENQUIRY_BODY_MAX) errors.push("body_long");
  if (!input.signedIn) {
    const name = (input.name ?? "").trim();
    if (name.length < 1 || name.length > ENQUIRY_NAME_MAX) errors.push("name");
    if (!EMAIL_RE.test((input.email ?? "").trim())) errors.push("email");
    if (input.phoneInvalid === true) errors.push("phone");
  }
  return errors;
};

/** What the host transport sends. Signed-out callers never attach a plan. */
export interface EnquirySendRequest {
  entry: EnquiryEntry;
  contextKind: EnquiryContextKind;
  contextId: string | null;
  reason: EnquiryReasonKey;
  body: string;
  guest: {
    name: string;
    email: string;
    phoneE164: string | null;
    okToCall: boolean;
  } | null;
  /** Honeypot value (must stay empty) and form-open time, for signed-out sends. */
  hp: string;
  t0: number;
}

export type EnquirySendOutcome =
  | { ok: true; email: string | null; threadUrl: string | null; conversationId: string | null }
  | { ok: false; message: string };

/** Signed-out web can attach only an offering or venue (the server enforces it). */
export const ANON_CONTEXT_KINDS: ReadonlyArray<EnquiryContextKind> = ["offering", "venue", "none"];

/** "Usually replies within …" — null hides the line. */
export const replyTimeLabel = (minutes: number | null | undefined): string | null => {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes <= 60) return "Usually replies within an hour";
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `Usually replies within ${hours} hours`;
  const days = Math.ceil(hours / 24);
  return days <= 1 ? "Usually replies within a day" : `Usually replies within ${days} days`;
};
