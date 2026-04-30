/**
 * Per-step + publish-gate validation rules for the event creator wizard.
 *
 * Rules grounded in BUSINESS_PRD §U.5.1 required-to-publish list +
 * Cycle 3 spec §4 validation table. Each error returns a fieldKey for
 * inline rendering and a message for the J-E12 errors sheet.
 *
 * NEVER use this util to bypass user-visible field errors — it returns
 * structured error keys for the calling step body to map to component
 * state (red border, helper text). The publish gate uses the same
 * structure to drive the errors sheet's Fix-jump links.
 *
 * Per Cycle 3 spec §3.2.
 */

import type {
  DraftEvent,
  DraftEventStatus,
  TicketStub,
} from "../store/draftEventStore";
import type { BrandStripeStatus } from "../store/currentBrandStore";

export interface ValidationError {
  /** Identifier for the field — drives inline rendering + Fix-jump logic. */
  fieldKey: string;
  /** Step index (0-based) where this field lives. */
  step: number;
  /** Human-readable message for J-E12 errors sheet. */
  message: string;
}

export const validateStep = (
  step: number,
  draft: DraftEvent,
): ValidationError[] => {
  switch (step) {
    case 0:
      return validateBasics(draft);
    case 1:
      return validateWhen(draft);
    case 2:
      return validateWhere(draft);
    case 3:
      return validateCover(draft);
    case 4:
      return validateTickets(draft);
    case 5:
      return validateSettings(draft);
    case 6:
      return [];
    default:
      return [];
  }
};

export const validatePublish = (
  draft: DraftEvent,
  brandStripeStatus: BrandStripeStatus,
): ValidationError[] => {
  const errors: ValidationError[] = [];
  for (let step = 0; step < 7; step++) {
    errors.push(...validateStep(step, draft));
  }
  // Cross-step: any paid ticket → Stripe must be active.
  // Free-only events bypass this gate entirely (spec AC#33 / T-CYCLE-3-23).
  const hasPaidTicket = draft.tickets.some(
    (t) => !t.isFree && (t.priceGbp ?? 0) > 0,
  );
  if (hasPaidTicket && brandStripeStatus !== "active") {
    errors.push({
      fieldKey: "stripeNotConnected",
      step: 4,
      message: "Connect Stripe to publish paid tickets.",
    });
  }
  return errors;
};

const validateBasics = (d: DraftEvent): ValidationError[] => {
  const errs: ValidationError[] = [];
  if (d.name.trim().length === 0) {
    errs.push({ fieldKey: "name", step: 0, message: "Event name is required." });
  }
  if (d.description.trim().length === 0) {
    errs.push({
      fieldKey: "description",
      step: 0,
      message: "Add a short description.",
    });
  }
  if (d.category === null) {
    errs.push({ fieldKey: "category", step: 0, message: "Pick a category." });
  }
  return errs;
};

const validateWhen = (d: DraftEvent): ValidationError[] => {
  const errs: ValidationError[] = [];
  if (d.date === null) {
    errs.push({ fieldKey: "date", step: 1, message: "Set the event date." });
  } else if (parseDateString(d.date) < startOfToday()) {
    errs.push({
      fieldKey: "date",
      step: 1,
      message: "Date can't be in the past.",
    });
  }
  if (d.doorsOpen === null) {
    errs.push({
      fieldKey: "doorsOpen",
      step: 1,
      message: "Set the door-open time.",
    });
  }
  if (d.endsAt === null) {
    errs.push({ fieldKey: "endsAt", step: 1, message: "Set the end time." });
  }
  return errs;
};

const validateWhere = (d: DraftEvent): ValidationError[] => {
  const errs: ValidationError[] = [];
  if (d.format === "in_person" || d.format === "hybrid") {
    if (d.venueName === null || d.venueName.trim().length === 0) {
      errs.push({
        fieldKey: "venueName",
        step: 2,
        message: "Add a venue name.",
      });
    }
    if (d.address === null || d.address.trim().length === 0) {
      errs.push({
        fieldKey: "address",
        step: 2,
        message: "Add the venue address.",
      });
    }
  }
  if (d.format === "online" || d.format === "hybrid") {
    if (d.onlineUrl === null || d.onlineUrl.trim().length === 0) {
      errs.push({
        fieldKey: "onlineUrl",
        step: 2,
        message: "Add the online conferencing link.",
      });
    } else if (!isValidUrl(d.onlineUrl)) {
      errs.push({
        fieldKey: "onlineUrl",
        step: 2,
        message: "Enter a valid link (e.g. https://zoom.us/j/123).",
      });
    }
  }
  return errs;
};

