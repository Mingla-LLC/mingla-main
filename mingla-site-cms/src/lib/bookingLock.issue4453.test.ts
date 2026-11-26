/* eslint-disable @typescript-eslint/no-explicit-any -- this suite builds partial Payload/Ari contexts on purpose. */
/*
 * #4453 PR 2 (booking lock) — Studio's half of "every button goes to Mingla".
 *
 * invariant: I-SITES-ACTIONS-RESOLVE-TO-MINGLA (declared in
 * packages/site-contracts/src/safety.ts). This suite pins the publish check:
 * one outside button blocks the publish with OUTBOUND_ACTION_LINK (SC-L2),
 * this brand's Mingla page passes, another brand's is refused; Studio's
 * save-time field check refuses an outside booking site; Ari's writes are
 * refused (VALIDATION_FAILED / BOOKING_THROUGH_ENQUIRY); and the composer
 * builds venue pages from venue_reservation and menu_board, with no "Message
 * to book" and no booking by enquiry (SC-L3).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./observability", () => ({ emitCmsObservation: vi.fn(), observeCmsEndpoint: (_r: string, _d: string, handler: unknown) => handler }));
vi.mock("./gateway", () => ({ callCore: vi.fn(), verifyCoreRequest: vi.fn(), readCoreProjection: vi.fn() }));

import { actionScopeFromCore, artifactOutboundActionLinks, assertNoOutboundActionLinks, coreSendsBookingIdentity, OutboundActionLinkError } from "./bookingLock";
import { buttonUrl, safeActionUrl, safeUrl } from "./validation";
import { composeFromPlan, type ComposePlan } from "./composeFromPlan";
import { assertAriBookingLock, ARI_REFUSAL_CODES, AriRefusal, parseAriEvidence, type AriActionContext } from "./ariSiteActions";
import { siteBlocks } from "../blocks/siteBlocks";
import type { ArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { bookingThroughEnquiryFields } from "../contracts/generated/claims.ts";
import { OUTBOUND_ACTION_LINK } from "../contracts/generated/publishChecks.ts";

/**
 * The parts of a built v2 artifact the booking lock reads: Home with one
 * call to action, About with an email hand-off, no header button.
 */
function artifact(heroHref: string, scope: ArtifactV2["action_scope"] | undefined): ArtifactV2 {
  const built = {
    pages: [
      { path: "", title: "Home", enabled: true, kind: "standard", blocks: [{ type: "cta", variant: "band", heading: "Come along", label: "Book", href: heroHref }] },
      { path: "about", title: "About", enabled: true, kind: "standard", blocks: [{ type: "contact_handoff", variant: "band", heading: "Get in touch", label: "Email us", href: "mailto:hello@youngandstamped.com" }] },
    ],
    navigation: { items: [] },
    routes: { trips: "trips", events: "events", experiences: "experiences", destinations: "destinations", stories: "stories" },
    collections: { destinations: [], stories: [], categories: [], testimonials: [] },
    offerings_snapshot: [],
    commercial: { references: [] },
  } as unknown as ArtifactV2;
  if (scope) built.action_scope = scope;
  return built;
}

const SCOPE = { brand_slug: "young-and-stamped", contact_email: "hello@youngandstamped.com" };

