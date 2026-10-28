/*
 * #2829 W5 — neutral fixture content for the collection, history and form
 * blocks: two destinations, three stories in two categories, two confirmed
 * testimonials, and pages that use every W5 block. Built on top of the
 * upgraded gögi fixture so the media manifest and design are real.
 *
 * Every word here is invented for tests and names no real brand.
 */
import type { ArtifactV2 } from "./generated/artifactV2.ts";
import type { RichTextDoc } from "./generated/richText.ts";
import { upgradeV1ToV2 } from "./generated/upgradeV1ToV2.ts";
import { FX, fixtureMedia, gogiV1Fixture } from "./gogiV1.fixture";

export const W5 = {
  destinationA: FX(501),
  destinationB: FX(502),
  storyA: FX(511),
  storyB: FX(512),
  storyC: FX(513),
  categoryA: FX(521),
  categoryB: FX(522),
  testimonialA: FX(531),
  testimonialB: FX(532),
  tripEnded1: FX(541),
  tripEnded2: FX(542),
  tripEnded3: FX(543),
};

const doc = (text: string): RichTextDoc => ({ type: "doc", children: [{ type: "paragraph", children: [{ type: "text", text }] }] });

const fonts = [
  { family: "Oswald", weight: 400, style: "normal" as const, unicode_range: "U+0000-00FF", digest: "d".repeat(64), bytes: 1000 },
  { family: "Plus Jakarta Sans", weight: 400, style: "normal" as const, unicode_range: "U+0000-00FF", digest: "e".repeat(64), bytes: 1000 },
];

/** The upgraded gögi fixture plus W5 collections and pages. `storiesAtRoot` puts stories at "/<slug>". */
export function w5Artifact(options: { storiesAtRoot?: boolean } = {}): ArtifactV2 {
  const artifact = upgradeV1ToV2(gogiV1Fixture(), { fontAssets: fonts });
  const picture = fixtureMedia(FX(3));
  artifact.routes = {
    ...artifact.routes,
    destinations: "places",
    stories: options.storiesAtRoot ? "" : "stories",
  };
  artifact.collections = {
    destinations: [
      {
        id: W5.destinationA,
        slug: "harbour-coast",
        title: "Harbour Coast",
        country: "Fixtureland",
        featured_image: picture,
        tagline: "Salt air and slow mornings.",
        summary: "A short summary of the coast.",
        facts: { language: "Fixture tongue", currency: "Fixture coin", timezone: "Coast time" },
        story_heading: "Why we go back",
        body: doc("We keep going back to the coast."),
        seasons: [{ heading: "Summer", body: "Warm water.", activities: ["Swimming", "Boats"] }],
        did_you_know: ["The harbour is older than the town."],
        related_offering_ids: [W5.tripEnded1],
        gallery: [picture],
      },
      { id: W5.destinationB, slug: "pine-valley", title: "Pine Valley" },
    ],
    stories: [
      { id: W5.storyA, slug: "first-light", title: "First light", published_at: "2026-03-02", category: "notes", excerpt: "An early start.", content: doc("We left before dawn.") },
      { id: W5.storyB, slug: "packing-list", title: "Packing list", published_at: "2026-05-10", category: "guides", content: doc("Bring a jumper.") },
      { id: W5.storyC, slug: "old-friends", title: "Old friends", published_at: "2025-11-20", content: doc("We met again.") },
    ],
    categories: [
      { id: W5.categoryA, slug: "notes", title: "Notes" },
      { id: W5.categoryB, slug: "guides", title: "Guides" },
    ],
    testimonials: [
      { id: W5.testimonialA, quote: "Best expierence, would go agian.", reviewer: "Fixture R", review_date: "2025-08-02", trip_name: "Coast Week", related_offering_id: W5.tripEnded1 },
      { id: W5.testimonialB, quote: "Calm and kind.", reviewer: "Fixture S", review_date: "2026-01-15" },
    ],
  };
  artifact.pages.push(
    {
      path: "places",
      title: "Places",
      enabled: true,
      kind: "collection_index",
      collection: "destinations",
      blocks: [{ type: "destination_grid", variant: "neutral", heading: "Where we go" }],
    },
    {
      path: "journal",
      title: "Journal",
      enabled: true,
      kind: "collection_index",
      collection: "stories",
      blocks: [{ type: "story_grid", variant: "neutral", heading: "Stories", limit: 2 }],
    },
    {
      path: "reviews",
      title: "Reviews",
      enabled: true,
      kind: "standard",
      blocks: [
        { type: "testimonials", variant: "atelier", heading: "Reviews from the road", from_collection: true },
        {
          type: "offering_history",
          variant: "neutral",
          heading: "Trips we've run",
          kind: "trip",
          series: [{ label: "Mountain ski series", offering_ids: [{ id: W5.tripEnded2 }, { id: W5.tripEnded3 }] }],
        },
      ],
    },
    {
      path: "contact-us",
      title: "Contact us",
      enabled: true,
      kind: "standard",
      blocks: [
        {
          type: "contact_form",
          variant: "neutral",
          heading: "Write to us",
          show_phone: true,
          message_label: "Your message",
          submit_label: "Send message",
          fallback_email: "hello@fixture.invalid",
        },
        {
          type: "newsletter_signup",
          variant: "neutral",
          heading: "Join the list",
          body: "One letter a month.",
          placeholder: "Your email",
          button_label: "Subscribe",
          small_print: "Unsubscribe any time.",
        },
      ],
    },
  );
  return artifact;
}

/** Ended trips of the fixture brand, in feed shape (newest first, as the feed orders past offerings). */
export function w5EndedTrips() {
  const trip = (id: string, slug: string, title: string, start: string, end: string, place: string | null) => ({
    id,
    kind: "trip" as const,
    slug,
    title,
    summary: null,
    cover: null,
    destination_text: place,
    start_at: start,
    end_at: end,
    timezone: "America/New_York",
    status: "ended" as const,
    bookings_closed: true,
    capacity: null,
    spots_left: null,
    group_minimum: null,
    min_price_minor: null,
    currency: null,
    has_free_tier: false,
    public_url: `https://host.usemingla.com/t/fixture-brand/${slug}`,
    waitlist_enabled: false,
    installments_available: false,
  });
  return [
    trip(W5.tripEnded1, "coast-week-2025", "Coast Week", "2025-06-20T04:00:00.000Z", "2025-06-28T03:59:00.000Z", "Harbour Coast"),
    trip(W5.tripEnded3, "mountain-ski-weekend-2025-2", "Mountain Ski Weekend (Riverton)", "2025-01-21T05:00:00.000Z", "2025-01-22T04:59:00.000Z", "Mountain Town, NC"),
    trip(W5.tripEnded2, "mountain-ski-weekend-2025", "Mountain Ski Weekend (Lakeside)", "2025-01-14T05:00:00.000Z", "2025-01-15T04:59:00.000Z", "Mountain Town, NC"),
  ];
}