/**
 * URL validation — accepts:
 *   - "https://zoom.us/j/123"     (full HTTPS URL)
 *   - "http://example.com"        (HTTP also OK; some self-hosted)
 *   - "zoom.us/j/123"             (lenient: auto-prepends https://)
 *   - "www.meet.com/abc"          (lenient: auto-prepends https://)
 *
 * Rejects:
 *   - "hello"                     (no domain)
 *   - "abc.def"  with empty path  (depends on tld; we require host has dot)
 *   - "ftp://..."                 (only http/https for conferencing links)
 *   - non-parseable garbage
 *
 * Uses `new URL()` (available on Expo SDK 54 Hermes) for robust parse +
 * a host-shape sanity check (must include a dot — disqualifies single
 * words that happen to be valid hostnames like "localhost").
 */
const isValidUrl = (raw: string): boolean => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  // Lenient: prepend https:// when no protocol specified so users can
  // paste just "zoom.us/j/123" without manually typing the scheme.
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.hostname.length === 0) return false;
    // Require a dot in the hostname so single-word inputs like
    // "garbage" (which would parse as a relative-protocol-prepended
    // URL) get rejected.
    if (!u.hostname.includes(".")) return false;
    return true;
  } catch {
    return false;
  }
};

const validateCover = (_d: DraftEvent): ValidationError[] => {
  // coverHue always set (default 25); always passes.
  return [];
};

const validateTickets = (d: DraftEvent): ValidationError[] => {
  const errs: ValidationError[] = [];
  if (d.tickets.length === 0) {
    errs.push({
      fieldKey: "tickets.empty",
      step: 4,
      message: "Add at least one ticket type.",
    });
    return errs;
  }
  d.tickets.forEach((t: TicketStub, i: number): void => {
    if (t.name.trim().length === 0) {
      errs.push({
        fieldKey: `tickets[${i}].name`,
        step: 4,
        message: `Ticket ${i + 1} needs a name.`,
      });
    }
    if (!t.isFree && (t.priceGbp === null || t.priceGbp <= 0)) {
      errs.push({
        fieldKey: `tickets[${i}].price`,
        step: 4,
        message: `Set a price for ${t.name || `ticket ${i + 1}`}, or mark it free.`,
      });
    }
    if (!t.isUnlimited && (t.capacity === null || t.capacity <= 0)) {
      errs.push({
        fieldKey: `tickets[${i}].capacity`,
        step: 4,
        message: `Set a capacity for ${t.name || `ticket ${i + 1}`}, or mark it unlimited.`,
      });
    }
  });
  return errs;
};

const validateSettings = (_d: DraftEvent): ValidationError[] => {
  // visibility always set (default public); always passes.
  return [];
};

/** Status helper — drives Step 7 status card variant selection. */
export const computePublishability = (
  draft: DraftEvent,
  brandStripeStatus: BrandStripeStatus,
): {
  isReady: boolean;
  hasPaidTickets: boolean;
  needsStripe: boolean;
  errorCount: number;
  status: DraftEventStatus | "ready" | "blocked-stripe" | "blocked-errors";
} => {
  const errors = validatePublish(draft, brandStripeStatus);
  const hasPaidTickets = draft.tickets.some(
    (t) => !t.isFree && (t.priceGbp ?? 0) > 0,
  );
  const stripeError = errors.find((e) => e.fieldKey === "stripeNotConnected");
  const otherErrors = errors.filter((e) => e.fieldKey !== "stripeNotConnected");

  if (otherErrors.length > 0) {
    return {
      isReady: false,
      hasPaidTickets,
      needsStripe: stripeError !== undefined,
      errorCount: otherErrors.length,
      status: "blocked-errors",
    };
  }
  if (stripeError !== undefined) {
    return {
      isReady: false,
      hasPaidTickets,
      needsStripe: true,
      errorCount: 0,
      status: "blocked-stripe",
    };
  }
  return {
    isReady: true,
    hasPaidTickets,
    needsStripe: false,
    errorCount: 0,
    status: "ready",
  };
};

const startOfToday = (): Date => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const parseDateString = (iso: string): Date => {
  // Treat as midnight local time of that date.
  const parts = iso.split("-");
  if (parts.length !== 3) return new Date(iso);
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
};
