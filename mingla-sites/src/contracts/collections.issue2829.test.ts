/* eslint-disable @typescript-eslint/no-explicit-any -- this suite mutates untyped artifact JSON on purpose to prove each refusal. */
/*
 * #2829 W5 (T-W5) — the site's content collections and the W5 blocks in the
 * v2 artifact contract, and the "Trips we've run" ledger.
 *
 *  - destinations, stories, categories and confirmed testimonials validate;
 *    unknown keys (an internal source note, a rating), markup, media that is
 *    not this artifact's, duplicate addresses and a story in a missing
 *    category are refused;
 *  - blocks that point into a collection must point at something it carries;
 *  - a testimonials block is typed quotes OR the collection, never both;
 *  - a destination or story address that collides with a page refuses the
 *    publish (root-level stories included);
 *  - past trips are not a collection (A1.3) and forms are blocks (A4);
 *  - the ledger lists ended trips only (cancelled never ran), one row per
 *    departure, runs grouped under the owner's name, newest first.
 */
import { describe, expect, it } from "vitest";
import { assertArtifactV2 } from "./generated/artifactV2.ts";
import { historyLedger, ledgerDepartureCount } from "./generated/history.ts";
import { fixtureMedia } from "./gogiV1.fixture";
import { W5, w5Artifact, w5EndedTrips } from "./w5Content.fixture";

function expectRefused(mutate: (artifact: any) => void, code: string | RegExp, options?: { storiesAtRoot?: boolean }) {
  const artifact = structuredClone(w5Artifact(options)) as any;
  mutate(artifact);
  expect(() => assertArtifactV2(artifact)).toThrow(code);
}

describe("#2829 W5 collections in the artifact", () => {
  it("accepts destinations, stories, categories, testimonials and every W5 block", () => {
    const artifact = w5Artifact();
    expect(() => assertArtifactV2(artifact, JSON.stringify(artifact).length)).not.toThrow();
    expect(() => assertArtifactV2(w5Artifact({ storiesAtRoot: true }))).not.toThrow();
  });

  it("carries no past-trips collection and no forms record", () => {
    expect(Object.keys(w5Artifact().collections).sort()).toEqual(["categories", "destinations", "stories", "testimonials"]);
    expectRefused((a) => { a.collections.past_trips = []; }, "ARTIFACT_COLLECTIONS_MISMATCH");
    expectRefused((a) => { a.forms = { contact: null, newsletter: null }; }, "ARTIFACT_SCHEMA_MISMATCH");
  });

  it("refuses an unconfirmed-review field, a rating or a source note on a testimonial", () => {
    expectRefused((a) => { a.collections.testimonials[0].source_note = "from a spreadsheet"; }, "ARTIFACT_COLLECTIONS_MISMATCH");
    expectRefused((a) => { a.collections.testimonials[0].rating = 5; }, "ARTIFACT_COLLECTIONS_MISMATCH");
    expectRefused((a) => { a.collections.testimonials[0].confirmed_real = true; }, "ARTIFACT_COLLECTIONS_MISMATCH");
    expectRefused((a) => { a.collections.testimonials[0].review_date = "2025-02-30"; }, "ARTIFACT_COLLECTIONS_MISMATCH");
  });

  it("refuses markup, bad addresses, foreign media and duplicates", () => {
    expectRefused((a) => { a.collections.destinations[0].tagline = "<script>x</script>"; }, "ARTIFACT_COLLECTIONS_MISMATCH");
    expectRefused((a) => { a.collections.destinations[0].slug = "Harbour Coast"; }, "ARTIFACT_COLLECTIONS_MISMATCH");
    expectRefused((a) => { a.collections.destinations[0].featured_image = fixtureMedia("aaaaaaaa-bbbb-4ccc-8ddd-000000009999"); }, "ARTIFACT_MEDIA_MISMATCH");
    expectRefused((a) => { a.collections.stories[1].slug = "first-light"; }, "ARTIFACT_COLLECTIONS_MISMATCH");
    expectRefused((a) => { a.collections.stories[0].category = "missing"; }, "ARTIFACT_COLLECTIONS_MISMATCH");
    expectRefused((a) => { a.collections.destinations[0].related_offering_ids = ["not-a-uuid"]; }, "ARTIFACT_COLLECTIONS_MISMATCH");
    expectRefused((a) => { a.collections.stories[0].content = { type: "doc", children: [{ type: "html", value: "<b>" }] }; }, /RICH_TEXT|ARTIFACT/);
  });

  it("refuses a block that points at nothing the publication carries", () => {
    expectRefused((a) => { a.pages.find((p: any) => p.path === "places").blocks[0].destinations = [{ slug: "atlantis" }]; }, "ARTIFACT_COLLECTION_REFERENCE");
    expectRefused((a) => { a.pages.find((p: any) => p.path === "journal").blocks[0].category = "unknown"; }, "ARTIFACT_COLLECTION_REFERENCE");
    expectRefused((a) => { a.collections.testimonials = []; }, "ARTIFACT_COLLECTION_REFERENCE");
    expectRefused((a) => { a.pages.find((p: any) => p.path === "reviews").blocks[0].testimonial_ids = [{ id: W5.storyA }]; }, "ARTIFACT_COLLECTION_REFERENCE");
  });

  it("keeps a testimonials block to one source", () => {
    expectRefused((a) => {
      a.pages.find((p: any) => p.path === "reviews").blocks[0].items = [{ name: "X", quote: "Y" }];
    }, "testimonials.source");
    expectRefused((a) => {
      delete a.pages.find((p: any) => p.path === "reviews").blocks[0].from_collection;
    }, "testimonials.source");
  });

  it("refuses a destination or story that would answer a page's address", () => {
    expectRefused((a) => {
      a.pages.push({ path: "places/harbour-coast", title: "Clash", enabled: true, kind: "standard", blocks: [{ type: "divider", variant: "atelier" }] });
    }, "ARTIFACT_PATH_COLLISION");
    // Stories at the site root: a story named like a page collides with it.
    expectRefused((a) => { a.collections.stories[0].slug = "journal"; }, "ARTIFACT_PATH_COLLISION", { storiesAtRoot: true });
  });

  it("validates the new block fields", () => {
    expectRefused((a) => { a.pages.find((p: any) => p.path === "contact-us").blocks[0].fallback_email = "not an email"; }, "contact_form.fallback_email");
    expectRefused((a) => { delete a.pages.find((p: any) => p.path === "contact-us").blocks[1].button_label; }, "newsletter_signup.button_label");
    expectRefused((a) => { a.pages.find((p: any) => p.path === "contact-us").blocks[0].extra_field = "anything"; }, "ARTIFACT_BLOCK_TYPE_MISMATCH");
    expectRefused((a) => {
      a.pages.find((p: any) => p.path === "reviews").blocks[1].series = [{ label: "One", offering_ids: [{ id: W5.tripEnded1 }] }];
    }, "offering_history.series");
  });
});

