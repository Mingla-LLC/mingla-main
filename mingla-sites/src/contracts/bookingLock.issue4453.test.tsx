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
import { assertArtifactV2, siteAnswerPaths, type ArtifactV2 } from "./generated/artifactV2.ts";
import { upgradeV1ToV2 } from "./generated/upgradeV1ToV2.ts";
import { blockActionLinks, BLOCK_CATALOG } from "./generated/blocks.ts";
import { actionHrefProblem, isMinglaActionHref, type MinglaActionScope } from "./generated/safety.ts";
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
    ["https://www.opentable.com/r/young-and-stamped", "outside_mingla"],
    ["https://calendly.com/young-and-stamped", "outside_mingla"],
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
    expect(actionHrefProblem("https://www.opentable.com/r/x", null)).toBe("outside_mingla");
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
    expect(blockActionLinks({ type: "hero", ctas: [{ label: "a", href: "/trips" }, { label: "b", href: "https://x.example" }] }))
      .toEqual([{ field: "ctas[0].href", href: "/trips" }, { field: "ctas[1].href", href: "https://x.example" }]);
    expect(blockActionLinks({ blockType: "cta", href: "/about" })).toEqual([{ field: "href", href: "/about" }]);
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
  it("names every outside button with its page, block and field", () => {
    const artifact = gogi();
    const links = outboundActionLinks({ pages: artifact.pages, scope: { brandSlug: "example", sitePaths: siteAnswerPaths(artifact) } });
    expect(links.map((link) => `${link.blockType}.${link.field}:${link.problem}`).sort()).toEqual([
      "contact_handoff.href:outside_mingla",
      "cta.href:outside_mingla",
      "menu_link.href:outside_mingla",
    ]);
  });

  it("finds nothing once every button goes to Mingla, and flags a bad header button", () => {
    const artifact = gogiLocked();
    const scope = { brandSlug: "example", sitePaths: siteAnswerPaths(artifact) };
    expect(outboundActionLinks({ pages: artifact.pages, scope })).toEqual([]);
    expect(outboundActionLinks({ pages: [], headerCtaHref: "https://calendly.com/x", scope })[0])
      .toMatchObject({ pagePath: null, field: "header_cta.href", problem: "outside_mingla" });
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
