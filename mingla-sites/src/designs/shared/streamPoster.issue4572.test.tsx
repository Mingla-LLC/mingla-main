/*
 * #4572 items 2 and 7a — event cards on Mingla Sites.
 *   2. A video flyer's still frame (Core's `cover_stream_poster`) is drawn as
 *      the card picture, straight from a stream host the runtime trusts
 *      (SITES_VIDEO_CDN_HOSTS); any other host, or none, draws the title face
 *      on Posters, Maison, Cards and Voyage, never an empty `.mg-ph`.
 *   7a. A summary keeps its line breaks on the page and reads as one line in
 *      JSON-LD.
 * FAILS-ON-REVERT: without streamPosterSources the poster src is null; without
 * `face` on Posters the card is an empty box; without <Lines> the summary is
 * one run of text.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/config", () => ({
  runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 7).toString("base64"), videoCdnHosts: ["vz-abc123.b-cdn.net"] }),
}));

import { offeringCoverSources, pathForToken } from "../../lib/offeringMedia";
import { normalizeSiteOffering } from "../../contracts/generated/offerings.ts";
import { Cover } from "./blocks/Offerings";
import { Lines } from "./Lines";
import { PhotoCard } from "../voyage/blocks/OfferingGridPhotoCard";

const VIDEO = "0f5f3a0e-2b9c-4c1e-9d55-7a3f2c1b0e9d";
const poster = { host: "vz-abc123.b-cdn.net", video_id: VIDEO, file: "thumbnail_3f2a.jpg" };
const base = {
  id: "8a0b8c1e-1d2f-4a3b-9c4d-5e6f7a8b9c0d", kind: "event", slug: "inhabited-forms", title: "Inhabited Forms", summary: null,
  cover: null, destination_text: null, start_at: "2026-12-06T17:00:00Z", end_at: null, timezone: "Africa/Lagos", status: "scheduled",
  bookings_closed: false, capacity: null, spots_left: null, group_minimum: null, min_price_minor: null, currency: null,
  has_free_tier: true, public_url: "https://host.usemingla.com/e/kolanut/inhabited-forms", waitlist_enabled: false, installments_available: false,
};
type CoverProps = Parameters<typeof Cover>[0];
const item = (card: Partial<CoverProps["item"]["card"]>) => ({ card: { id: "o1", title: "Inhabited Forms", coverUrl: null, coverSrcSet: null, detailHref: null, ...card } }) as unknown as CoverProps["item"];

describe("#4572 item 2 — a video flyer's still on Sites cards", () => {
  it("the contract keeps a valid still and the renderer draws it from the trusted host", async () => {
    const offering = normalizeSiteOffering({ ...base, cover_stream_poster: poster })!;
    expect(offering.cover_stream_poster).toEqual(poster);
    const sources = await offeringCoverSources("site", offering, undefined);
    expect(sources).toEqual({ src: `https://vz-abc123.b-cdn.net/${VIDEO}/thumbnail_3f2a.jpg`, srcSet: null });
    // Never through /om: the still is not a storage path a token could name.
    expect(await pathForToken("site", "a".repeat(43), [offering])).toBeNull();
  });

  it("a host not in SITES_VIDEO_CDN_HOSTS gets no picture (the card draws its face)", async () => {
    const offering = normalizeSiteOffering({ ...base, cover_stream_poster: { ...poster, host: "vz-evil.b-cdn.net" } })!;
    expect(await offeringCoverSources("site", offering, undefined)).toBeNull();
  });

  it("the contract drops a bad still but keeps the offering (old feeds and bad rows never blank a site)", () => {
    for (const bad of [
      { ...poster, file: "../x.jpg" },
      { ...poster, video_id: "not-a-uuid" },
      { ...poster, extra: 1 },
      { ...poster, host: "http://vz-abc123.b-cdn.net" },
    ]) {
      const offering = normalizeSiteOffering({ ...base, cover_stream_poster: bad });
      expect(offering).not.toBeNull();
      expect(offering!.cover_stream_poster).toBeUndefined();
    }
    // An old feed without the key is unchanged.
    expect(normalizeSiteOffering(base)!.cover_stream_poster).toBeUndefined();
  });

  it("Voyage draws the title face instead of an empty box", () => {
    const card = { id: "o1", kind: "event", title: "Inhabited Forms", summary: null, destination: null, dates: null, price: null,
      state: { bookable: false, badge: null, phase: "upcoming", cancelled: false, soldOut: false }, coverUrl: null, coverSrcSet: null,
      href: base.public_url, cta: "View event", detailHref: null } as unknown as Parameters<typeof PhotoCard>[0]["card"];
    const html = renderToStaticMarkup(<PhotoCard card={card} offering={base as never} analytics={{} as never} />);
    expect(html).toContain('class="mg-ph-none"');
  });

  it("the shared Cover with face draws the still when the card has one", () => {
    const html = renderToStaticMarkup(<Cover item={item({ coverUrl: `https://vz-abc123.b-cdn.net/${VIDEO}/thumbnail.jpg` })} face sizes="100vw" />);
    expect(html).toContain(`<img src="https://vz-abc123.b-cdn.net/${VIDEO}/thumbnail.jpg"`);
  });
});

describe("#4572 item 7a — summaries keep their line breaks", () => {
  it("each line break becomes a <br>, and the text stays escaped", () => {
    const html = renderToStaticMarkup(<p><Lines text={"week:\n- Stakeholders forum\n<b>x</b>"} /></p>);
    expect(html).toBe("<p>week:<br/>- Stakeholders forum<br/>&lt;b&gt;x&lt;/b&gt;</p>");
  });
});
