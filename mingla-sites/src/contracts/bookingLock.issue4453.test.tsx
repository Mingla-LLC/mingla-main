/* eslint-disable @typescript-eslint/no-explicit-any -- this suite mutates untyped artifact JSON on purpose to prove each refusal. */
/*
 * #4453 PR 2 (booking lock) — every button on a Mingla site goes to Mingla.
 *
 * invariant: I-SITES-ACTIONS-RESOLVE-TO-MINGLA — every action field on a
 * published site resolves to this brand's Mingla route, a same-site page, or
 * the brand's own mailto or tel (declared in packages/site-contracts/src/safety.ts).
 *
 * SC-L1: isMinglaActionHref accepts this brand's /t/, /e/, /exp/, /b/ and
 * /checkout/ pages, existing same-site paths and the brand's own mailto/tel,
 * and refuses another brand's Mingla page, any other host, http:,
 * javascript: and paths to missing pages. The artifact validator refuses an
 * outbound button once the artifact carries `action_scope`, and an artifact
 * published before the lock (no scope) keeps validating. With JS off, a
 * Mingla button is a plain link straight to Mingla.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { artifactActionScope, assertArtifactV2, siteAnswerPaths, type ArtifactV2 } from "./generated/artifactV2.ts";
import { upgradeV1ToV2 } from "./generated/upgradeV1ToV2.ts";
import { blockActionLinks, BLOCK_CATALOG } from "./generated/blocks.ts";
import { actionHrefProblem, isMinglaActionHref, normalizeBrandPhone, offersBookingOrPayment, socialHandlesFrom, type MinglaActionScope } from "./generated/safety.ts";
import { outboundActionLinks } from "./generated/publishChecks.ts";
import { bookingThroughEnquiryFields, offersBooking } from "./generated/claims.ts";
import { FX, gogiV1Fixture } from "./gogiV1.fixture";
import { sitePages } from "../lib/pageRouting";
import { AtelierPage } from "../designs/atelier/AtelierPage";

const EVENT = "11111111-1111-4111-8111-111111111111";
const SCOPE: MinglaActionScope = {
  brandSlug: "young-and-stamped",
  sitePaths: new Set(["", "trips", "about", "trips/lagos"]),
  contactEmail: "hello@youngandstamped.com",
  contactPhone: "+234 801 234 5678",
  checkoutEventIds: new Set([EVENT]),
};

describe("#4453 isMinglaActionHref (SC-L1)", () => {
  const accepted = [
    "https://host.usemingla.com/t/young-and-stamped/lagos-weekend",
    "https://host.usemingla.com/e/young-and-stamped/rooftop-night?mc_click=abc",
    "https://host.usemingla.com/exp/young-and-stamped/pottery",
    "https://host.usemingla.com/b/young-and-stamped",
    "https://host.usemingla.com/b/Young-And-Stamped/v/main-room",
    `https://host.usemingla.com/checkout/${EVENT}`,
    "/",
    "/trips",
    "/trips/lagos",
    "/about#team",
    "mailto:hello@youngandstamped.com",
    "mailto:HELLO@youngandstamped.com",
    "tel:+2348012345678",
  ];
  for (const href of accepted) {
    it(`accepts ${href}`, () => expect(actionHrefProblem(href, SCOPE)).toBeNull());
  }

  const refused: Array<[string, string]> = [
    ["https://host.usemingla.com/t/another-brand/lagos-weekend", "other_brand"],
    ["https://host.usemingla.com/b/another-brand/v/main-room", "other_brand"],
    ["https://host.usemingla.com/checkout/22222222-2222-4222-8222-222222222222", "other_brand"],
    ["https://www.opentable.com/r/young-and-stamped", "booking_site"],
    ["https://calendly.com/young-and-stamped", "booking_site"],
    ["https://evil.example/t/young-and-stamped/lagos-weekend", "outside_mingla"],
    ["https://usemingla.com/t/young-and-stamped/lagos-weekend", "outside_mingla"],
    ["https://wa.me/2348012345678", "outside_mingla"],
    ["https://young-and-stamped.sites.usemingla.com/trips", "outside_mingla"],
    ["https://host.usemingla.com/account/settings", "outside_mingla"],
    ["https://host.usemingla.com/t/young-and-stamped", "outside_mingla"],
    ["http://host.usemingla.com/t/young-and-stamped/lagos-weekend", "unsafe"],
    ["https://host.usemingla.com:8443/t/young-and-stamped/lagos-weekend", "outside_mingla"],
    ["javascript:alert(1)", "unsafe"],
    ["//evil.example/x", "unsafe"],
    ["/rooms", "page_missing"],
    ["mailto:someone@else.com", "not_brand_contact"],
    ["tel:+15550000000", "not_brand_contact"],
  ];
  for (const [href, problem] of refused) {
    it(`refuses ${href} (${problem})`, () => {
      expect(actionHrefProblem(href, SCOPE)).toBe(problem);
      expect(isMinglaActionHref(href, SCOPE)).toBe(false);
    });
  }

  it("refuses mailto/tel when the brand has no contact details", () => {
    const bare: MinglaActionScope = { brandSlug: "young-and-stamped", sitePaths: null };
    expect(actionHrefProblem("mailto:hello@youngandstamped.com", bare)).toBe("not_brand_contact");
    expect(actionHrefProblem("tel:+2348012345678", bare)).toBe("not_brand_contact");
    expect(actionHrefProblem(`https://host.usemingla.com/checkout/${EVENT}`, bare)).toBe("other_brand");
  });

  it("without a scope checks the shape only: any brand's Mingla page passes, other sites never do", () => {
    expect(actionHrefProblem("https://host.usemingla.com/t/another-brand/x", null)).toBeNull();
    expect(actionHrefProblem("/anything", null)).toBeNull();
    expect(actionHrefProblem("https://www.opentable.com/r/x", null)).toBe("booking_site");
    expect(actionHrefProblem("https://example.com/x", null)).toBe("outside_mingla");
  });
});

describe("#4453 action fields in the block catalogue", () => {
  it("every listed button field is an action_href; map, directions and portrait links are not", () => {
    const kind = (type: keyof typeof BLOCK_CATALOG, field: string) => (BLOCK_CATALOG[type].fields as any)[field].kind;
    expect((BLOCK_CATALOG.hero.fields.ctas as any).item.href.kind).toBe("action_href");
    for (const [type, field] of [
      ["cta", "href"], ["menu_link", "href"], ["contact_handoff", "href"],
      ["offering_grid", "cta_href"], ["offering_grid", "empty_cta_href"],
      ["testimonials", "cta_href"], ["offering_history", "cta_href"], ["video_feature", "group_cta_href"],
      ["media_feature", "cta_href"], ["menu_preview", "cta_href"], ["team", "cta_href"],
      ["destination_grid", "cta_href"], ["story_grid", "cta_href"],
    ] as const) expect(kind(type, field), `${type}.${field}`).toBe("action_href");
    expect(kind("hours_location", "map_url")).toBe("href");
    expect(kind("map_embed", "directions_url")).toBe("href");
    expect((BLOCK_CATALOG.team.fields.members as any).item.media_url.kind).toBe("href");
  });

  it("blockActionLinks finds nested buttons and reads Studio blocks too", () => {
    expect(blockActionLinks({ type: "hero", ctas: [{ label: "Follow us", href: "https://x.com/example" }, { label: "Book", href: "/trips" }] }))
      .toEqual([{ field: "ctas[0].href", href: "https://x.com/example", intent: "informational" }, { field: "ctas[1].href", href: "/trips", intent: "booking" }]);
    expect(blockActionLinks({ blockType: "cta", label: "Directions", href: "/about" })).toEqual([{ field: "href", href: "/about", intent: "informational" }]);
    expect(blockActionLinks({ type: "cta", label: "Book a table", href: "/about" })[0]?.intent).toBe("booking");
    expect(blockActionLinks({ type: "offering_grid", cta_label: "See more", cta_href: "/trips" })[0]?.intent).toBe("booking");
    expect(blockActionLinks({ type: "hours_location", map_url: "https://maps.example.com" })).toEqual([]);
  });
});

/** The gögi fixture with its three outside buttons (maps CTA, PDF menu link, WhatsApp hand-off). */
function gogi(): ArtifactV2 {
  return upgradeV1ToV2(gogiV1Fixture());
}