describe("#4453 OUTBOUND_ACTION_LINK blocks publish (SC-L2)", () => {
  it("a CTA to an outside booking site is refused at publish, naming the button", () => {
    const built = artifact("https://www.opentable.com/r/young-and-stamped", SCOPE);
    let caught: unknown;
    try {
      assertNoOutboundActionLinks(built);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OutboundActionLinkError);
    expect((caught as Error).message).toBe(OUTBOUND_ACTION_LINK);
    expect((caught as OutboundActionLinkError).links).toEqual([
      expect.objectContaining({ pagePath: "", blockIndex: 0, blockType: "cta", field: "href", intent: "booking", problem: "booking_site" }),
    ]);
  });

  it("after the fix the publish goes ahead: this brand's Mingla route passes", () => {
    expect(() => assertNoOutboundActionLinks(artifact("https://host.usemingla.com/t/young-and-stamped/lagos-weekend", SCOPE))).not.toThrow();
    expect(() => assertNoOutboundActionLinks(artifact("/about", SCOPE))).not.toThrow();
  });

  it("another brand's Mingla route is refused", () => {
    expect(artifactOutboundActionLinks(artifact("https://host.usemingla.com/t/another-brand/lagos-weekend", SCOPE)))
      .toEqual([expect.objectContaining({ problem: "other_brand" })]);
  });

  it("a mailto that is not the brand's own is refused", () => {
    const built = artifact("/about", { brand_slug: "young-and-stamped" });
    expect(artifactOutboundActionLinks(built)).toEqual([expect.objectContaining({ blockType: "contact_handoff", problem: "not_brand_contact" })]);
  });

  it("without Core's scope it FAILS CLOSED: links that need the brand are refused with BOOKING_LINK_UNVERIFIED", () => {
    expect(() => assertNoOutboundActionLinks(artifact("https://calendly.com/x", undefined))).toThrow(OUTBOUND_ACTION_LINK);
    // Another brand's route, and the brand's own mailto, can't be checked without the brand.
    expect(() => assertNoOutboundActionLinks(artifact("https://host.usemingla.com/t/another-brand/x", undefined))).toThrow("BOOKING_LINK_UNVERIFIED");
    const sameSiteOnly = artifact("/about", undefined) as any;
    sameSiteOnly.pages[1].blocks = [];
    expect(() => assertNoOutboundActionLinks(sameSiteOnly)).not.toThrow();
  });

  it("is an owner-fixable refusal code, not an outage", async () => {
    const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("../endpoints/sitesEndpoints.ts", import.meta.url), "utf8"));
    expect(source.match(/"OUTBOUND_ACTION_LINK",/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain("actionScope: actionScopeFromCore(body.action_scope)");
    expect(source).toContain("enforceActionLinks: true");
  });
});

describe("#4453 rework: informational buttons publish, booking ones go to Mingla", () => {
  const withBlocks = (blocks: Record<string, unknown>[]) => {
    const built = artifact("/about", { brand_slug: "gogi", contact_phone: "+2340000000000" }) as any;
    built.media = [{ id: "4c1c6d1e-0000-4000-8000-000000000001", url: "/media/4c1c6d1e-0000-4000-8000-000000000001/1440.webp" }];
    built.pages[0].blocks = blocks.map((block) => ({ variant: "band", ...block }));
    built.pages[1].blocks = [];
    return built as ArtifactV2;
  };

  it("a gögi-shaped site (maps, PDF menu, WhatsApp) publishes cleanly", () => {
    expect(() => assertNoOutboundActionLinks(withBlocks([
      { type: "cta", heading: "Come by", label: "Directions", href: "https://maps.google.com/?q=1+Example+Way" },
      { type: "menu_link", heading: "Prefer a PDF?", label: "Download", href: "/media/4c1c6d1e-0000-4000-8000-000000000001/menu.pdf" },
      { type: "contact_handoff", heading: "Get in touch", label: "WhatsApp", href: "https://wa.me/2340000000000" },
      { type: "media_feature", cta_label: "Follow us", cta_href: "https://www.instagram.com/gogi" },
    ]))).not.toThrow();
  });

  it("a “Book a table” button to OpenTable is refused", () => {
    expect(artifactOutboundActionLinks(withBlocks([{ type: "cta", heading: "Dinner", label: "Book a table", href: "https://www.opentable.com/r/gogi" }])))
      .toEqual([expect.objectContaining({ intent: "booking", problem: "booking_site" })]);
  });

  it("a hero button follows its label: information may leave, booking stays on Mingla", () => {
    expect(artifactOutboundActionLinks(withBlocks([{ type: "hero", heading: "Gogi", ctas: [{ label: "Follow us", href: "https://www.instagram.com/gogi" }] }]))).toEqual([]);
    expect(artifactOutboundActionLinks(withBlocks([{ type: "hero", heading: "Gogi", ctas: [{ label: "Book", href: "https://www.instagram.com/gogi" }] }])))
      .toEqual([expect.objectContaining({ blockType: "hero", intent: "booking", problem: "outside_mingla" })]);
  });
});

