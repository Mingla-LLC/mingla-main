/*
 * #2829 W9a (T-W9, SC-28/29) — the deterministic composer behind "Create
 * website draft": exactly the pages the plan asks for, in M1 menu order
 * (more than six → "More"), the honest empty states verbatim, text only from
 * brand fields and the owner's answers (a missing source leaves its block
 * out), reviews only when confirmed ones exist, an owner's existing pages
 * kept, and every block shaped exactly like Studio's own block configs.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./observability", () => ({ emitCmsObservation: vi.fn(), observeCmsEndpoint: (_r: string, _d: string, handler: unknown) => handler }));
vi.mock("./gateway", () => ({ callCore: vi.fn(), verifyCoreRequest: vi.fn() }));

import { composeFromPlan, type ComposeBrand, type ComposePlan } from "./composeFromPlan";
import { parseComposeBody } from "../endpoints/composeEndpoint";
import { lookChanged, reportLookSavedHook, savedDesignKey } from "./lookSavedReport";
import { siteBlocks } from "../blocks/siteBlocks";
import { emitCmsObservation } from "./observability";

const emptyBrand: ComposeBrand = { name: "Neutral Trips", tagline: null, bio: null, contact_email: null, city: null };
const plan = (offerings: string[], story: ComposePlan["story"] = null): ComposePlan => ({
  offerings_selected: offerings, venue_descriptor: null, story,
});
const fresh = [{ id: "home-1", slug: "", topLevel: true, blockCount: 0 }];
const compose = (p: ComposePlan, brand: ComposeBrand = emptyBrand, extra: Partial<Parameters<typeof composeFromPlan>[0]> = {}) =>
  composeFromPlan({ plan: p, brand, hasConfirmedTestimonials: false, existing: fresh, currentWordmark: null, ...extra });

function allBlocks(result: ReturnType<typeof composeFromPlan>) {
  return [...result.create, ...(result.fillHome ? [result.fillHome] : [])].flatMap((page) => page.blocks);
}

describe("#2829 W9a composer: the page set (SC-28)", () => {
  it("Trips and Events ticked: exactly Home, Trips, Events, About, Contact; menu M1 with Home as the logo", () => {
    const result = compose(plan(["trips", "events"]));
    expect(result.pages).toEqual(["home", "trips", "events", "about", "contact"]);
    expect(result.fillHome?.slug).toBe("");
    expect(result.create.map((page) => page.slug)).toEqual(["trips", "events", "about", "contact"]);
    expect(result.menu.items.map((item) => item.label)).toEqual(["Trips", "Events", "About", "Contact"]);
    expect(result.menu.more).toEqual([]);
  });

  it("Events left unticked: no Events page", () => {
    const result = compose(plan(["trips"]));
    expect(result.pages).toEqual(["home", "trips", "about", "contact"]);
    expect(result.create.some((page) => page.slug === "events")).toBe(false);
  });

  it("nothing ticked: Home, About and Contact only, with the email form on Home", () => {
    const result = compose(plan([]));
    expect(result.pages).toEqual(["home", "about", "contact"]);
    expect(result.fillHome?.blocks.map((block) => block.blockType)).toEqual(["page_header", "newsletter_signup"]);
  });

  it("the main offering leads the menu; more than six items go under More", () => {
    const main = compose(plan(["trips", "events"], { main_action: "Come to an event" }));
    expect(main.menu.items.map((item) => item.slug)).toEqual(["events", "trips", "about", "contact"]);
    const wide = compose(plan(["trips", "events", "experiences", "venue_food_drink", "venue_play", "venue_stay"]));
    expect(wide.menu.items.map((item) => item.label)).toEqual(["Trips", "Events", "Experiences", "Menu", "Visit"]);
    expect(wide.menu.more.map((item) => item.label)).toEqual(["Rooms", "About", "Contact"]);
  });

  it("offering pages are live lists with the rules table's empty state and a form (SC-29)", () => {
    const trips = compose(plan(["trips", "events"])).create.find((page) => page.slug === "trips")!;
    expect(trips).toMatchObject({ kind: "collection_index", collection_kind: "trips", planned_offering: "trips" });
    expect(trips.blocks[1]).toMatchObject({ blockType: "offering_grid", kind: "trip", mode: "upcoming", empty_text: "No trips on sale yet. Tell us where you want to go" });
    expect(trips.blocks[2]).toMatchObject({ blockType: "contact_form", heading: "Tell us where you want to go" });
    const events = compose(plan(["events"])).create.find((page) => page.slug === "events")!;
    expect(events.blocks[1]).toMatchObject({ empty_text: "Nothing on the calendar yet. Hear first" });
    expect(events.blocks[2]).toMatchObject({ blockType: "newsletter_signup", heading: "Hear first" });
    const rooms = compose(plan(["venue_stay"])).create.find((page) => page.slug === "rooms")!;
    expect(rooms.blocks[1]).toMatchObject({ blockType: "contact_form", heading: "Rooms opening soon" });
    const menu = compose(plan(["venue_food_drink"])).create.find((page) => page.slug === "menu")!;
    expect(menu.blocks[1]).toMatchObject({ blockType: "cta", heading: "Our menu is on its way", label: "Message to book", href: "/contact" });
    const visit = compose(plan(["venue_play"])).create.find((page) => page.slug === "visit")!;
    expect(visit.blocks[1]).toMatchObject({ blockType: "cta", heading: "Message to book", label: "Message to book", href: "/contact" });
  });
});

describe("#2829 W9a composer: no invented text", () => {
  it("an empty profile: the name on a colour panel, no tagline, no About text, no contact tiles", () => {
    const result = compose(plan(["trips"]));
    expect(result.fillHome?.blocks[0]).toEqual({ blockType: "page_header", heading: "Neutral Trips" });
    const about = result.create.find((page) => page.slug === "about")!;
    expect(about.blocks.map((block) => block.blockType)).toEqual(["page_header"]);
    const contact = result.create.find((page) => page.slug === "contact")!;
    expect(contact.blocks.map((block) => block.blockType)).toEqual(["page_header", "contact_form"]);
    expect(result.wordmark).toBe("Neutral Trips");
    // Every heading is the brand's own words or one of Mingla's fixed labels.
    const fixed = new Set(["Neutral Trips", "Trips", "About", "Contact", "Tell us where you want to go", "Hear first"]);
    for (const block of allBlocks(result)) {
      if (typeof block.heading === "string") expect(fixed.has(block.heading)).toBe(true);
    }
  });

  it("uses the tagline, the bio, the owner's answers and contact details exactly as given", () => {
    const result = compose(
      plan(["trips"], { who: "First-time solo travellers", why: "You leave with a group chat that lasts", main_action: "Reserve the next trip" }),
      { name: "Neutral Trips", tagline: "Travel the world.", bio: "We run small trips.\n\nTen people at most.", contact_email: "hi@neutral.invalid", city: "Raleigh" },
    );
    const home = result.fillHome!.blocks;
    expect(home[0]).toEqual({ blockType: "page_header", heading: "Travel the world." });
    expect(home[1]).toEqual({ blockType: "cta", heading: "You leave with a group chat that lasts", label: "Reserve the next trip", href: "/trips" });
    expect(home[2]).toMatchObject({ blockType: "offering_grid", kind: "trip", limit: 3 });
    const about = result.create.find((page) => page.slug === "about")!;
    const paragraphs = ((about.blocks[1]!.content as { root: { children: Array<{ children: Array<{ text: string }> }> } }).root.children)
      .map((paragraph) => paragraph.children[0]!.text);
    expect(paragraphs).toEqual(["We run small trips.", "Ten people at most."]);
    expect(result.create.find((page) => page.slug === "contact")!.blocks[2]).toEqual({ blockType: "contact_details", email: "hi@neutral.invalid", location: "Raleigh" });
  });

  it("About falls back to the story answers when there is no bio", () => {
    const result = compose(plan([], { who: "Families nearby", why: "Kids run free" }));
    const about = result.create.find((page) => page.slug === "about")!;
    expect(JSON.stringify(about.blocks[1])).toContain("Families nearby");
  });

  it("reviews only when the brand has confirmed ones", () => {
    expect(allBlocks(compose(plan(["trips"]))).some((block) => block.blockType === "testimonials")).toBe(false);
    expect(compose(plan(["trips"]), emptyBrand, { hasConfirmedTestimonials: true }).fillHome!.blocks.some((block) => block.blockType === "testimonials")).toBe(true);
  });
});

describe("#2829 W9a composer: an owner's work is never overwritten", () => {
  it("keeps existing pages and a Home with content; reports them as built", () => {
    const result = compose(plan(["trips"]), emptyBrand, {
      existing: [
        { id: "home-1", slug: "", topLevel: true, blockCount: 4 },
        { id: "trips-1", slug: "trips", topLevel: true, blockCount: 2 },
        { id: "nested", slug: "about", topLevel: false, blockCount: 1 },
      ],
      currentWordmark: "Owner's Wordmark",
    });
    expect(result.fillHome).toBeNull();
    expect(result.create.map((page) => page.slug)).toEqual(["about", "contact"]);
    expect(result.pages).toEqual(["home", "trips", "about", "contact"]);
    expect(result.wordmark).toBe("Owner's Wordmark");
  });
});

describe("#2829 W9a composer: blocks match Studio's own block configs", () => {
  it("every composed field exists on its Studio block, required fields present", () => {
    const result = compose(
      plan(["trips", "events", "experiences", "venue_food_drink", "venue_play", "venue_stay"], { who: "a", why: "b", main_action: "Come to an event" }),
      { name: "N", tagline: "T", bio: "B", contact_email: "e@x.invalid", city: "C" },
      { hasConfirmedTestimonials: true },
    );
    for (const block of allBlocks(result)) {
      const config = siteBlocks.find((candidate) => candidate.slug === block.blockType);
      expect(config, block.blockType).toBeDefined();
      const fields = new Map(config!.fields.flatMap((field) => ("name" in field ? [[field.name, field]] : [])));
      for (const key of Object.keys(block)) {
        if (key === "blockType") continue;
        expect(fields.has(key), `${block.blockType}.${key}`).toBe(true);
      }
      for (const [name, field] of fields) {
        if ((field as { required?: boolean }).required && name !== "media") {
          expect(block[name], `${block.blockType}.${name} required`).toBeDefined();
        }
      }
    }
  });
});

describe("#2829 W9a the signed compose body", () => {
  const site = "11111111-1111-4111-8111-111111111111";
  const good = {
    kind: "compose_from_plan", site_id: site, brand_id: "733bc470-45e1-4684-8896-acd7e26074ff",
    user_id: "c1d2e3f4-a5b6-4c7d-8e9f-a0b1c2d3e4f5",
    plan: { offerings_selected: ["trips", "rockets"], venue_descriptor: null, story: null },
    brand: { name: "N", tagline: null, bio: null, contact_email: null, city: null },
  };
  it("accepts Core's body and drops unknown offering keys", () => {
    expect(parseComposeBody(good, site)?.plan.offerings_selected).toEqual(["trips"]);
  });
  it("refuses another site's body, extra keys, or a nameless brand", () => {
    expect(parseComposeBody(good, "99999999-1111-4111-8111-111111111111")).toBeNull();
    expect(parseComposeBody({ ...good, blocks: [] }, site)).toBeNull();
    expect(parseComposeBody({ ...good, brand: { ...good.brand, name: " " } }, site)).toBeNull();
  });
});

describe("#2829 W11 the brand's cover opens Home (A17)", () => {
  it("with a cover: Home starts with a hero on that photo and the brand's line; no colour panel", () => {
    const home = compose(plan(["trips"]), { ...emptyBrand, tagline: "Travel the world." }, { coverMediaId: "media-9" }).fillHome!;
    expect(home.blocks[0]).toEqual({ blockType: "hero", heading: "Travel the world.", media: "media-9", ctas: [] });
    expect(home.blocks.some((block) => block.blockType === "page_header")).toBe(false);
  });
  it("without one: the intentional colour panel, as before", () => {
    expect(compose(plan(["trips"])).fillHome!.blocks[0]).toEqual({ blockType: "page_header", heading: "Neutral Trips" });
  });
  it("the hero carries only fields Studio's hero block has, with its required photo", () => {
    const hero = siteBlocks.find((block) => block.slug === "hero")!;
    const names = new Set(hero.fields.flatMap((field) => ("name" in field ? [field.name] : [])));
    const block = compose(plan([]), emptyBrand, { coverMediaId: "m" }).fillHome!.blocks[0]!;
    for (const key of Object.keys(block).filter((key) => key !== "blockType")) expect(names.has(key)).toBe(true);
    expect(block.media).toBe("m");
  });
  const site = "11111111-1111-4111-8111-111111111111";
  const body = (cover: unknown) => ({
    kind: "compose_from_plan", site_id: site, brand_id: "733bc470-45e1-4684-8896-acd7e26074ff",
    user_id: "c1d2e3f4-a5b6-4c7d-8e9f-a0b1c2d3e4f5",
    plan: { offerings_selected: [], venue_descriptor: null, story: null },
    brand: { name: "N", tagline: null, bio: null, contact_email: null, city: null, ...(cover === undefined ? {} : { cover_photo_path: cover }) },
  });
  it("the signed body may name a cover only in Mingla's brand-cover storage", () => {
    expect(parseComposeBody(body("brand_covers/b/c.jpg"), site)?.coverPhotoPath).toBe("brand_covers/b/c.jpg");
    expect(parseComposeBody(body(undefined), site)?.coverPhotoPath).toBeNull();
    for (const bad of ["event_covers/e/c.jpg", "brand_covers/../x.jpg", "https://images.pexels.com/a.jpg", "brand_covers//c.jpg", 7]) {
      expect(parseComposeBody(body(bad), site)).toBeNull();
    }
  });
});

describe("#2829 W9a the look-saved report", () => {
  const req = { payload: { findByID: async () => ({ core_site_id: "11111111-1111-4111-8111-111111111111" }) } };
  it("reports a changed look once, with the design key", async () => {
    const report = vi.fn(async () => ({}));
    const hook = reportLookSavedHook(report);
    await hook({ doc: { tenant: "t", design: "voyage", tokens: { a: 1 } }, previousDoc: { tenant: "t", design: "voyage" }, operation: "update", req } as never);
    expect(report).toHaveBeenCalledWith("/internal/v1/sites/11111111-1111-4111-8111-111111111111/look-saved", "11111111-1111-4111-8111-111111111111", expect.any(String), { design_key: "voyage" });
    report.mockClear();
    await hook({ doc: { tenant: "t", display_name: "x" }, previousDoc: { tenant: "t", display_name: "y" }, operation: "update", req } as never);
    expect(report).not.toHaveBeenCalled();
  });
  it("a failed report never undoes the save, and is observed", async () => {
    const hook = reportLookSavedHook(async () => { throw new Error("CORE_UNAVAILABLE"); });
    const doc = { tenant: "t", design: "atelier", motion: "calm" };
    await expect(hook({ doc, previousDoc: { tenant: "t", design: "atelier" }, operation: "update", req } as never)).resolves.toBe(doc);
    expect(emitCmsObservation).toHaveBeenCalledWith(expect.objectContaining({ metric: "cms.look_saved.report_failed" }));
  });
  it("knows what counts as the look", () => {
    expect(lookChanged({ design: "atelier" }, { design: "voyage" })).toBe(true);
    expect(lookChanged({ seo_title: "a" }, { seo_title: "b" })).toBe(false);
    expect(savedDesignKey({ design: null })).toBe("atelier");
  });
});