/** The same site with every button pointing at Mingla or its own pages. */
function gogiLocked(): ArtifactV2 {
  const artifact = gogi();
  for (const page of artifact.pages) {
    for (const block of page.blocks as any[]) {
      if (block.type === "cta" && /^https:/.test(block.href)) block.href = "/reservations";
      if (block.type === "menu_link") block.href = "/menu";
      if (block.type === "contact_handoff") block.href = "https://host.usemingla.com/b/example";
    }
  }
  artifact.action_scope = { brand_slug: "example" };
  return artifact;
}

describe("#4453 the artifact validator (I-SITES-ACTIONS-RESOLVE-TO-MINGLA)", () => {
  it("an artifact published before the lock (no action_scope) keeps validating, outside buttons and all", () => {
    expect(() => assertArtifactV2(gogi())).not.toThrow();
  });

  it("with action_scope an outside button is refused", () => {
    const artifact = gogi() as any;
    artifact.action_scope = { brand_slug: "example" };
    expect(() => assertArtifactV2(artifact)).toThrow(/ARTIFACT_BLOCK_CONTENT_MISMATCH:(cta|menu_link|contact_handoff)\.href/);
  });

  it("after the fix the same site validates", () => {
    expect(() => assertArtifactV2(gogiLocked())).not.toThrow();
  });

  it("another brand's Mingla page is refused; this brand's passes", () => {
    const other = gogiLocked() as any;
    other.pages[0].blocks[0].ctas = [{ label: "Book", href: "https://host.usemingla.com/b/another-brand" }];
    expect(() => assertArtifactV2(other)).toThrow("ARTIFACT_BLOCK_CONTENT_MISMATCH:hero.ctas");
    const own = gogiLocked() as any;
    own.pages[0].blocks[0].ctas = [{ label: "Book", href: "https://host.usemingla.com/b/example/v/main" }];
    expect(() => assertArtifactV2(own)).not.toThrow();
  });

  it("a same-site button to a page the site doesn't have is refused", () => {
    const artifact = gogiLocked() as any;
    artifact.pages[0].blocks[0].ctas = [{ label: "Rooms", href: "/rooms" }];
    expect(() => assertArtifactV2(artifact)).toThrow("ARTIFACT_BLOCK_CONTENT_MISMATCH:hero.ctas");
  });

  it("a checkout button passes only for an event the site carries", () => {
    const artifact = gogiLocked() as any;
    artifact.pages[0].blocks[0].ctas = [{ label: "Tickets", href: `https://host.usemingla.com/checkout/${FX(30)}` }];
    expect(() => assertArtifactV2(artifact)).not.toThrow();
    artifact.pages[0].blocks[0].ctas = [{ label: "Tickets", href: `https://host.usemingla.com/checkout/${EVENT}` }];
    expect(() => assertArtifactV2(artifact)).toThrow("ARTIFACT_BLOCK_CONTENT_MISMATCH:hero.ctas");
  });

  it("the header button is an action link too", () => {
    const artifact = gogiLocked() as any;
    artifact.navigation.header_cta = { label: "Book", href: "https://www.opentable.com/r/example" };
    expect(() => assertArtifactV2(artifact)).toThrow("ARTIFACT_NAVIGATION_MISMATCH");
    artifact.navigation.header_cta = { label: "Book", href: "https://host.usemingla.com/b/example" };
    expect(() => assertArtifactV2(artifact)).not.toThrow();
  });

  it("a malformed action_scope is refused", () => {
    const artifact = gogiLocked() as any;
    artifact.action_scope = { brand_slug: "../other" };
    expect(() => assertArtifactV2(artifact)).toThrow("ARTIFACT_ACTION_SCOPE_MISMATCH");
    artifact.action_scope = { brand_slug: "example", extra: true };
    expect(() => assertArtifactV2(artifact)).toThrow("ARTIFACT_ACTION_SCOPE_MISMATCH");
  });

  it("siteAnswerPaths lists enabled pages", () => {
    const artifact = gogi();
    expect([...siteAnswerPaths(artifact)].sort()).toEqual(artifact.pages.filter((page) => page.enabled).map((page) => page.path).sort());
  });
});

