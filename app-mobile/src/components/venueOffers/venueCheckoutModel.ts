/**
 * #4490 Explorer W4 — the venue checkout sheet's pure parts: what each kind
 * sends to `quote` (the choice, never an amount), the guest details check, the
 * Review rows from the server's quote, and the quote / booking refs the
 * reducer keeps. Every amount shown comes from the server's quote or booking
 * (`I-NATIVE-OFFER-CHECKOUT-NO-CLIENT-PRICE`); the deck, Discover and pane
 * "from" prices are never read here.
 */
import { parseEntryQuote, summaryLines, type EntryQuote, type SummaryLine } from "@mingla/brand-rendering/venueOffers/entryModel";
import { parsePayPlan } from "@mingla/brand-rendering/venueOffers/packageModel";
import { parsePlanCharge, type VenuePlanCharge } from "@mingla/brand-rendering/venueFeaturePage";

import type {
  VenueCheckoutBookingRef,
  VenueCheckoutKind,
  VenueCheckoutQuoteRef,
  VenuePayMode,
} from "../../payments/venueOfferCheckoutFlow";

// ─── the choice per kind (what `quote` is asked for) ──────────────────────

export type VenueCheckoutChoice =
  | {
      kind: "entry";
      offeringId: string;
      windowId: string;
      lines: ReadonlyArray<{ priceOptionId: string; guests: number }>;
      /** For the W7 when-line: the venue-local day and "HH:MM" start. */
      day: string;
      time: string | null;
    }
  | {
      kind: "group_package";
      offeringId: string;
      windowId: string;
      priceOptionId: string;
      guests: number;
      extraIds: readonly string[];
      answers: Readonly<Record<string, string>>;
      day: string;
      time: string | null;
    }
  | {
      kind: "private_hire";
      offeringId: string;
      windowId: string;
      priceOptionId: string;
      guests: number;
      layout: string | null;
      extraIds: readonly string[];
      answers: Readonly<Record<string, string | boolean>>;
      day: string;
    }
  | {
      kind: "by_the_hour";
      offeringId: string;
      startsAt: string;
      minutes: number;
      guests: number;
      priceOptionId: string | null;
      day: string;
      time: string | null;
    }
  | { kind: "plan"; planId: string; startOn: string | null };

/** One stable string for a choice: the reducer's step-1 input (rule 2). */
export function choiceFingerprint(choice: VenueCheckoutChoice): string {
  switch (choice.kind) {
    case "entry":
      return `entry|${choice.offeringId}|${choice.windowId}|${[...choice.lines]
        .sort((a, b) => a.priceOptionId.localeCompare(b.priceOptionId))
        .map((l) => `${l.priceOptionId}:${l.guests}`)
        .join(",")}`;
    case "group_package":
      return `group|${choice.offeringId}|${choice.windowId}|${choice.priceOptionId}|${choice.guests}|${[...choice.extraIds].sort().join(",")}|${stableAnswers(choice.answers)}`;
    case "private_hire":
      return `hire|${choice.offeringId}|${choice.windowId}|${choice.priceOptionId}|${choice.guests}|${choice.layout ?? ""}|${[...choice.extraIds].sort().join(",")}|${stableAnswers(choice.answers)}`;
    case "by_the_hour":
      return `hour|${choice.offeringId}|${choice.startsAt}|${choice.minutes}|${choice.guests}|${choice.priceOptionId ?? ""}`;
    case "plan":
      return `plan|${choice.planId}|${choice.startOn ?? "today"}`;
    default: {
      const never: never = choice;
      return never;
    }
  }
}

function stableAnswers(answers: Readonly<Record<string, string | boolean>>): string {
  return Object.keys(answers)
    .sort()
    .map((k) => `${k}=${String(answers[k])}`)
    .join("&");
}

/**
 * The `quote` request body for a choice: the same shape buyer web sends
 * (`venueOfferGuestService.quote` / `packageQuote` / `hireQuote` /
 * `hourQuote`). Ids, counts and answers only: no amount, fee or total.
 */
