import { describe, expect, it } from "vitest";
import { areCandidateLinksSafe } from "./route";

describe("#2993 candidate probe optional links", () => {
  it("accepts a missing optional map URL after the artifact contract accepts it", () => {
    expect(areCandidateLinksSafe([{
      type: "hours_location",
      heading: "Visit",
      address: "Lagos",
      map_url: null,
      hours: [{ day: "Monday", value: "12:00–22:00" }],
    }])).toBe(true);
  });

  it("continues to reject every present unsafe or empty link", () => {
    for (const href of ["", "javascript:alert(1)", "//attacker.invalid"]) {
      expect(areCandidateLinksSafe([{
        type: "cta",
        heading: "Book",
        label: "Reserve",
        href,
      }])).toBe(false);
    }
  });

  it("accepts present HTTPS, mail, telephone, and relative links", () => {
    for (const href of [
      "https://usemingla.com",
      "mailto:hello@example.com",
      "tel:+1234567890",
      "/menu",
    ]) {
      expect(areCandidateLinksSafe([{
        type: "cta",
        heading: "Book",
        label: "Reserve",
        href,
      }])).toBe(true);
    }
  });
});
