/**
 * issue #3645 — a server refusal of an RSVP write because chip-ins are on and
 * the brand cannot collect is never shown as a connection problem.
 *
 * `supabase.rpc()` rejects with a PostgREST PLAIN OBJECT, so the reader must
 * work on that shape as well as on an Error and a string.
 */

import { describe, expect, test } from "@jest/globals";

import {
  RSVP_CHIP_IN_SAVE_REFUSED_COPY,
  RSVP_DRAFT_SAVE_FAILED_COPY,
  isRsvpChipInBankRefusal,
  rsvpDraftSaveFailureCopy,
} from "../rsvpChipInBankRefusal";

const postgrest = (message: string, code: string): Record<string, unknown> => ({
  message,
  code,
  details: null,
  hint: null,
});

describe("#3645 isRsvpChipInBankRefusal", () => {
  test("reads the token off a PostgREST plain object", () => {
    expect(isRsvpChipInBankRefusal(postgrest("stripe_charges_disabled", "42501"))).toBe(true);
    expect(isRsvpChipInBankRefusal(postgrest("P0001: stripe_charges_disabled", "P0001"))).toBe(true);
  });

  test("reads it off an Error and a bare string too", () => {
    expect(isRsvpChipInBankRefusal(new Error("stripe_charges_disabled"))).toBe(true);
    expect(isRsvpChipInBankRefusal("stripe_charges_disabled")).toBe(true);
  });

  test("anything else is not this refusal", () => {
    expect(isRsvpChipInBankRefusal(postgrest("rsvp_revision_conflict", "40001"))).toBe(false);
    expect(isRsvpChipInBankRefusal(new Error("Network request failed"))).toBe(false);
    expect(isRsvpChipInBankRefusal({})).toBe(false);
    expect(isRsvpChipInBankRefusal(null)).toBe(false);
    expect(isRsvpChipInBankRefusal(undefined)).toBe(false);
  });
});

describe("#3645 rsvpDraftSaveFailureCopy", () => {
  test("the refusal gets the true reason, not 'check your connection'", () => {
    const copy = rsvpDraftSaveFailureCopy(postgrest("stripe_charges_disabled", "42501"));
    expect(copy).toBe(RSVP_CHIP_IN_SAVE_REFUSED_COPY);
    expect(copy.toLowerCase()).not.toContain("connection");
    expect(copy).not.toContain("[object");
    expect(copy).not.toContain("stripe_charges_disabled");
  });

  test("every other failure keeps the existing sentence", () => {
    expect(rsvpDraftSaveFailureCopy(new Error("Network request failed"))).toBe(
      RSVP_DRAFT_SAVE_FAILED_COPY,
    );
    expect(rsvpDraftSaveFailureCopy(postgrest("rsvp_draft_graph_invalid", "P0001"))).toBe(
      RSVP_DRAFT_SAVE_FAILED_COPY,
    );
  });

  test("host-facing copy never names a payment provider", () => {
    for (const copy of [RSVP_CHIP_IN_SAVE_REFUSED_COPY, RSVP_DRAFT_SAVE_FAILED_COPY]) {
      expect(copy).not.toMatch(/stripe|paystack/i);
    }
  });
});