describe("#4453 outboundActionLinks (the OUTBOUND_ACTION_LINK publish check)", () => {
  it("names every failing button with its page, block, field and intent", () => {
    // The original gögi fixture links a made-up maps host, a PDF on another
    // site and a WhatsApp number that isn't the brand's: none is allowed.
    const artifact = gogi();
    const links = outboundActionLinks({ pages: artifact.pages, scope: { brandSlug: "example", sitePaths: siteAnswerPaths(artifact) } });
    expect(links.map((link) => `${link.blockType}.${link.field}:${link.intent}:${link.problem}`).sort()).toEqual([
      "contact_handoff.href:informational:not_brand_contact",
      "cta.href:informational:outside_mingla",
      "menu_link.href:informational:outside_mingla",
    ]);
  });

  it("finds nothing once every button goes to Mingla, and flags a bad header button", () => {
    const artifact = gogiLocked();
    const scope = { brandSlug: "example", sitePaths: siteAnswerPaths(artifact) };
    expect(outboundActionLinks({ pages: artifact.pages, scope })).toEqual([]);
    expect(outboundActionLinks({ pages: [], headerCtaHref: "https://example.com/x", scope })[0])
      .toMatchObject({ pagePath: null, field: "header_cta.href", intent: "booking", problem: "outside_mingla" });
  });
});

