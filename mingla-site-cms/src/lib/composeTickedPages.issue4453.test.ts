/**
 * #4453 — Young and Stamped (19 Nov): the plan ticks trips AND events, with no
 * events on Mingla yet. Composer v2 left the Events page out, so Core's
 * "Build your pages" (every ticked offering's page built) could never tick and
 * Host showed "We couldn't create your draft" on every Build and Rebuild. Host
 * promises "Each tick gets a page on your site, even before it has anything on
 * it"; Seth chose that: the ticked page waits with a sign-up. An owner's
 * existing Contact page that is still empty is composed too.
 */
import { describe, expect, it } from "vitest";
import { composeFormatSite, plannedKeysOf, type ComposeV2Input } from "./composeFormat";
import { EMPTY_INVENTORY } from "../contracts/generated/sectionSources.ts";

const tripId = "00000000-0000-4000-8000-000000000001";

function youngAndStamped(existing: ComposeV2Input["existing"] = []): ComposeV2Input {
  return {
    plan: { offerings_selected: ["trips", "events"], venue_descriptor: null, story: { who: "Young professionals", why: "We organize everything, so you just have to show up.", main_action: "Reserve the next trip" } },
    answers: { value_points: [{ title: "Curated Group Trips", sentence: "Explore the world with like-minded travelers." }], faq: [], process_steps: [], quick_facts: null },
    brand: { name: "Young and Stamped", tagline: null, bio: "Travel the World. Find Your People.", contact_email: "hello@example.com", city: "Raleigh, NC" },
    design: "voyage",
    inventory: { ...EMPTY_INVENTORY, upcoming: { trip: 1, event: 0, experience: 0 }, value_points: 1, has_bio: true, has_contact_email: true, has_city: true, has_cover: true },
    sources: { cover_media_id: "media-cover", photos: [], destination_ids: [], next_offering: { trip: tripId }, bookable: { trip: 1 }, venue_id: {}, stay_offering_id: null, address: null },
    existing,
    currentWordmark: null,
  };
}

describe("#4453 a ticked offering always gets its page", () => {
  it("places Events with no events listed, waiting with a sign-up, and Core may tick it", () => {
    const result = composeFormatSite(youngAndStamped())!;
    const events = result.pages.find((page) => page.key === "events");
    expect(events, "the Events page").toBeTruthy();
    expect(events!.blocks.map((block) => block.blockType)).toContain("newsletter_signup");
    expect(events!.blocks.find((block) => block.blockType === "newsletter_signup")?.heading).toBe("Be the first to hear");
    expect(events!.blocks.some((block) => block.blockType === "offering_grid")).toBe(false);
    expect(result.left_out_pages.map((entry) => entry.key)).not.toContain("events");
    expect(result.menu.items.map((item) => item.slug)).toContain("events");
    // What Core ticks "Build your pages" from: both ticked offerings.
    expect(plannedKeysOf(result)).toEqual(expect.arrayContaining(["home", "trips", "events"]));
  });

  it("still leaves out a page that stands for no ticked offering (FAQ with no questions)", () => {
    const result = composeFormatSite(youngAndStamped())!;
    expect(result.left_out_pages.map((entry) => entry.key)).toContain("faq");
    expect(result.pages.some((page) => page.key === "faq")).toBe(false);
  });

  it("composes an owner's existing empty Contact page (trips has no Contact of its own)", () => {
    const result = composeFormatSite(youngAndStamped([{ id: "contact-id", slug: "contact", topLevel: true, blockCount: 0 }]))!;
    const contact = result.pages.find((page) => page.slug === "contact");
    expect(contact?.blocks.map((block) => block.blockType)).toEqual(["page_header", "contact_details", "contact_form"]);
    expect(result.menu.items.map((item) => item.slug).at(-1)).toBe("contact");
    expect(plannedKeysOf(result)).toContain("contact");
  });

  it("does not add a Contact page the owner never had, nor touch one the owner filled", () => {
    expect(composeFormatSite(youngAndStamped())!.pages.some((page) => page.slug === "contact")).toBe(false);
    const filled = composeFormatSite(youngAndStamped([{ id: "contact-id", slug: "contact", topLevel: true, blockCount: 3, allDraft: false }]))!;
    expect(filled.pages.some((page) => page.slug === "contact")).toBe(false);
  });
});