describe("#4453 deploy-order handshake (booking_identity)", () => {
  const site = (href: string) => {
    const built = artifact(href, undefined) as any;
    built.pages[1].blocks = [{ type: "contact_handoff", variant: "band", heading: "Get in touch", label: "Email us", href: "mailto:hello@youngandstamped.com" }];
    return built as ArtifactV2;
  };

  it("reads the capability only as Core's exact value", () => {
    expect(coreSendsBookingIdentity({ booking_identity: 1 })).toBe(true);
    expect(coreSendsBookingIdentity({ booking_identity: "1" })).toBe(false);
    expect(coreSendsBookingIdentity({})).toBe(false);
    expect(coreSendsBookingIdentity(null)).toBe(false);
  });

  it("an older Core (no booking_identity): a valid site publishes, OpenTable is still refused", () => {
    const old = { coreSendsIdentity: false };
    expect(() => assertNoOutboundActionLinks(site("https://host.usemingla.com/t/young-and-stamped/lagos-weekend"), old)).not.toThrow();
    expect(() => assertNoOutboundActionLinks(site("/about"), old)).not.toThrow();
    expect(() => assertNoOutboundActionLinks(site("https://www.opentable.com/r/young-and-stamped"), old)).toThrow(OUTBOUND_ACTION_LINK);
    expect(() => assertNoOutboundActionLinks(site("https://bit.ly/abc"), old)).toThrow(OUTBOUND_ACTION_LINK);
    expect(() => assertNoOutboundActionLinks(site("https://example.com/book"), old)).toThrow(OUTBOUND_ACTION_LINK);
  });

  it("a Core that advertises identity but sends none: BOOKING_LINK_UNVERIFIED", () => {
    expect(() => assertNoOutboundActionLinks(site("https://host.usemingla.com/t/young-and-stamped/lagos-weekend"), { coreSendsIdentity: true }))
      .toThrow("BOOKING_LINK_UNVERIFIED");
  });

  it("a Core that sends identity: the brand check runs as before", () => {
    const withScope = (href: string) => {
      const built = site(href) as any;
      built.action_scope = { brand_slug: "young-and-stamped", contact_email: "hello@youngandstamped.com" };
      return built as ArtifactV2;
    };
    expect(() => assertNoOutboundActionLinks(withScope("https://host.usemingla.com/t/young-and-stamped/x"), { coreSendsIdentity: true })).not.toThrow();
    expect(() => assertNoOutboundActionLinks(withScope("https://host.usemingla.com/t/another-brand/x"), { coreSendsIdentity: true })).toThrow(OUTBOUND_ACTION_LINK);
  });

  it("the publish passes Core's advertisement through", async () => {
    const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("../endpoints/sitesEndpoints.ts", import.meta.url), "utf8"));
    expect(source).toContain("coreSendsIdentity: coreSendsBookingIdentity(body)");
  });

  it("Ari: an older Core's evidence keeps identity checks shape-only; a new Core's fails closed", () => {
    const evidence = (extra: Record<string, unknown>) => ({ brand: { id: "b", name: null, description: null, city: null }, offerings: [], ...extra });
    const older = { evidence: parseAriEvidence(evidence({}), "b") } as unknown as AriActionContext;
    expect(() => assertAriBookingLock(older, [{ type: "cta", href: "https://host.usemingla.com/e/young-and-stamped/x" }], "blocks")).not.toThrow();
    expect(() => assertAriBookingLock(older, [{ type: "cta", href: "https://www.opentable.com/r/x" }], "blocks")).toThrow("VALIDATION_FAILED");
    const newer = { evidence: parseAriEvidence(evidence({ booking_identity: 1 }), "b") } as unknown as AriActionContext;
    expect(() => assertAriBookingLock(newer, [{ type: "cta", href: "https://host.usemingla.com/e/young-and-stamped/x" }], "blocks")).toThrow("VALIDATION_FAILED");
  });
});

describe("#4453 Core's signed action scope", () => {
  it("keeps a well-formed scope and drops a malformed one", () => {
    expect(actionScopeFromCore({ brand_slug: "young-and-stamped", contact_email: " hello@youngandstamped.com ", contact_phone: "+234 801 234 5678" }))
      .toEqual({ brand_slug: "young-and-stamped", contact_email: "hello@youngandstamped.com", contact_phone: "+2348012345678" });
    // A phone with an extension still normalises; a bad field is dropped on its own, never the whole scope.
    expect(actionScopeFromCore({ brand_slug: "young-and-stamped", contact_phone: "+44 20 7946 0000 ext. 2", contact_email: "not an email" }))
      .toEqual({ brand_slug: "young-and-stamped", contact_phone: "+442079460000" });
    expect(actionScopeFromCore({ brand_slug: "young-and-stamped", contact_phone: "call us", social_handles: ["@YS", "bad handle!"] }))
      .toEqual({ brand_slug: "young-and-stamped", social_handles: ["ys"] });
    expect(actionScopeFromCore({ brand_slug: "young-and-stamped", contact_email: "" })).toEqual({ brand_slug: "young-and-stamped" });
    expect(actionScopeFromCore({ brand_slug: "../other" })).toBeNull();
    expect(actionScopeFromCore(null)).toBeNull();
    expect(actionScopeFromCore("young-and-stamped")).toBeNull();
  });
});

