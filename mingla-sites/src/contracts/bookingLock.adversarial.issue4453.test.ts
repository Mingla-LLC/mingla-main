/**
 * #4453 PR 2 (booking lock) — the tester's adversarial matrix, a different
 * angle from bookingLock.issue4453.test.tsx: URL-parser tricks a booking
 * button might use to look like Mingla while leaving it, third-party booking
 * sites on their country domains, and booking-worded labels in other casing
 * and with emoji.
 *
 * invariant: I-SITES-ACTIONS-RESOLVE-TO-MINGLA (declared in
 * packages/site-contracts/src/safety.ts).
 */
import { describe, expect, it } from "vitest";
import { BLOCK_CATALOG, actionIntentFor } from "./generated/blocks.ts";
import { actionHrefProblem, isBookingSiteHost, offersBookingOrPayment, type MinglaActionScope } from "./generated/safety.ts";

const scope: MinglaActionScope = {
  brandSlug: "gogi",
  sitePaths: new Set(["", "menu", "visit", "contact"]),
  contactEmail: "hi@gogi.example",
  contactPhone: "+44 20 7946 0000",
  checkoutEventIds: new Set(["11111111-1111-4111-8111-111111111111"]),
};
const H = "https://host.usemingla.com";

describe("#4453 adversarial: a booking button cannot dress up as Mingla", () => {
  it.each([
    ["trailing-dot host", "https://host.usemingla.com./b/gogi"],
    ["userinfo before a foreign host", "https://host.usemingla.com@evil.example/b/gogi"],
    ["IDN look-alike (Greek omicron)", "https://hοst.usemingla.com/b/gogi"],
    ["protocol-relative", "//evil.example/b/gogi"],
    ["slash-backslash (browsers read it as //)", "/\\evil.example"],
    ["slash-tab-slash (browsers strip the tab)", "/\t/evil.example"],
    ["javascript:", "javascript:alert(1)"],
    ["mixed-case javascript:", "JaVaScRiPt:alert(1)"],
    ["data:", "data:text/html,<b>x</b>"],
    ["http downgrade", "http://host.usemingla.com/b/gogi"],
    ["subdomain of the Mingla host", "https://evil.host.usemingla.com/b/gogi"],
    ["Mingla host as a subdomain", "https://host.usemingla.com.evil.example/b/gogi"],
    ["Mingla apex", "https://usemingla.com/b/gogi"],
    ["another brand's site host", "https://rival.sites.usemingla.com/"],
    ["non-default port", "https://host.usemingla.com:8443/b/gogi"],
    ["another brand's slug", `${H}/e/rival/launch`],
    ["dot-segment hop to another brand", `${H}/b/gogi/../../e/rival/launch`],
    ["encoded dot-segment hop to another brand", `${H}/b/gogi/%2e%2e/%2e%2e/e/rival/launch`],
    ["another brand's checkout", `${H}/checkout/22222222-2222-4222-8222-222222222222`],
    ["a page the site does not have", "/rooms"],
    ["someone else's mailto", "mailto:x@evil.example"],
    ["someone else's phone", "tel:+15555550000"],
    ["a map link on a booking button", "https://www.google.com/maps/place/gogi"],
    ["a WhatsApp link on a booking button", "https://wa.me/442079460000"],
  ])("refuses %s", (_name, href) => {
    expect(actionHrefProblem(href, scope, "booking")).not.toBeNull();
  });

  it.each([
    ["mixed-case Mingla host", "https://HOST.UseMingla.COM/b/gogi"],
    ["mixed-case own slug", `${H}/b/GOGI`],
    ["percent-encoded dot in the Mingla host (parses to the Mingla host)", "https://host%2eusemingla.com/b/gogi"],
    ["own venue", `${H}/b/gogi/v/main`],
    ["own checkout", `${H}/checkout/11111111-1111-4111-8111-111111111111`],
  ])("accepts %s", (_name, href) => {
    expect(actionHrefProblem(href, scope, "booking")).toBeNull();
  });
});

describe("#4453 adversarial: the informational allow list is not a way out", () => {
  it.each([
    ["a PDF on a foreign host", "https://evil.example/menu.pdf"],
    ["Google's /url redirector", "https://www.google.com/url?q=https://www.opentable.com/r/gogi"],
    ["a dot-segment hop out of /maps", "https://www.google.com/maps/../url?q=https://www.opentable.com"],
    ["another number's WhatsApp", "https://wa.me/15555550000"],
  ])("refuses %s on an informational button", (_name, href) => {
    expect(actionHrefProblem(href, scope, "informational")).not.toBeNull();
  });
});

describe("#4453 adversarial: booking sites on their country domains", () => {
  it.each([
    "www.opentable.com", "www.opentable.co.uk", "opentable.com.au", "www.opentable.de",
    "resy.com", "www.eventbrite.com", "www.eventbrite.co.uk", "eventbrite.com.au", "www.eventbrite.ie",
    "www.booking.com", "www.airbnb.com", "www.airbnb.co.uk", "www.airbnb.fr", "feverup.com",
    "www.designmynight.com", "OpenTable.COM.", "WWW.EVENTBRITE.CO.UK",
  ])("%s is a booking site, refused on every button", (host) => {
    expect(isBookingSiteHost(host)).toBe(true);
    const href = `https://${host}/x`;
    expect(actionHrefProblem(href, scope, "informational")).toBe("booking_site");
    expect(actionHrefProblem(href, scope, "booking")).toBe("booking_site");
  });

  it("a leading-space booking link is still a booking site", () => {
    expect(actionHrefProblem(" https://www.opentable.com/r/gogi", scope, "informational")).toBe("booking_site");
  });
});

describe("#4453 adversarial: booking words in any casing or with emoji lock the button", () => {
  const cta = BLOCK_CATALOG.cta.fields.href as Extract<(typeof BLOCK_CATALOG.cta.fields)["href"], { kind: "action_href" }>;
  it.each([
    "Reserve", "RESERVE", "reserve a table", "Get tickets", "GET TICKETS", "\u{1F39F}️Tickets",
    "\u{1F39F}️ Get tickets", "Book now", "BOOK NOW", "book now \u{1F37D}️", "\u{1F4C5}Book",
    "Pay deposit", "PAY DEPOSIT", "Book-a-table",
  ])("%j reads as booking", (label) => {
    expect(offersBookingOrPayment(label)).toBe(true);
    expect(actionIntentFor("cta", cta, { label })).toBe("booking");
  });

  it.each(["Read our story", "Our story", "Stay in touch", "Menu", "Find us", "Facebook"])("%j stays informational", (label) => {
    expect(offersBookingOrPayment(label)).toBe(false);
    expect(actionIntentFor("cta", cta, { label })).toBe("informational");
  });

  it("a booking-worded cta cannot use the informational allow list", () => {
    const label = "\u{1F37D}️ BOOK NOW";
    const intent = actionIntentFor("cta", cta, { label });
    expect(actionHrefProblem("https://www.instagram.com/gogi", scope, intent)).toBe("outside_mingla");
    expect(actionHrefProblem("https://maps.apple.com/?q=gogi", scope, intent)).toBe("outside_mingla");
  });
});
