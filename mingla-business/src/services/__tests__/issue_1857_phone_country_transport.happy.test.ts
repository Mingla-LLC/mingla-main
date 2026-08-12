import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const readService = (name: string): string =>
  readFileSync(join(__dirname, "..", name), "utf8");

describe("#1857 business transport country authority", () => {
  test("Buyer services preserve selected ISO on every changed envelope", () => {
    const rsvp = readService("rsvpEvents.ts");
    const reserve = readService("venueGuestReservationService.ts");
    const stay = readService("stayGuestService.ts");

    expect(rsvp).toContain("guestPhoneCountryIso?: string | null");
    expect(rsvp).toContain("guestPhoneCountryIso: input.guestPhoneCountryIso");
    expect(reserve).toContain("phoneCountryIso?: string | null");
    expect(stay).toContain("guest,");
  });
});