describe("#4453 Studio's save-time check", () => {
  it("refuses an outside booking site on a button, keeps map links ordinary links", () => {
    expect(safeActionUrl("https://www.opentable.com/r/x")).toMatch(/points outside Mingla/);
    expect(safeActionUrl("https://wa.me/2348012345678")).toMatch(/points outside Mingla/);
    expect(safeActionUrl("javascript:alert(1)")).not.toBe(true);
    for (const ok of ["/trips", "https://host.usemingla.com/b/any-brand", "mailto:a@b.co", "tel:+2348012345678", "", null]) {
      expect(safeActionUrl(ok), String(ok)).toBe(true);
    }
    expect(safeUrl("https://maps.example.com/x")).toBe(true);
    const button = buttonUrl("label");
    expect(button("https://www.instagram.com/gogi", { siblingData: { label: "Follow us" } })).toBe(true);
    expect(button("https://wa.me/2340000000000", { siblingData: { label: "WhatsApp" } })).toBe(true);
    expect(button("https://example.com/menu.pdf", { siblingData: { label: "Download" } })).toMatch(/A button can link to/);
  });

  it("every Studio block button field uses the action check; map and directions links do not", () => {
    const validatorOf = (slug: string, name: string) =>
      (siteBlocks.find((block) => block.slug === slug)!.fields as any[]).find((field) => field.name === name)?.validate;
    const heroCta = ((siteBlocks.find((block) => block.slug === "hero")!.fields as any[]).find((field) => field.name === "ctas").fields as any[])
      .find((field) => field.name === "href").validate;
    expect(heroCta("https://maps.google.com/?q=x", { siblingData: { label: "Directions" } })).toBe(true);
    expect(heroCta("https://maps.google.com/?q=x", { siblingData: { label: "Book" } })).toMatch(/points outside Mingla/);
    const emptyCta = validatorOf("offering_grid", "empty_cta_href");
    expect(emptyCta("https://maps.google.com/?q=x", { siblingData: { empty_cta_label: "Directions" } })).toBe(true);
    expect(emptyCta("https://maps.google.com/?q=x", { siblingData: { empty_cta_label: "Book" } })).toMatch(/points outside Mingla/);
    // #4572: the owner-created CTA uses the same label-aware rule as Studio's
    // other optional buttons: informational maps/socials pass, booking words
    // remain locked to Mingla.
    const ownerCta = validatorOf("cta", "href");
    expect(ownerCta("https://maps.google.com/?q=x", { siblingData: { label: "Directions" } })).toBe(true);
    expect(ownerCta("https://maps.google.com/?q=x", { siblingData: { label: "Book a table" } })).toMatch(/points outside Mingla/);
    expect(ownerCta("https://host.usemingla.com/b/young-and-stamped/v/althaven/book/11111111-1111-4111-8111-111111111111", { siblingData: { label: "Book" } })).toBe(true);
    // Broader contact/menu buttons are still judged by their label: booking
    // words lock them to Mingla while directions may use a map.
    for (const [slug, name] of [["contact_handoff", "href"], ["menu_link", "href"]] as const) {
      const validate = validatorOf(slug, name);
      expect(validate("https://maps.google.com/?q=x", { siblingData: { label: "Directions" } }), slug).toBe(true);
      expect(validate("https://maps.google.com/?q=x", { siblingData: { label: "Book a table" } }), slug).toMatch(/points outside Mingla/);
      expect(validate("https://www.opentable.com/r/x", { siblingData: { label: "See the room" } }), slug).toMatch(/takes bookings or payments/);
    }
    expect(validatorOf("hours_location", "map_url")).toBe(safeUrl);
    expect(validatorOf("map_embed", "directions_url")).toBe(safeUrl);
  });
});

