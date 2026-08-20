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
import {
  PARTY_TYPE_SLUGS,
  VIBE_TAG_SLUGS,
  MUSIC_GENRE_SLUGS,
} from "../constants/eventTaxonomy";

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
  /**
   * ORCH-1052: when the caller is a flagged Mingla partner who hasn't yet
   * connected their PARTNER Stripe identity, the publish gate also surfaces
   * "Connect partner Stripe to receive partner earnings". One screen, one
   * ask — partner gate bundles next to the brand gate (step 4).
   */
  partnerStripeGate?: {
    partnerEnabled: boolean;
    partnerStripeConnected: boolean;
  },
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
      message: "Connect a bank to publish paid tickets.",
    });
  }
  // ORCH-1052 partner money-gate bundle: same screen, additive ask.
  if (
    hasPaidTicket &&
    partnerStripeGate?.partnerEnabled === true &&
    partnerStripeGate.partnerStripeConnected !== true
  ) {
    errors.push({
      fieldKey: "partnerStripeNotConnected",
      step: 4,
      message: "Connect partner bank to receive partner earnings.",
    });
  }
  return errors;
};

// ORCH-1150: exported so the forked RSVP validator (draftRsvpValidation.ts)
// reuses the SAME party-type gate (steering #2 — KEEP Party Type for RSVP).
// This is the ONLY change to this file; the event path is byte-identical.
export const validateBasics = (d: DraftEvent): ValidationError[] => {
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
  // ORCH-0824: party types required (at least one); replaces the
  // deprecated single-select `category` field.
  if (d.partyTypes.length === 0) {
    errs.push({
      fieldKey: "partyTypes",
      step: 0,
      message: "Pick at least one party type.",
    });
  } else if (!d.partyTypes.every((s) => (PARTY_TYPE_SLUGS as readonly string[]).includes(s))) {
    // Defensive: persisted drafts from older builds with stale slugs.
    errs.push({
      fieldKey: "partyTypes",
      step: 0,
      message: "One of the selected party types is no longer supported. Pick again.",
    });
  }
  // Vibe tags and music genres are optional, but if present must be canonical.
  if (
    d.vibeTags.length > 0 &&
    !d.vibeTags.every((s) => (VIBE_TAG_SLUGS as readonly string[]).includes(s))
  ) {
    errs.push({
      fieldKey: "vibeTags",
      step: 0,
      message: "One of the selected vibes is no longer supported. Pick again.",
    });
  }
  if (
    d.musicGenres.length > 0 &&
    !d.musicGenres.every((s) => (MUSIC_GENRE_SLUGS as readonly string[]).includes(s))
  ) {
    errs.push({
      fieldKey: "musicGenres",
      step: 0,
      message: "One of the selected music genres is no longer supported. Pick again.",
    });
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
  } else if (r.termination.kind === "never") {
    // META-ORCH-1059 — open-ended recurrence: nothing to validate. The master
    // occurrence (first date) is the only materialised date; the rule repeats.
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
    } else if (d.city === null || d.city.trim().length === 0) {
      // ORCH-0824: address must be picked from Google Places autocomplete
      // so that `city` is structured and indexable for Discover filtering.
      // Typing free-text without picking a suggestion leaves city null.
      errs.push({
        fieldKey: "address",
        step: 2,
        message: "Pick the venue address from the suggestions.",
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
    } else if (isMapLocationUrl(d.onlineUrl)) {
      // issue #2333 — the reporting customer set format=Online and pasted
      // `https://maps.app.goo.gl/Qr8MotQCkTcSw7bp8?g_st=ic`, a Google Maps VENUE PIN,
      // into the conferencing-link field, because Online was the only branch offering
      // a link field. `isValidUrl` accepted it — it is a URL validator doing duty as a
      // conferencing-link validator, and any http(s) host with a dot passes. His
      // exhibition is physical; the `city_required` publish failure was the
      // second-order symptom of THIS first-order UX failure.
      //
      // fieldKey/step are unchanged: the Where step is wizard index 2, while the
      // format chips live on Step 1 (index 0). The copy therefore names Step 1 in
      // words rather than jumping there — jumping backwards past the step the host is
      // standing on would lose their place.
      const formatFix =
        d.format === "hybrid"
          ? "switch to In person and add the venue address"
          : "go back to Step 1 and choose In person or Hybrid";
      errs.push({
        fieldKey: "onlineUrl",
        step: 2,
        message: `That's a map location, not a joining link. If this event happens at a venue, ${formatFix}.`,
      });
    }
  }
  return errs;
};

/**
 * issue #2333 — hosts that serve MAP/PLACE links and are therefore never a
 * conferencing link.
 *
 * Seth's decision (OQ-2, 2026-08-19): block KNOWN MAP HOSTS ONLY. This is
 * deliberately NOT an allow-list of video providers — an allow-list silently rejects
 * self-hosted and regional tools we did not anticipate, trading this dead end for a
 * new one. Denying a map host is the one case where the input is PROVABLY not a
 * joining link, so it is the only case we act on.
 *
 * Matched on the parsed hostname (exact, or any subdomain of), never on a substring
 * of the raw string — a substring test would reject
 * `https://meet.example.com/google.com/maps-review` and similar innocent paths.
 * `goo.gl` and `google.<tld>` additionally require a `/maps` path prefix, because
 * those hosts serve far more than maps.
 */
const MAP_HOST_SUFFIXES: readonly string[] = [
  "maps.app.goo.gl",
  "maps.google.com",
  "maps.apple.com",
  "mapy.cz",
  "openstreetmap.org",
  "waze.com",
  "what3words.com",
  "w3w.co",
];

/** Hosts that are only a map link when the PATH says so. */
const MAP_PATH_HOSTS: readonly string[] = ["goo.gl", "google.com"];

const isMapLocationUrl = (raw: string): boolean => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let host: string;
  let path: string;
  try {
    const u = new URL(candidate);
    host = u.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
    path = u.pathname.toLowerCase();
  } catch {
    return false;
  }
  const matchesHost = (suffix: string): boolean =>
    host === suffix || host.endsWith(`.${suffix}`);

  if (MAP_HOST_SUFFIXES.some(matchesHost)) return true;

  // `maps.google.<regional-tld>` is itself a Maps host even when the path is `/`.
  // The broader `google.<tld>` family below still requires a `/maps` path so a
  // regular Google link is never mistaken for a joining-link error.
  if (/^maps\.google\.[a-z.]{2,}$/.test(host)) return true;

  // `google.*` covers every regional TLD (google.co.uk, google.com.ng, …) plus the
  // `maps.` subdomain already caught above. Only a /maps path counts.
  const isGoogleHost =
    MAP_PATH_HOSTS.some(matchesHost) || /(^|\.)google\.[a-z.]{2,}$/.test(host);
  if (isGoogleHost && (path === "/maps" || path.startsWith("/maps/"))) {
    return true;
  }
  return false;
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
      t.passwordConfigured !== true &&
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