export function quoteBodyFor(choice: Exclude<VenueCheckoutChoice, { kind: "plan" }>): Record<string, unknown> {
  switch (choice.kind) {
    case "entry":
      return { offeringId: choice.offeringId, windowId: choice.windowId, lines: choice.lines.map((l) => ({ ...l })) };
    case "group_package":
      return {
        offeringId: choice.offeringId,
        windowId: choice.windowId,
        lines: [{ priceOptionId: choice.priceOptionId, guests: choice.guests }],
        extras: choice.extraIds.map((id) => ({ id })),
        answers: { ...choice.answers },
      };
    case "private_hire":
      return {
        offeringId: choice.offeringId,
        windowId: choice.windowId,
        lines: [
          {
            priceOptionId: choice.priceOptionId,
            guests: choice.guests,
            ...(choice.layout !== null ? { layout: choice.layout } : {}),
          },
        ],
        extras: choice.extraIds.map((id) => ({ id })),
        answers: { ...choice.answers },
      };
    case "by_the_hour":
      return {
        offeringId: choice.offeringId,
        startsAt: choice.startsAt,
        minutes: choice.minutes,
        lines: [{ guests: choice.guests, ...(choice.priceOptionId !== null ? { priceOptionId: choice.priceOptionId } : {}) }],
        extras: [],
      };
    default: {
      const never: never = choice;
      return never;
    }
  }
}

// ─── the server's quote → the reducer's ref and the Review rows ──────────

export interface VenueReviewQuote {
  readonly ref: VenueCheckoutQuoteRef;
  readonly quote: EntryQuote;
  /** The server's deposit amount and due date when "Half now" is offered. */
  readonly depositMinor: number | null;
  readonly balanceDueAt: string | null;
  /** Private hire: "request" asks first (no payment). */
  readonly mode: "instant" | "request";
  /**
   * #4490 06-W4 fix 2 (W4-R1): why the server folded the deposit into one
   * payment (the balance date has passed, or the deposit is the whole amount).
   */
  readonly fullNowReason: "deposit_covers_total" | "balance_due_passed" | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Read a `quote` answer for any kind (hire keeps its plan under `hire.payPlan`). Null when it is not one. */
export function parseVenueReviewQuote(raw: unknown): VenueReviewQuote | null {
  const quote = parseEntryQuote(raw);
  if (quote === null || !isObject(raw)) return null;
  const hire = isObject(raw.hire) ? raw.hire : null;
  const plan = parsePayPlan(hire !== null ? hire.payPlan : raw.payPlan);
  const modes: VenuePayMode[] = plan.payModes.includes("deposit") && plan.depositMinor !== null ? ["deposit", "full"] : ["full"];
  return {
    ref: {
      quoteId: quote.quoteId,
      currencyCode: quote.currencyCode,
      totalMinor: quote.totalMinor,
      payModes: modes,
      depositMinor: modes.includes("deposit") ? plan.depositMinor : null,
    },
    quote,
    depositMinor: modes.includes("deposit") ? plan.depositMinor : null,
    balanceDueAt: plan.balanceDueAt,
    mode: hire !== null && raw.mode !== "instant" ? "request" : "instant",
    fullNowReason: modes.includes("deposit") ? null : plan.collapsed,
  };
}

/** The Review card's rows: the shared summary of the server's numbers. */
export function reviewRows(review: VenueReviewQuote, exponent: number, totalLabel = "Total"): SummaryLine[] {
  const q = review.quote;
  return summaryLines(
    q.lines,
    {
      currencyCode: q.currencyCode,
      exponent,
      taxMinor: q.taxMinor,
      feeMinor: q.feeMinor,
      totalMinor: q.totalMinor,
      vatMode: q.vatMode,
      vatRatePct: q.vatRatePct,
    },
    totalLabel,
  );
}

/** What "Pay {total}" says: the deposit for "Half now", else the quote's total. Server numbers only. */
export function payNowMinor(review: VenueReviewQuote, payMode: VenuePayMode | null): number {
  return payMode === "deposit" && review.depositMinor !== null ? review.depositMinor : review.ref.totalMinor;
}

/** A `hold` (or `get`) answer → the reducer's booking ref. Null when it is not a booking. */
export function bookingRefFrom(raw: unknown): VenueCheckoutBookingRef | null {
  if (!isObject(raw)) return null;
  const id = raw.groupId;
  const version = raw.version;
  const state = raw.state;
  if (typeof id !== "string" || typeof state !== "string") return null;
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    id,
    version: typeof version === "number" && Number.isSafeInteger(version) && version > 0 ? version : 1,
    state,
    totalMinor: n(raw.totalMinor),
    amountDueNowMinor: n(raw.amountDueNowMinor),
    holdUntil: typeof raw.holdUntil === "string" ? raw.holdUntil : null,
  };
}

/**
 * #4490 06-W4 fix 1 (W4-N2): the plan's first payment as the server charges
 * it (`paymentDue`: base, VAT, total), from a `membership_join` or
 * `membership_get` answer. Null when nothing is due (a request not yet
 * approved). Never the plan's list price.
 */
