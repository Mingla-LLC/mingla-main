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

import { actionScopeFromCore, artifactOutboundActionLinks, assertNoOutboundActionLinks, OutboundActionLinkError } from "./bookingLock";
import { safeActionUrl, safeUrl } from "./validation";
import { composeFromPlan, type ComposePlan } from "./composeFromPlan";
import { assertAriBookingLock, ARI_REFUSAL_CODES, AriRefusal, type AriActionContext } from "./ariSiteActions";
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
      expect.objectContaining({ pagePath: "", blockIndex: 0, blockType: "cta", field: "href", problem: "outside_mingla" }),
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

  it("[TRANSITIONAL] without Core's scope the check is brand-agnostic but still refuses other sites", () => {
    expect(() => assertNoOutboundActionLinks(artifact("https://calendly.com/x", undefined))).toThrow(OUTBOUND_ACTION_LINK);
    expect(() => assertNoOutboundActionLinks(artifact("https://host.usemingla.com/t/another-brand/x", undefined))).not.toThrow();
  });

  it("is an owner-fixable refusal code, not an outage", async () => {
    const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("../endpoints/sitesEndpoints.ts", import.meta.url), "utf8"));
    expect(source.match(/"OUTBOUND_ACTION_LINK",/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain("actionScope: actionScopeFromCore(body.action_scope)");
    expect(source).toContain("enforceActionLinks: true");
  });
});

describe("#4453 Core's signed action scope", () => {
  it("keeps a well-formed scope and drops a malformed one", () => {
    expect(actionScopeFromCore({ brand_slug: "young-and-stamped", contact_email: " hello@youngandstamped.com ", contact_phone: "+234 801 234 5678" }))
      .toEqual({ brand_slug: "young-and-stamped", contact_email: "hello@youngandstamped.com", contact_phone: "+234 801 234 5678" });
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
  });

  it("every Studio block button field uses the action check; map and directions links do not", () => {
    const validatorOf = (slug: string, name: string) =>
      (siteBlocks.find((block) => block.slug === slug)!.fields as any[]).find((field) => field.name === name)?.validate;
    expect(validatorOf("cta", "href")).toBe(safeActionUrl);
    expect(validatorOf("contact_handoff", "href")).toBe(safeActionUrl);
    expect(validatorOf("menu_link", "href")).toBe(safeActionUrl);
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
