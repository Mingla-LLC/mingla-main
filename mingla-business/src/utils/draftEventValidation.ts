/**
 * Per-step + publish-gate validation rules for the event creator wizard.
 *
 * Rules grounded in BUSINESS_PRD §U.5.1 + Cycle 3 spec §4 + Cycle 4 spec
 * §3.2 (recurring + multi-date branches).
 *
 * Each error returns a fieldKey for inline rendering and a message for
 * the J-E12 errors sheet. NEVER use this util to bypass user-visible
 * field errors — it returns structured error keys for the calling step
 * body to map to component state (red border, helper text). The publish
 * gate uses the same structure to drive the errors sheet's Fix-jump links.
 */

import type {
  DraftEvent,
  DraftEventStatus,
  TicketStub,
  RecurrenceRule,
} from "../store/draftEventStore";
import type { BrandStripeStatus } from "../store/currentBrandStore";
import { weekdayOfIso, formatWeekdayLong } from "./recurrenceRule";

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
  // Free-only events bypass this gate (spec AC#33).
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

// ---- Step 2 — When (mode-branched) ----------------------------------

const validateWhen = (d: DraftEvent): ValidationError[] => {
  switch (d.whenMode) {
    case "single":
      return validateWhenSingle(d);
    case "recurring":
      return validateWhenRecurring(d);
    case "multi_date":
      return validateWhenMultiDate(d);
  }
};