export function planDueFrom(raw: unknown): VenuePlanCharge | null {
  return isObject(raw) ? parsePlanCharge(raw.paymentDue) : null;
}

/** The plan's Review rows: the shared summary of the server's charge ("1 × Hot desk", "VAT 7.5%", "Total"). */
export function planReviewRows(due: VenuePlanCharge, planName: string, currencyCode: string, exponent: number): SummaryLine[] {
  return summaryLines(
    [{ name: planName, guests: 1, baseMinor: due.baseMinor, totalMinor: due.baseMinor }],
    {
      currencyCode,
      exponent,
      taxMinor: due.taxMinor,
      feeMinor: due.feeMinor,
      totalMinor: due.totalMinor,
      vatMode: due.vatMode,
      vatRatePct: due.vatRatePct,
    },
  );
}

/**
 * A `membership_join` answer → a booking ref for the plan. #4490 06-W4 fix 1
 * (W4-N2): the amount is the server's amount due (`paymentDue.amountMinor`,
 * VAT included), never the plan's list price; 0 when nothing is due yet.
 */
export function planRefFrom(join: { subscriptionId: string; status: string | null; raw: unknown }): VenueCheckoutBookingRef {
  const raw = isObject(join.raw) ? join.raw : {};
  const dueRaw = isObject(raw.paymentDue) ? raw.paymentDue : null;
  const due = dueRaw !== null && typeof dueRaw.amountMinor === "number" && Number.isSafeInteger(dueRaw.amountMinor) ? dueRaw.amountMinor : 0;
  return {
    id: join.subscriptionId,
    version: 1,
    state: join.status ?? "pending_payment",
    totalMinor: due,
    amountDueNowMinor: due,
    holdUntil: null,
  };
}

// ─── guest details (from the profile, editable, checked before `hold`) ────

export interface VenueGuestDetails {
  name: string;
  email: string;
  /** E.164 or empty. */
  phone: string;
}

export const GUEST_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESERVED_DOMAIN = /(^|\.)(test|invalid|example|localhost|local)$/;

/**
 * The first problem with the guest's details, in the buyer-web words, or
 * null. N139: an address on a reserved test domain is refused in words (the
 * payment page refuses it), the same sentence the order checkout uses.
 */
export function guestDetailsProblem(guest: VenueGuestDetails): { field: "name" | "email" | "phone"; message: string } | null {
  const name = guest.name.trim();
  if (name.length < 1 || name.length > 120) return { field: "name", message: "Add your name." };
  const email = guest.email.trim();
  if (!GUEST_EMAIL_PATTERN.test(email)) return { field: "email", message: "Add a valid email. Your pass is sent there." };
  if (RESERVED_DOMAIN.test(email.toLowerCase().split("@")[1] ?? "")) {
    return {
      field: "email",
      message:
        "Use an email address you can get receipts at. Addresses ending in .test, .invalid, .example or .localhost can't be used.",
    };
  }
  const phone = guest.phone.replace(/[\s()-]/g, "");
  if (phone.length > 0 && !/^\+[1-9]\d{6,14}$/.test(phone)) {
    return { field: "phone", message: "Check the phone number, or leave it empty." };
  }
  return null;
}

/** The `guest` / `member` body: trimmed; phone only when given. */
export function guestBody(guest: VenueGuestDetails): { name: string; email: string; phone?: string } {
  const phone = guest.phone.replace(/[\s()-]/g, "");
  return { name: guest.name.trim(), email: guest.email.trim(), ...(phone.length > 0 ? { phone } : {}) };
}

/** The hold key's guest input (rule 2): new details are a new hold. */
export const guestFingerprint = (guest: VenueGuestDetails): string => {
  const b = guestBody(guest);
  return `${b.name}|${b.email.toLowerCase()}|${b.phone ?? ""}`;
};

// ─── titles per kind (the approved design's sheet titles) ────────────────

export function checkoutTitle(kind: VenueCheckoutKind, venueName: string): string {
  switch (kind) {
    case "entry":
      return "Buy entry";
    case "group_package":
      return "Book for a group";
    case "private_hire":
      return "Ask about a date";
    case "by_the_hour":
      return "Book a room";
    case "plan":
      return `Join ${venueName}`;
    default: {
      const never: never = kind;
      return never;
    }
  }
}

/** "Pay to hold your date" (an approved hire's deposit) / "Pay the rest" (a balance), from Purchases. */
export function resumeTitle(state: string): string {
  return state === "approved_payment_required" ? "Pay to hold your date" : "Pay the rest";
}