/*
 * #4453 PR 2 rework — informational buttons may leave the site. A gögi-shaped
 * site (Directions to Google Maps, a PDF menu in its own media, its own
 * WhatsApp) publishes cleanly; a booking button or any button to a booking
 * site does not.
 */
const GOGI_PHONE = "+2340000000000";
function gogiShaped(): ArtifactV2 {
  const artifact = gogi();
  for (const page of artifact.pages) {
    for (const block of page.blocks as any[]) {
      if (block.type === "cta" && /^https:/.test(block.href)) block.href = "https://maps.google.com/?q=1+Example+Way+Lagos";
      // The menu file in the site's own media, on its own address.
      if (block.type === "menu_link") block.href = `${artifact.seo.canonical_url}${artifact.media.find((item) => item.url.endsWith(".webp"))!.url}`;
      if (block.type === "contact_handoff") block.href = "https://wa.me/2340000000000";
    }
  }
  artifact.action_scope = { brand_slug: "example", contact_phone: GOGI_PHONE };
  return artifact;
}
const scopeOf = (artifact: ArtifactV2): MinglaActionScope => artifactActionScope(artifact)!;

describe("#4453 informational links stay; booking links go to Mingla", () => {
  it("a gögi-shaped site (maps, PDF menu, WhatsApp) publishes cleanly", () => {
    const artifact = gogiShaped();
    expect(outboundActionLinks({ pages: artifact.pages, scope: scopeOf(artifact) })).toEqual([]);
    expect(() => assertArtifactV2(artifact)).not.toThrow();
  });

  it("a PDF menu in the site's own /media/ path passes as information", () => {
    expect(actionHrefProblem("/media/4c1c6d1e-0000-4000-8000-000000000001/menu.pdf", SCOPE, "informational")).toBeNull();
    expect(actionHrefProblem("/media/4c1c6d1e-0000-4000-8000-000000000001/menu.pdf", SCOPE, "booking")).toBe("page_missing");
  });

  it("a “Book a table” button to OpenTable is refused", () => {
    const artifact = gogiShaped() as any;
    const cta = artifact.pages.flatMap((page: any) => page.blocks).find((block: any) => block.type === "cta" && block.href.startsWith("https://maps"));
    cta.label = "Book a table";
    cta.href = "https://www.opentable.com/r/example-lagos";
    expect(outboundActionLinks({ pages: artifact.pages, scope: scopeOf(artifact) }))
      .toEqual([expect.objectContaining({ blockType: "cta", intent: "booking", problem: "booking_site" })]);
    expect(() => assertArtifactV2(artifact)).toThrow("ARTIFACT_BLOCK_CONTENT_MISMATCH:cta.href");
  });

  it("a booking site is refused even on a button that doesn't say book", () => {
    for (const href of ["https://www.eventbrite.co.uk/e/123", "https://resy.com/cities/x", "https://www.sevenrooms.com/x", "https://www.booking.com/hotel/x", "https://www.airbnb.co.uk/rooms/1", "https://feverup.com/x", "https://www.designmynight.com/x", "https://www.exploretock.com/x"]) {
      expect(actionHrefProblem(href, SCOPE, "informational"), href).toBe("booking_site");
    }
  });

  it("a social profile is allowed on an informational button", () => {
    for (const href of ["https://www.instagram.com/example", "https://www.tiktok.com/@example", "https://facebook.com/example", "https://x.com/example"]) {
      expect(actionHrefProblem(href, SCOPE, "informational"), href).toBeNull();
    }
    const artifact = gogiShaped() as any;
    artifact.pages[0].blocks.find((block: any) => block.type === "media_feature").cta_href = "https://www.instagram.com/example";
    expect(() => assertArtifactV2(artifact)).not.toThrow();
  });

  it("maps: Google, Apple and OpenStreetMap only", () => {
    for (const href of ["https://www.google.com/maps/place/x", "https://maps.app.goo.gl/abc", "https://maps.apple.com/?q=x", "https://www.openstreetmap.org/#map=1/2/3"]) {
      expect(actionHrefProblem(href, SCOPE, "informational"), href).toBeNull();
    }
    expect(actionHrefProblem("https://www.google.com/search?q=x", SCOPE, "informational")).toBe("outside_mingla");
  });

  it("only the brand's own WhatsApp", () => {
    expect(actionHrefProblem("https://wa.me/2348012345678", SCOPE, "informational")).toBeNull();
    expect(actionHrefProblem("https://wa.me/15550000000", SCOPE, "informational")).toBe("not_brand_contact");
    expect(actionHrefProblem("https://wa.me/2348012345678", SCOPE, "booking")).toBe("outside_mingla");
  });

  it("a hero button follows its label: information may leave Mingla, booking may not", () => {
    for (const [label, href] of [["Follow us", "https://www.instagram.com/example"], ["Directions", "https://maps.google.com/?q=x"]]) {
      const artifact = gogiShaped() as any;
      artifact.pages[0].blocks[0].ctas = [{ label, href }];
      expect(() => assertArtifactV2(artifact), href).not.toThrow();
    }
    for (const href of ["https://www.instagram.com/example", "https://maps.google.com/?q=x", "https://example.com/"]) {
      const artifact = gogiShaped() as any;
      artifact.pages[0].blocks[0].ctas = [{ label: "Book", href }];
      expect(() => assertArtifactV2(artifact), href).toThrow("ARTIFACT_BLOCK_CONTENT_MISMATCH:hero.ctas");
    }
  });

  it("a button whose label books or pays is locked to Mingla", () => {
    const artifact = gogiShaped() as any;
    const handoff = artifact.pages.flatMap((page: any) => page.blocks).find((block: any) => block.type === "contact_handoff");
    handoff.label = "Reserve on WhatsApp";
    expect(() => assertArtifactV2(artifact)).toThrow("ARTIFACT_BLOCK_CONTENT_MISMATCH:contact_handoff.href");
  });
});

