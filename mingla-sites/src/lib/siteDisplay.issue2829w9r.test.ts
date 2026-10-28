import { describe, expect, it } from "vitest";
import { assertArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { storiesNewestFirst, testimonialsNewestFirst } from "../contracts/generated/collections.ts";
import { W5, w5Artifact, w5EndedTrips } from "../contracts/w5Content.fixture";
import { withoutHiddenPast } from "./offeringCards";

/*
 * #2829 W9r — the owner's display choices frozen into the artifact
 * (`site_display`): past Mingla trips hidden from the site (display only) and
 * collections put in the owner's own order. Absent means unchanged.
 */
const NOW = new Date("2026-10-26T12:00:00Z");

describe("#2829 W9r site_display", () => {
  it("is optional: an artifact without it is valid and unchanged", () => {
    const artifact = w5Artifact();
    expect("site_display" in artifact).toBe(false);
    expect(() => assertArtifactV2(artifact)).not.toThrow();
  });

  it("accepts hidden past offerings and manual order, refuses anything else", () => {
    const artifact = w5Artifact();
    artifact.site_display = { hidden_offering_ids: [W5.tripEnded1], manual_order: ["stories"] };
    expect(() => assertArtifactV2(artifact)).not.toThrow();
    for (const bad of [
      {},
      { hidden_offering_ids: [] },
      { hidden_offering_ids: ["not-a-uuid"] },
      { hidden_offering_ids: [W5.tripEnded1, W5.tripEnded1] },
      { manual_order: ["destinations"] },
      { manual_order: ["stories"], extra: true },
    ]) {
      const copy = w5Artifact();
      (copy as unknown as Record<string, unknown>).site_display = bad;
      expect(() => assertArtifactV2(copy)).toThrow("ARTIFACT_DISPLAY_MISMATCH");
    }
  });

  it("drops a hidden ENDED offering from what the site shows, never an upcoming one", () => {
    const ended = w5EndedTrips();
    const upcoming = { ...ended[0]!, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", start_at: "2027-01-01T00:00:00Z", end_at: "2027-01-05T00:00:00Z", status: "scheduled" as const };
    const all = [...ended, upcoming];
    const artifact = { site_display: { hidden_offering_ids: [W5.tripEnded1, upcoming.id] } };
    const shown = withoutHiddenPast(all, artifact, NOW).map((row) => row.id);
    expect(shown).not.toContain(W5.tripEnded1);
    expect(shown).toContain(W5.tripEnded2);
    expect(shown).toContain(upcoming.id);
    expect(withoutHiddenPast(all, {}, NOW)).toHaveLength(all.length);
  });

  it("keeps the owner's story and review order when they reordered, newest first otherwise", () => {
    const stories = w5Artifact().collections.stories;
    const owner = [...stories].reverse();
    expect(storiesNewestFirst(owner, true).map((row) => row.id)).toEqual(owner.map((row) => row.id));
    expect(storiesNewestFirst(owner).map((row) => row.published_at)).toEqual(
      [...stories].map((row) => row.published_at).sort().reverse(),
    );
    const reviews = w5Artifact().collections.testimonials;
    const ownerReviews = [...reviews].reverse();
    expect(testimonialsNewestFirst(ownerReviews, true).map((row) => row.id)).toEqual(ownerReviews.map((row) => row.id));
  });
});
