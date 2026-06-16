/**
 * ORCH-1150 — RSVP-event validator (forked from draftEventValidation).
 *
 * Do NOT reuse validateTickets / validatePublish — they block at 0 tickets and
 * loop the Tickets step. An RSVP has ZERO tickets + NO money gate. This fork:
 *   - reuses the EXISTING validateBasics (keeps the party-type gate, steering #2)
 *   - single-date When only (steering #4 — no recurring/multi_date)
 *   - Where requires venue+address but NOT a structured city (freeform location)
 *   - RSVP-setup + Cover + Preview have no required fields
 *
 * ORCH-1150: do NOT merge back into the event/ticket validator — RSVP has zero
 * tickets + no Stripe gate. See SPEC §4.7.
 */

import type { DraftEvent } from "../store/draftEventStore";
import { validateBasics, type ValidationError } from "./draftEventValidation";

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

const isValidUrl = (raw: string): boolean => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
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

/** Single-date only (steering #4). Mirrors validateWhenSingle. */
const validateRsvpWhen = (d: DraftEvent): ValidationError[] => {
  const errs: ValidationError[] = [];
  if (d.date === null) {
    errs.push({ fieldKey: "date", step: 1, message: "Set the event date." });
  } else if (parseDateString(d.date) < startOfToday()) {
    errs.push({ fieldKey: "date", step: 1, message: "Date can't be in the past." });
  }
  if (d.doorsOpen === null) {
    errs.push({ fieldKey: "doorsOpen", step: 1, message: "Set the start time." });
  }
  if (d.endsAt === null) {
    errs.push({ fieldKey: "endsAt", step: 1, message: "Set the end time." });
  }
  return errs;
};

/**
 * Where — venue + address required for in_person/hybrid (NO structured-city
 * gate; freeform location is accepted for a house party). Online URL rule kept.
 */
const validateRsvpWhere = (d: DraftEvent): ValidationError[] => {
  const errs: ValidationError[] = [];
  if (d.format === "in_person" || d.format === "hybrid") {
    if (d.venueName === null || d.venueName.trim().length === 0) {
      errs.push({ fieldKey: "venueName", step: 2, message: "Add a venue name." });
    }
    if (d.address === null || d.address.trim().length === 0) {
      errs.push({ fieldKey: "address", step: 2, message: "Add the location." });
    }
    // NO city_required — RSVP accepts freeform text (steering / walkthrough §3).
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

export const validateRsvpStep = (
  step: number,
  draft: DraftEvent,
): ValidationError[] => {
  switch (step) {
    case 0:
      return validateBasics(draft); // KEEP party-type gate (steering #2)
    case 1:
      return validateRsvpWhen(draft); // single-mode only
    case 2:
      return validateRsvpWhere(draft); // venue+address, NO structured-city gate
    case 3:
      return []; // Cover — no rules
    case 4:
      return []; // RSVP setup — no ≥1 requirement (steering #3)
    case 5:
      return []; // Preview
    default:
      return [];
  }
};

export const validateRsvpPublish = (draft: DraftEvent): ValidationError[] => {
  const errors: ValidationError[] = [];
  for (let step = 0; step <= 4; step++) {
    errors.push(...validateRsvpStep(step, draft));
  }
  // NO stripe/paid cross-step gate (RSVP is moneyless).
  return errors;
};