describe("#4453 BOOKING_THROUGH_ENQUIRY", () => {
  it("refuses booking words on question forms", () => {
    expect(bookingThroughEnquiryFields({ type: "contact_form", heading: "Book a table", submit_label: "Send" })).toEqual(["heading"]);
    expect(bookingThroughEnquiryFields({ blockType: "contact_form", message_label: "Your dates and who's coming", submit_label: "Check availability" })).toEqual(["submit_label"]);
    expect(bookingThroughEnquiryFields({ type: "contact_handoff", heading: "Reserve your stay", label: "Tickets" })).toEqual(["heading", "label"]);
    for (const text of ["Book now", "Reservations", "Get tickets", "Pay a deposit", "Ask about a stay", "Booking"]) expect(offersBooking(text), text).toBe(true);
  });

  it("lets questions through, and ignores other blocks", () => {
    expect(bookingThroughEnquiryFields({ type: "contact_form", heading: "Ask us anything", submit_label: "Send" })).toEqual([]);
    expect(bookingThroughEnquiryFields({ type: "contact_handoff", heading: "Stay in touch", label: "Message us" })).toEqual([]);
    expect(bookingThroughEnquiryFields({ type: "cta", heading: "Book a table", label: "Book" })).toEqual([]);
    expect(offersBooking("Notebook club")).toBe(false);
  });
});

