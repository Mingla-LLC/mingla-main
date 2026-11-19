/*
 * #4453 booking-first Home (Seth, 2026-11-18). Gameland Lagos's live Home was
 * page_header → a two-paragraph manifesto → sessions → … → the events grid and
 * its tickets at the very bottom: no hero, booking buried. The approved order
 * for booking formats is hero → the booking block → the secondary format's
 * next event and its tickets → why us → how it works → pictures / reviews →
 * hours → questions → sign-up last, with no long rich_text on Home.
 *
 * The plan here is shaped like Gameland's: ticks events + experiences, main
 * action "Book an experience" (so experiences is primary, events secondary),
 * no brand cover and no photo in Media, an upcoming experience with an image
 * cover (imported as the hero's picture by heroPictureImport.ts).
 */
import { describe, expect, it } from "vitest";
import { composeFormatSite, type ComposeV2Input } from "./composeFormat";
import { inventoryAndSources, parseSignedDesignPass, type StudioRecords } from "./designPassInputs";
import { FORMAT_KEYS, FORMAT_RECIPES, HOME_BOOKING_TYPES } from "../contracts/generated/formats.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const EXPERIENCE = id(3);
const EVENT = id(2);
const NO_RECORDS: StudioRecords = { photos: [], destination_ids: [], stories: 0, confirmed_reviews: 0, ready_videos: 0, has_logo: false };

function gameland(coverMediaId: string | null): ComposeV2Input {
  const signed = parseSignedDesignPass({
    design_key: "pop",
    plan: {
      offerings_selected: ["events", "experiences"],
      venue_descriptor: "Activity centre",
      story: {
        who: "Friends, families and teams who want a loud, happy night out in Lagos.",
        why: "Play is how grown-ups make friends.",
        main_action: "Book an experience",
      },
    },
    answers: {
      value_points: [
        { title: "Games for everyone", sentence: "Arcade, VR and bowling under one roof." },
        { title: "Parties sorted", sentence: "We host birthdays and team nights." },
        { title: "Open late", sentence: "Play on after dinner." },
      ],
      faq: [{ question: "Can kids come?", answer: "Yes, with an adult." }],
      process_steps: [
        { title: "Pick a session", text: "Choose a time." },
        { title: "Pay online", text: "Hold your place." },
        { title: "Come and play", text: "Show your ticket at the door." },
      ],
      quick_facts: null,
    },
    address: "1 Admiralty Way, Lekki, Lagos",
    facts: {
      upcoming: { trip: 0, event: 2, experience: 3 },
      ended: { trip: 0, event: 0, experience: 0 },
      next_offering: { event: EVENT, experience: EXPERIENCE },
      bookable: { event: 2, experience: 5 },
      public_ticket_tiers: 2,
      mingla_reviews: 0,
    },
    style_library: true,
    live_fingerprints: [],
  })!;
  const brand = { name: "Gameland Lagos", tagline: "Play more. Worry less.", bio: "Gameland is Lagos's arcade.\n\nWe opened in 2019.", contact_email: "hi@example.com", city: "Lagos" };
  const { inventory, sources } = inventoryAndSources({ signed, records: NO_RECORDS, offerings_selected: signed.plan!.offerings_selected, brand, cover_media_id: coverMediaId });
  return {
    plan: signed.plan!,
    answers: signed.answers,
    brand,
    design: "pop",
    bookingBlocks: true,
    inventory,
    sources,
    existing: [],
    currentWordmark: null,
  };
}

describe("#4453 booking-first Home — a Gameland-shaped brand", () => {
  it("opens on the hero with the imported offering picture, then booking, then the next event and its tickets", () => {
    const result = composeFormatSite(gameland("media-imported-experience-cover"))!;
    expect(result.format).toBe("experiences");
    expect(result.secondary).toEqual(["events"]);
    const home = result.pages[0]!.blocks;
    expect(home.map((block) => block.blockType)).toEqual([
      "hero",
      "offering_grid",
      "availability",
      "offering_grid",
      "ticket_tiers",
      "feature_cards",
      "process_steps",
      "faq",
      "page_links",
      "newsletter_signup",
    ]);
    const [hero, sessions, times, nextUp, tickets] = home;
    expect(hero).toMatchObject({ blockType: "hero", media: "media-imported-experience-cover", heading: "Play more. Worry less.", subheading: "Play is how grown-ups make friends." });
    expect(hero!.ctas).toEqual([{ label: "Book a session", href: "/sessions" }]);
    expect(hero).toMatchObject({ booking_bar: "experience", booking_target_id: EXPERIENCE });
    expect(sessions).toMatchObject({ kind: "experience", limit: 3 });
    expect(times).toMatchObject({ source: "experience_slots", offering_id: EXPERIENCE });
    expect(nextUp).toMatchObject({ kind: "event", heading: "Next up", limit: 1 });
    expect(tickets).toMatchObject({ offering_id: EVENT });
    // The long "who / why" manifesto no longer sits on Home; About keeps the bio.
    expect(home.some((block) => block.blockType === "rich_text")).toBe(false);
    const about = result.pages.find((page) => page.key === "about");
    expect(about?.blocks.some((block) => block.blockType === "rich_text")).toBe(true);
  });

  it("without any picture it still opens on the page header, then the booking block (never invents a picture)", () => {
    const result = composeFormatSite(gameland(null))!;
    const types = result.pages[0]!.blocks.map((block) => block.blockType);
    expect(types.slice(0, 5)).toEqual(["page_header", "offering_grid", "availability", "offering_grid", "ticket_tiers"]);
    expect(result.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ page: "home", type: "hero", reason: "NO_PHOTO" })]));
  });
});

describe("#4453 booking-first recipes", () => {
  it("every booking format puts its booking block straight after the hero, and the sign-up last", () => {
    for (const format of ["experiences", "play", "events", "restaurants", "hotels"] as const) {
      const types = FORMAT_RECIPES[format].map((section) => section.type);
      expect(types[0], format).toBe("hero");
      expect((HOME_BOOKING_TYPES as readonly string[]).includes(types[1]!), `${format}: ${types[1]}`).toBe(true);
      expect(types[types.length - 1], format).toBe("newsletter_signup");
      expect(types.indexOf("page_links"), format).toBe(types.length - 2);
      expect(types, format).not.toContain("rich_text");
    }
  });

  it("every format's Home still ends with the teaser then the sign-up", () => {
    for (const format of FORMAT_KEYS) {
      const types = FORMAT_RECIPES[format].map((section) => section.type);
      expect(types.slice(-2), format).toEqual(["page_links", "newsletter_signup"]);
    }
  });
});