const validateWhenSingle = (d: DraftEvent): ValidationError[] => {
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

const validateWhenRecurring = (d: DraftEvent): ValidationError[] => {
  const errs: ValidationError[] = [];
  // First occurrence shares the parent date/doors/ends fields.
  if (d.date === null) {
    errs.push({
      fieldKey: "date",
      step: 1,
      message: "Set the first occurrence date.",
    });
  } else if (parseDateString(d.date) < startOfToday()) {
    errs.push({
      fieldKey: "date",
      step: 1,
      message: "First occurrence can't be in the past.",
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
  // Recurrence rule
  if (d.recurrenceRule === null) {
    errs.push({
      fieldKey: "recurrence",
      step: 1,
      message: "Pick a repeat pattern.",
    });
  } else {
    errs.push(...validateRecurrenceRule(d.recurrenceRule, d.date));
  }
  return errs;
};

const validateRecurrenceRule = (
  r: RecurrenceRule,
  firstDateIso: string | null,
): ValidationError[] => {
  const errs: ValidationError[] = [];
  // Preset-specific param checks
  if (
    (r.preset === "weekly" || r.preset === "biweekly" || r.preset === "monthly_dow") &&
    r.byDay === undefined
  ) {
    errs.push({
      fieldKey: "recurrence.byDay",
      step: 1,
      message: "Pick a day of the week.",
    });
  }
  if (
    r.preset === "monthly_dom" &&
    (r.byMonthDay === undefined || r.byMonthDay < 1 || r.byMonthDay > 28)
  ) {
    errs.push({
      fieldKey: "recurrence.byMonthDay",
      step: 1,
      message: "Pick a valid day (1–28).",
    });
  }
  if (r.preset === "monthly_dow" && r.bySetPos === undefined) {
    errs.push({
      fieldKey: "recurrence.bySetPos",
      step: 1,
      message: "Pick which week (1st, 2nd, etc.).",
    });
  }
  // Day-of-week mismatch check (REVISED 2026-04-30 — replaces auto-snap UX).
  // When byDay is set AND firstDate is set, the first occurrence's actual
  // weekday MUST match. User fixes manually (no silent snap).
  if (
    (r.preset === "weekly" ||
      r.preset === "biweekly" ||
      r.preset === "monthly_dow") &&
    r.byDay !== undefined &&
    firstDateIso !== null
  ) {
    const dowOfDate = weekdayOfIso(firstDateIso);
    if (dowOfDate !== r.byDay) {
      errs.push({
        fieldKey: "recurrence.dayMismatch",
        step: 1,
        message: `First occurrence is ${formatWeekdayLong(dowOfDate)} but pattern is ${formatWeekdayLong(r.byDay)}. Pick a matching date or change the day.`,
      });
    }
  }
  // Termination check
  if (r.termination.kind === "count") {
    if (
      !Number.isFinite(r.termination.count) ||
      r.termination.count < 1 ||
      r.termination.count > 52
    ) {
      errs.push({
        fieldKey: "recurrence.count",
        step: 1,
        message: "Number of occurrences must be 1–52.",
      });
    }
  } else {
    // until kind
    const untilDate = parseDateString(r.termination.until);
    if (firstDateIso !== null) {
      const firstDate = parseDateString(firstDateIso);
      if (untilDate <= firstDate) {
        errs.push({
          fieldKey: "recurrence.until",
          step: 1,
          message: "End date must be after the first occurrence.",
        });
      }
    }
    const oneYearOut = new Date();
    oneYearOut.setFullYear(oneYearOut.getFullYear() + 1);
    if (untilDate > oneYearOut) {
      errs.push({
        fieldKey: "recurrence.until",
        step: 1,
        message: "End date can't be more than 1 year out.",
      });
    }
  }
  return errs;
};

const validateWhenMultiDate = (d: DraftEvent): ValidationError[] => {
  const errs: ValidationError[] = [];
  const dates = d.multiDates ?? [];
  if (dates.length < 2) {
    errs.push({
      fieldKey: "multiDates.minCount",
      step: 1,
      message: "Add at least 2 dates.",
    });
    return errs;
  }
  if (dates.length > 24) {
    errs.push({
      fieldKey: "multiDates.maxCount",
      step: 1,
      message: "Maximum is 24 dates.",
    });
    return errs;
  }
  // No past dates
  const today = startOfToday();
  for (let i = 0; i < dates.length; i++) {
    const e = dates[i];
    if (parseDateString(e.date) < today) {
      errs.push({
        fieldKey: `multiDates[${i}].date`,
        step: 1,
        message: `Date ${i + 1} (${e.date}) is in the past.`,
      });
    }
  }
  // No duplicate date+startTime
  const seen = new Set<string>();
  for (let i = 0; i < dates.length; i++) {
    const key = `${dates[i].date}T${dates[i].startTime}`;
    if (seen.has(key)) {
      errs.push({
        fieldKey: `multiDates[${i}].duplicate`,
        step: 1,
        message: `Date ${i + 1} duplicates an earlier date+time. Remove or change it.`,
      });
    }
    seen.add(key);
  }
  return errs;
};

// ---- Step 3 — Where -------------------------------------------------

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
 * Rejects: single-word inputs, ftp://, garbage.
 */
const isValidUrl = (raw: string): boolean => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.hostname.length === 0) return false;
    if (!u.hostname.includes(".")) return false;
    return true;
  } catch {
    return false;
  }
};

const validateCover = (_d: DraftEvent): ValidationError[] => {
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
    const label = t.name.length > 0 ? t.name : `ticket ${i + 1}`;
    // Existing v3 rules
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
        message: `Set a price for ${label}, or mark it free.`,
      });
    }
    if (!t.isUnlimited && (t.capacity === null || t.capacity <= 0)) {
      errs.push({
        fieldKey: `tickets[${i}].capacity`,
        step: 4,
        message: `Set a capacity for ${label}, or mark it unlimited.`,
      });
    }
    // Cycle 5 (v4) rules — modifier validation
    if (
      t.passwordProtected &&
      (t.password === null || t.password.length < 4)
    ) {
      errs.push({
        fieldKey: `tickets[${i}].password`,
        step: 4,
        message: "Password must be at least 4 characters.",
      });
    }
    if (t.waitlistEnabled && t.isUnlimited) {
      errs.push({
        fieldKey: `tickets[${i}].waitlistConflict`,
        step: 4,
        message: "Unlimited tickets don't need a waitlist — turn one off.",
      });
    }
    if (t.minPurchaseQty < 1) {
      errs.push({
        fieldKey: `tickets[${i}].minPurchaseQty`,
        step: 4,
        message: "Minimum purchase must be at least 1.",
      });
    }
    if (
      t.maxPurchaseQty !== null &&
      t.maxPurchaseQty < t.minPurchaseQty
    ) {
      errs.push({
        fieldKey: `tickets[${i}].maxPurchaseQty`,
        step: 4,
        message: "Maximum can't be less than minimum.",
      });
    }
  });
  return errs;
};

const validateSettings = (_d: DraftEvent): ValidationError[] => {
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
  const parts = iso.split("-");
  if (parts.length !== 3) return new Date(iso);
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
};