describe("#4453 JS off: a Mingla button is a plain link to Mingla", () => {
  it("renders the hero button as an anchor whose href is the Mingla page", () => {
    const artifact = gogiLocked();
    const href = "https://host.usemingla.com/b/example/v/main";
    (artifact.pages[0]!.blocks[0] as any).ctas = [{ label: "Book a table", href }];
    assertArtifactV2(artifact);
    const html = renderToStaticMarkup(<AtelierPage artifact={artifact} page={sitePages(artifact)[0]} />);
    const anchor = html.match(/<a\b[^>]*href="https:\/\/host\.usemingla\.com\/b\/example\/v\/main"[^>]*>/);
    expect(anchor, "server markup carries the Mingla link itself").not.toBeNull();
    expect(anchor![0]).not.toMatch(/\bonclick=/i);
  });
});

/*
 * #4453 PR 2 tester rework (verdict 6928640838): the informational allow list
 * is not a way out, intent can't be dodged by spelling, and the check fails
 * closed when the brand can't be named.
 */
describe("#4453 rework P1: social redirectors and other profiles", () => {
  it.each([
    "https://l.instagram.com/?u=https%3A%2F%2Fwww.opentable.com%2Fr%2Fgogi",
    "https://l.facebook.com/l.php?u=https%3A%2F%2Fresy.com%2Fx",
    "https://lm.facebook.com/l.php?u=https%3A%2F%2Fresy.com%2Fx",
    "https://www.facebook.com/l.php?u=https%3A%2F%2Fresy.com%2Fx",
    "https://www.youtube.com/redirect?q=https%3A%2F%2Feventbrite.com%2Fe%2F1",
    "https://www.linkedin.com/redir/redirect?url=https%3A%2F%2Fresy.com",
    "https://www.instagram.com/young-and-stamped?next=https://resy.com",
    "https://t.co/abc", "https://bit.ly/abc", "https://goo.gl/abc", "https://linktr.ee/x", "https://tinyurl.com/x",
    "https://maps.google.com/?q=https://www.opentable.com/r/x",
    "https://business.instagram.com/x", "https://about.instagram.com/x",
  ])("refuses %s on an informational button", (href) => {
    expect(actionHrefProblem(href, SCOPE, "informational")).not.toBeNull();
    expect(actionHrefProblem(href, null, "informational")).not.toBeNull();
  });

  it("restricts socials to the brand's own profiles when they are known", () => {
    const own = { ...SCOPE, socialHandles: new Set(["youngandstamped"]) };
    expect(actionHrefProblem("https://www.instagram.com/youngandstamped", own, "informational")).toBeNull();
    expect(actionHrefProblem("https://www.tiktok.com/@youngandstamped", own, "informational")).toBeNull();
    expect(actionHrefProblem("https://www.instagram.com/rival", own, "informational")).toBe("not_brand_social");
    expect(actionHrefProblem("https://www.instagram.com/", SCOPE, "informational")).toBe("not_brand_social");
  });

  it("reads handles from Mingla social_links", () => {
    expect(socialHandlesFrom({ instagram: "https://www.instagram.com/YoungAndStamped/", tiktok: "@ys.trips", website: "https://ys.example" }).sort())
      .toEqual(["youngandstamped", "ys.trips"]);
  });

  it("maps: exact hosts and a /maps/ boundary", () => {
    expect(actionHrefProblem("https://maps.app.goo.gl/abc", SCOPE, "informational")).toBeNull();
    expect(actionHrefProblem("https://goo.gl/maps/abc", SCOPE, "informational")).toBeNull();
    expect(actionHrefProblem("https://goo.gl/mapsAbc", SCOPE, "informational")).not.toBeNull();
    expect(actionHrefProblem("https://www.google.com/mapsx", SCOPE, "informational")).not.toBeNull();
  });
});

describe("#4453 rework P2a: booking intent can't be dodged by spelling", () => {
  it.each([
    "Join waitlist", "JOIN WAITLIST", "Join the waitlist \u2728", "Save your spot", "Secure your spot", "Grab a seat",
    "Claim your place", "Booknow", "B\u043e\u043ek now", "R\u00e9server", "Reservar", "Entradas", "Comprar", "Buchen",
    "Prenota", "Billets", "Ingressos", "S\u2019inscrire", "Sign-up", "RSVP", "Pre-order", "Check out", "Pay now", "Order online",
    "Get a table", "\uff22\uff4f\uff4f\uff4b", "Book\u200b now",
  ])("%j reads as booking", (label) => expect(offersBookingOrPayment(label)).toBe(true));

  it.each(["Read our story", "Find us", "Directions", "Menu", "Follow us", "Stay in touch", "Notebook club", "Facebook", "Our comprehensive guide"])(
    "%j stays informational", (label) => expect(offersBookingOrPayment(label)).toBe(false),
  );
});