describe("#4453 Ari's writes", () => {
  const ctx = (slug: string | null) => ({
    evidence: { brand: { id: "b", name: null, description: null, city: null, slug, contact_email: "hello@youngandstamped.com", contact_phone: null }, offerings: [] },
  }) as unknown as AriActionContext;
  const refusal = (run: () => void): AriRefusal => {
    try {
      run();
    } catch (error) {
      return error as AriRefusal;
    }
    throw new Error("expected a refusal");
  };

  it("refuses an outside or other-brand button with VALIDATION_FAILED, naming the field", () => {
    const outside = refusal(() => assertAriBookingLock(ctx("young-and-stamped"), [{ type: "hero", ctas: [{ label: "Book", href: "https://www.opentable.com/r/x" }] }], "blocks"));
    expect(outside).toBeInstanceOf(AriRefusal);
    expect(outside.message).toBe("VALIDATION_FAILED");
    expect(JSON.stringify(outside.extra)).toContain("blocks[0].ctas[0].href");
    const other = refusal(() => assertAriBookingLock(ctx("young-and-stamped"), [{ type: "cta", href: "https://host.usemingla.com/e/another-brand/x" }], "blocks"));
    expect(JSON.stringify(other.extra)).toContain("other_brand");
  });

  it("lets this brand's Mingla page and same-site paths through", () => {
    expect(() => assertAriBookingLock(ctx("young-and-stamped"), [
      { type: "cta", href: "https://host.usemingla.com/t/young-and-stamped/lagos-weekend" },
      { type: "offering_grid", cta_href: "/trips" },
      { type: "contact_handoff", heading: "Ask us anything", label: "Email us", href: "mailto:hello@youngandstamped.com" },
    ], "blocks")).not.toThrow();
  });

  it("refuses a question form that offers a booking (BOOKING_THROUGH_ENQUIRY)", () => {
    const refused = refusal(() => assertAriBookingLock(ctx("young-and-stamped"), [{ type: "contact_form", heading: "Reserve your table", submit_label: "Send" }], "blocks"));
    expect(refused.message).toBe("BOOKING_THROUGH_ENQUIRY");
    expect(ARI_REFUSAL_CODES.has("BOOKING_THROUGH_ENQUIRY")).toBe(true);
  });
});

describe("#4453 venue pages compose with booking blocks (SC-L3)", () => {
  const brand = { name: "Gogi", tagline: null, bio: null, contact_email: "hi@gogi.test", city: "Lagos" };
  const plan = (offerings: string[], main_action?: string): ComposePlan => ({ offerings_selected: offerings, venue_descriptor: null, story: main_action ? { main_action } : null });
  const compose = (p: ComposePlan) => composeFromPlan({ plan: p, brand, hasConfirmedTestimonials: false, existing: [], currentWordmark: null });
  const blocksOf = (result: ReturnType<typeof compose>) => result.create.flatMap((page) => page.blocks);

  it("menu page: reservation + Mingla menu, no Message to book", () => {
    const menu = compose(plan(["venue_food_drink"])).create.find((page) => page.slug === "menu")!;
    expect(menu.blocks.map((block) => block.blockType)).toEqual(["page_header", "venue_reservation", "menu_board"]);
    expect(menu.blocks[1]).toEqual({ blockType: "venue_reservation", heading: "Reserve a table" });
  });

  it("visit page: reservation + what's on, no Message to book", () => {
    const visit = compose(plan(["venue_play"])).create.find((page) => page.slug === "visit")!;
    expect(visit.blocks.map((block) => block.blockType)).toEqual(["page_header", "venue_reservation", "offering_grid"]);
    expect(visit.blocks[1]).toEqual({ blockType: "venue_reservation", heading: "Book a visit" });
    expect(visit.blocks[2]).toMatchObject({ kind: "all", mode: "upcoming" });
  });

  it("rooms are left out (NO_ROOMS), never an enquiry form, and no button leads to them", () => {
    const result = compose(plan(["venue_stay"], "Reserve this stay"));
    expect(result.create.find((page) => page.slug === "rooms")).toBeUndefined();
    expect(result.pages).not.toContain("rooms");
    expect([...result.menu.items, ...result.menu.more].map((item) => item.key)).not.toContain("rooms");
    expect(result.left_out).toEqual([{ key: "rooms", reason: "NO_ROOMS" }]);
    expect(JSON.stringify(result)).not.toContain("/rooms");
  });

  it("no composed page anywhere says Message to book or takes a booking by enquiry", () => {
    const all = compose(plan(["trips", "events", "experiences", "venue_food_drink", "venue_play", "venue_stay"], "Reserve a table"));
    const text = JSON.stringify(all);
    expect(text).not.toContain("Message to book");
    expect(text).not.toContain("Rooms opening soon");
    for (const block of blocksOf(all)) expect(bookingThroughEnquiryFields(block), JSON.stringify(block)).toEqual([]);
  });

  it("every composed block is shaped like Studio's own block config", () => {
    for (const block of blocksOf(compose(plan(["venue_food_drink", "venue_play"])))) {
      const config = siteBlocks.find((candidate) => candidate.slug === block.blockType);
      expect(config, block.blockType).toBeDefined();
      const names = new Set((config!.fields as any[]).map((field) => field.name));
      for (const key of Object.keys(block)) if (key !== "blockType") expect(names.has(key), `${block.blockType}.${key}`).toBe(true);
    }
  });
});