describe("#2829 W5 the trips-we've-run ledger", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  const series = [{ label: "Mountain ski series", offering_ids: [{ id: W5.tripEnded2 }, { id: W5.tripEnded3 }] }];

  it("groups a run, keeps every departure, newest first", () => {
    const entries = historyLedger(w5EndedTrips(), now, { kind: "trip", series });
    expect(entries.map((entry) => entry.kind)).toEqual(["single", "series"]);
    const run = entries[1]!;
    if (run.kind !== "series") throw new Error("expected a run");
    expect(run.name).toBe("Mountain ski series");
    expect(run.place).toBe("Mountain Town, NC");
    expect(run.departures.map((departure) => departure.date)).toEqual(["2025-01-14", "2025-01-21"]);
    expect([run.first, run.last]).toEqual(["2025-01-14", "2025-01-21"]);
    expect(ledgerDepartureCount(entries)).toBe(3);
  });

  it("dates each departure in its own timezone", () => {
    const [first] = historyLedger(w5EndedTrips(), now, { kind: "trip" });
    // 2025-06-20T04:00Z is midnight on 20 June in New York.
    expect(first?.kind === "single" && first.departure.date).toBe("2025-06-20");
  });

  it("lists only ended offerings; a cancelled or upcoming trip is not history", () => {
    const trips = w5EndedTrips();
    const cancelled = { ...trips[0]!, id: "aaaaaaaa-bbbb-4ccc-8ddd-000000000901", status: "cancelled" as const, start_at: "2025-03-01T05:00:00.000Z", end_at: "2025-03-02T05:00:00.000Z" };
    const upcoming = { ...trips[0]!, id: "aaaaaaaa-bbbb-4ccc-8ddd-000000000902", status: "scheduled" as const, start_at: "2027-03-01T05:00:00.000Z", end_at: "2027-03-02T05:00:00.000Z" };
    const ids = historyLedger([...trips, cancelled, upcoming], now, { kind: "trip" })
      .map((entry) => (entry.kind === "single" ? entry.departure.id : "run"));
    expect(ids).not.toContain(cancelled.id);
    expect(ids).not.toContain(upcoming.id);
  });

  it("lets a run of one stand alone and never invents a shared place", () => {
    const trips = w5EndedTrips();
    const lonely = historyLedger(trips.slice(0, 2), now, { kind: "trip", series });
    expect(lonely.every((entry) => entry.kind === "single")).toBe(true);
    const mixed = trips.map((trip) => (trip.id === W5.tripEnded3 ? { ...trip, destination_text: "Elsewhere" } : trip));
    const run = historyLedger(mixed, now, { kind: "trip", series }).find((entry) => entry.kind === "series");
    expect(run?.kind === "series" && run.place).toBeNull();
  });
});