describe("#4453 rework P2b: phones normalise and the check fails closed", () => {
  it("strips extensions and notes; keeps the first number", () => {
    expect(normalizeBrandPhone("+44 20 7946 0000 ext. 2")).toBe("+442079460000");
    expect(normalizeBrandPhone("020 7946 0000 (bookings)")).toBe("02079460000");
    expect(normalizeBrandPhone("+234 803 000 0000 / +234 805 000 0000")).toBe("+2348030000000");
    expect(normalizeBrandPhone("call us")).toBeNull();
  });

  it("with no brand, links that need it are refused (brand_unknown); same-site and plain information still pass", () => {
    const noBrand: MinglaActionScope = { brandSlug: null, sitePaths: new Set(["", "about"]) };
    for (const href of ["https://host.usemingla.com/e/rival/x", "https://host.usemingla.com/b/young-and-stamped", "mailto:x@y.co", "tel:+15550000", `https://host.usemingla.com/checkout/${EVENT}`]) {
      expect(actionHrefProblem(href, noBrand, "booking"), href).toBe("brand_unknown");
    }
    expect(actionHrefProblem("https://wa.me/2348012345678", noBrand, "informational")).toBe("brand_unknown");
    expect(actionHrefProblem("/about", noBrand, "booking")).toBeNull();
    expect(actionHrefProblem("https://maps.apple.com/?q=x", noBrand, "informational")).toBeNull();
  });
});

describe("#4453 rework P3: deny-list domains, site media and mailto", () => {
  it.each(["fever.co.uk", "feverup.co.uk", "designmynight.co.uk", "resy.co.uk", "booking.co.uk", "www.sevenrooms.co.uk", "exploretock.co.uk"])(
    "%s is a booking site", (host) => expect(actionHrefProblem(`https://${host}/x`, SCOPE, "informational")).toBe("booking_site"),
  );

  it("media files only from this site's own media", () => {
    const own = { ...SCOPE, mediaIds: new Set(["4c1c6d1e-0000-4000-8000-000000000001"]), siteHosts: new Set(["young-and-stamped.sites.usemingla.com"]) };
    expect(actionHrefProblem("/media/4c1c6d1e-0000-4000-8000-000000000001/menu.pdf", own, "informational")).toBeNull();
    expect(actionHrefProblem("https://young-and-stamped.sites.usemingla.com/media/4c1c6d1e-0000-4000-8000-000000000001/menu.pdf", own, "informational")).toBeNull();
    expect(actionHrefProblem("https://rival.sites.usemingla.com/media/4c1c6d1e-0000-4000-8000-000000000001/x.pdf", own, "informational")).toBe("not_site_media");
    expect(actionHrefProblem("/media/9c1c6d1e-0000-4000-8000-000000000009/x.pdf", own, "informational")).toBe("not_site_media");
    expect(actionHrefProblem("/media/anything", own, "informational")).toBe("not_site_media");
  });

  it("mailto: every recipient must be the brand's own, with no link or address in the body", () => {
    expect(actionHrefProblem("mailto:hello@youngandstamped.com?subject=Hello", SCOPE)).toBeNull();
    for (const href of [
      "mailto:hello@youngandstamped.com?cc=x@evil.example",
      "mailto:hello@youngandstamped.com?bcc=x@evil.example",
      "mailto:hello@youngandstamped.com,x@evil.example",
      "mailto:hello@youngandstamped.com?to=x@evil.example",
      "mailto:hello@youngandstamped.com?body=Book%20at%20https://resy.com/x",
    ]) expect(actionHrefProblem(href, SCOPE), href).toBe("not_brand_contact");
  });
});

describe("#4453 retest P2-A: format characters can't hide booking intent", () => {
  it.each([
    "Res\u200Derve", "Reser\u200Dve", "Tick\u200Bets", "Re\u00ADserve", "R\u2060eserve", "B\u200Bo\u200Bo\u200Bk",
    "Bo\u200Dok", "\u202Eevreser", "\u202Ekoob", "Bo\u200Dok now", "\uFEFFReserve", "Re\u200Cserve", "\u2066Book\u2069",
  ])("%j reads as booking", (label) => expect(offersBookingOrPayment(label)).toBe(true));
});
