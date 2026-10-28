/*
 * #2829 W7c — fix-ups after the travel pilot's parity review (A13):
 *  - A13.4: a review attached to its Mingla trip prints the trip's name as
 *    plain text on voyage's quote wall (never a link), the review's own trip
 *    name first, else the attached trip's title.
 *  - A13.1: an offering card offers its cover's publish-time renditions as
 *    `srcset` (count-aware `sizes`), and the candidate probe refuses a
 *    rendition whose bytes are not its digest.
 *  - A13.2 (about-us 390): the brand film's 16:9 poster is offered
 *    uncropped (the 1600-wide picture only, never the 4:3 crops).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { readPrivateObject } = vi.hoisted(() => ({ readPrivateObject: vi.fn() }));
vi.mock("../../lib/storageReader", () => ({ readPrivateObject }));
vi.mock("../../lib/config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 9).toString("base64"), videoCdnHosts: [] }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { VoyagePage } from "./VoyagePage";
import { voyageSyntheticArtifact } from "../../contracts/voyageSynthetic.fixture";
import { W5, w5EndedTrips } from "../../contracts/w5Content.fixture";
import { assertArtifactV2, offeringMediaKey, type ArtifactV2, type OfferingCoverMedia } from "../../contracts/generated/artifactV2.ts";
import { verifyCandidateOfferingMedia } from "../../app/api/internal/candidate-probe/route";
import { sha256 } from "../../lib/crypto";
import { offeringMediaToken } from "../../lib/offeringMedia";
import { srcSetFor } from "./parts";
import type { SiteOffering } from "../../contracts/generated/offerings.ts";
import { offeringCard, offeringFilters, type LiveOfferings } from "../../lib/offeringCards";
import { resolveSitePath, type ArtifactPage } from "../../lib/pageRouting";
import type { FormsContext } from "../../lib/siteForms";

const NOW = new Date("2026-10-26T12:00:00Z");
const forms = { renderedAt: 1_760_000_000_000, signature: "stamp", enquiries: "available", preview: false, notice: null } as unknown as FormsContext;

async function render(artifact: ArtifactV2, path: string, offerings: SiteOffering[] = w5EndedTrips()) {
  const cards = new Map();
  for (const offering of offerings) cards.set(offering.id, await offeringCard(artifact.site_id, offering, NOW, "en", artifact.offering_media));
  const live: LiveOfferings = { source: "live", offerings, cards, now: NOW, filters: offeringFilters(undefined) };
  const resolved = resolveSitePath(artifact, path);
  const page = resolved.kind === "page" || resolved.kind === "entry" ? (resolved.page as ArtifactPage) : undefined;
  return renderToStaticMarkup(<VoyagePage artifact={artifact} page={page} live={live} forms={forms} nonce="n" notFound={false} />);
}

function quoteWall(html: string): string {
  const start = html.indexOf('class="quote-wall"');
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</section>", start));
}

describe("#2829 W7c quote wall (A13.4)", () => {
  it("prints an attached review's trip name as plain text, never a link", async () => {
    const artifact = voyageSyntheticArtifact();
    const review = artifact.collections.testimonials.find((row) => row.id === W5.testimonialA)!;
    expect(review.related_offering_id).toBe(W5.tripEnded1);
    const wall = quoteWall(await render(artifact, ""));
    expect(wall).toContain("<span>Coast Week</span>");
    expect(wall).not.toContain("<a ");
    expect(wall).not.toContain("coast-week-2025");
  });

  it("falls back to the attached trip's title (still plain text) when the review names no trip", async () => {
    const artifact = voyageSyntheticArtifact();
    const review = artifact.collections.testimonials.find((row) => row.id === W5.testimonialA)!;
    delete review.trip_name;
    const wall = quoteWall(await render(artifact, ""));
    expect(wall).toContain("<span>Coast Week</span>");
    expect(wall).not.toContain("<a ");
  });
});

describe("#2829 W7c offering cover renditions (A13.1)", () => {
  const COVER = "event_covers/fixture/coast.jpg";
  const SOURCE = "d".repeat(64);
  function coverMedia(siteId: string, integrity = "e".repeat(64)): OfferingCoverMedia[] {
    return [{
      path: COVER, source_width: 1200, source_height: 900,
      variants: [
        { name: "c400", width: 400, height: 300, integrity, object_key: offeringMediaKey(siteId, SOURCE, "c400") },
        { name: "c768", width: 768, height: 576, integrity, object_key: offeringMediaKey(siteId, SOURCE, "c768") },
        { name: "w1600", width: 1200, height: 900, integrity, object_key: offeringMediaKey(siteId, SOURCE, "w1600") },
      ],
    }];
  }
  function pastGrid(artifact: ArtifactV2) {
    const home = artifact.pages.find((page) => page.path === "")!;
    home.blocks.splice(2, 0, { type: "offering_grid", variant: "photo-card", heading: "Past", kind: "trip", mode: "past" } as never);
  }

  it("cards carry the renditions as srcset with the count-aware sizes; the contract accepts them", async () => {
    const artifact = voyageSyntheticArtifact();
    pastGrid(artifact);
    artifact.offering_media = coverMedia(artifact.site_id);
    expect(() => assertArtifactV2(artifact)).not.toThrow();
    const trips = w5EndedTrips().map((trip) => ({ ...trip, cover: { path: COVER, type: "image" as const } }));
    const html = await render(artifact, "", trips);
    const base = `/om/${await offeringMediaToken(artifact.site_id, COVER)}`;
    // The 1600 rendition of a 1200-wide cover is 1200 wide: listed once, the
    // stored cover is not larger, so it is not added.
    expect(html).toContain(`src="${base}/c768" srcSet="${base}/c400 400w, ${base}/c768 768w, ${base}/w1600 1200w"`);
    const count = trips.filter((trip) => trip.status === "ended").length;
    const sizes = count >= 3
      ? "(min-width: 1240px) 373px, (min-width: 1024px) 31vw, (min-width: 640px) 46vw, 92vw"
      : count === 2 ? "(min-width: 1240px) 570px, (min-width: 640px) 46vw, 92vw" : "(min-width: 1240px) 1160px, 92vw";
    expect(html).toContain(`sizes="${sizes}"`);
  });

  it("a cover without renditions keeps the stored cover alone (no srcset)", async () => {
    const artifact = voyageSyntheticArtifact();
    pastGrid(artifact);
    const trips = w5EndedTrips().map((trip) => ({ ...trip, cover: { path: COVER, type: "image" as const } }));
    const html = await render(artifact, "", trips);
    const base = `/om/${await offeringMediaToken(artifact.site_id, COVER)}`;
    expect(html).toContain(`src="${base}/original"`);
    expect(html).not.toContain(`${base}/c400`);
  });

  it("the candidate probe refuses a rendition that is missing or not its digest", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const good = coverMedia("aaaaaaaa-1111-4111-8111-111111111111", await sha256(bytes));
    readPrivateObject.mockImplementation(async () => new Response(bytes));
    expect(await verifyCandidateOfferingMedia(good, "bucket")).toEqual({ ok: true });
    readPrivateObject.mockImplementation(async () => new Response(new Uint8Array([9])));
    expect(await verifyCandidateOfferingMedia(good, "bucket")).toMatchObject({ ok: false, reason: "digest_mismatch" });
    readPrivateObject.mockImplementation(async () => new Response(null, { status: 404 }));
    expect(await verifyCandidateOfferingMedia(good, "bucket")).toMatchObject({ ok: false, reason: "unreadable" });
  });
});

describe("#2829 W7c brand film poster", () => {
  it("offers the poster uncropped: the 1600-wide picture, never the 4:3 crops", async () => {
    const artifact = voyageSyntheticArtifact();
    const page = artifact.pages.find((row) => row.blocks.some((block) => block.type === "video_feature"))!;
    const block = page.blocks.find((row) => row.type === "video_feature") as Record<string, unknown>;
    const media = artifact.media.find((item) => item.url === block.poster_url)!;
    const prefix = media.object_key.slice(0, media.object_key.lastIndexOf("/"));
    const D = (c: string) => c.repeat(64);
    media.variants = [
      { name: "c400", url: `/media/${media.id}/c400.webp`, width: 400, height: 300, integrity: D("4"), object_key: `${prefix}/c400.webp` },
      { name: "c768", url: `/media/${media.id}/c768.webp`, width: 768, height: 576, integrity: D("7"), object_key: `${prefix}/c768.webp` },
      { name: "w1600", url: `/media/${media.id}/w1600.webp`, width: 1320, height: 880, integrity: D("6"), object_key: `${prefix}/w1600.webp` },
    ];
    expect(srcSetFor(artifact, block.poster_url)).toContain("c400.webp 400w");
    const html = await render(artifact, page.path);
    const poster = /class="brandfilm__poster"[^>]*>/.exec(html)?.[0] ?? "";
    expect(poster).toContain(`srcSet="/media/${media.id}/w1600.webp 1320w"`);
    expect(poster).not.toContain("c400");
    expect(poster).not.toContain("c768");
  });
});
