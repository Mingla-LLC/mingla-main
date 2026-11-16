/**
 * #4420 — the experience checkout showed the full street address before
 * payment. The product hides exact stop addresses until booking
 * (hideAddressUntilTicket, default on): the public RPC nulls every stop's
 * address and the public page shows only the city and country. The checkout
 * printed `venueText`, which falls back to the first stop's street address.
 *
 *   EA-1 the buyer venue line is the public page's city line, never the street.
 *   EA-2 the checkout subline built from it carries no street part.
 *   EA-3 the checkout and the public page read the same place for one experience.
 *
 * FAILS-ON-REVERT: pass `experience.venueText` straight to the subline again in
 * app/checkout-experience/[experienceEventId]/index.tsx (or make
 * experienceBuyerVenueLine return its input) and EA-1 / EA-2 go red.
 */
import { normalizeCityCountry } from "@mingla/offering-rendering";

import {
  experienceBuyerVenueLine,
  formatExperienceDateSubline,
} from "../experienceDateSubline";

const STREET = "14 Admiralty Way, Lekki Phase 1, Lagos, Nigeria";

describe("#4420 experience checkout keeps the address hidden until booking", () => {
  test("EA-1 the buyer venue line is the city line", () => {
    const line = experienceBuyerVenueLine(STREET);
    expect(line).not.toBeNull();
    expect(line).not.toContain("14 Admiralty");
    expect(line).not.toContain("Admiralty Way");
    expect(line).toContain("Nigeria");
    expect(experienceBuyerVenueLine(null)).toBeNull();
  });

  test("EA-2 the checkout subline carries no street part", () => {
    const subline = formatExperienceDateSubline(
      {
        venueText: experienceBuyerVenueLine(STREET),
        dateStartIsos: ["2099-03-01T18:00:00.000Z"],
        whenMode: "single",
        recurrenceRule: null,
      },
      Date.parse("2099-01-01T00:00:00.000Z"),
    );
    expect(subline).not.toContain("Admiralty");
    expect(subline.length).toBeGreaterThan(0);
  });

  test("EA-3 checkout and public page name the same place", () => {
    expect(experienceBuyerVenueLine(STREET)).toBe(normalizeCityCountry(STREET));
  });
});
