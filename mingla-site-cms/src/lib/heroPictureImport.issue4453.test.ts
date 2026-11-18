/*
 * #4453 booking-first Home — a brand whose only pictures are on its Mingla
 * offerings gets a hero: the next experience's cover (then event, then trip)
 * is imported ONCE as site media through the owner's upload pipeline, and a
 * READY image with the same source digest is reused instead of importing again.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let completeState = "READY";
vi.mock("./config", () => ({ cmsConfig: () => ({ quarantineBucket: "quarantine-bucket" }) }));
vi.mock("./observability", () => ({ emitCmsObservation: vi.fn() }));
vi.mock("./objectStore", () => ({
  writeObject: async (bucket: string, key: string, _bytes: Uint8Array, type: string) => { calls.push(`write:${bucket}:${key}:${type}`); },
}));
vi.mock("./mediaPipeline", () => ({
  createUploadGrant: async (_req: unknown, input: { filename: string; content_type: string; bytes: number }) => {
    calls.push(`grant:${input.filename}:${input.content_type}:${input.bytes}`);
    return { media_id: "m-new" };
  },
  completeUpload: async (_req: unknown, mediaId: string, checksum: string, bytes: number) => {
    calls.push(`complete:${mediaId}:${checksum.length}:${bytes}`);
    return { state: completeState };
  },
}));

import { heroPictureFromOfferings, importCoverAsMedia, pickOfferingCover } from "./heroPictureImport";
import { sha256 } from "./crypto";

type Row = { id: string; kind: "trip" | "event" | "experience" | "stay"; cover: { path: string; type: "image" } | null; status: "scheduled" | "live" | "ended" | "cancelled" };
const cover = (path: string) => ({ path, type: "image" as const });
const EXP_NEXT = "00000000-0000-4000-8000-000000000003";
const bytes = new Uint8Array([9, 8, 7, 6, 5]);

let mediaDocs: Array<Record<string, unknown>> = [];
const finds: unknown[] = [];
const scoped = {
  payload: {
    find: async ({ where }: { where: unknown }) => {
      finds.push(where);
      const wanted = JSON.stringify(where);
      return { docs: mediaDocs.filter((doc) => wanted.includes(String(doc.checksum))) };
    },
    findByID: async () => ({ quarantine_key: "quarantine/s/m-new/q" }),
  },
} as never;

beforeEach(() => {
  calls.length = 0;
  finds.length = 0;
  mediaDocs = [];
  completeState = "READY";
});

describe("#4453 pickOfferingCover", () => {
  const feed: Row[] = [
    { id: "00000000-0000-4000-8000-000000000001", kind: "trip", cover: cover("covers/trip.jpg"), status: "scheduled" },
    { id: "00000000-0000-4000-8000-000000000002", kind: "event", cover: cover("covers/event.jpg"), status: "scheduled" },
    { id: "00000000-0000-4000-8000-000000000009", kind: "experience", cover: cover("covers/exp-other.jpg"), status: "live" },
    { id: EXP_NEXT, kind: "experience", cover: cover("covers/exp-next.jpg"), status: "scheduled" },
  ];

  it("takes the next experience's cover first", () => {
    expect(pickOfferingCover(feed, { experience: EXP_NEXT })).toBe("covers/exp-next.jpg");
    expect(pickOfferingCover(feed, {})).toBe("covers/exp-other.jpg");
  });

  it("falls back to an event, then a trip; never a cancelled offering or one without a cover", () => {
    const noExperience = feed.filter((row) => row.kind !== "experience");
    expect(pickOfferingCover(noExperience, {})).toBe("covers/event.jpg");
    expect(pickOfferingCover(noExperience.filter((row) => row.kind === "trip"), {})).toBe("covers/trip.jpg");
    expect(pickOfferingCover([{ ...feed[3]!, status: "cancelled" }, { ...feed[2]!, cover: null }], { experience: EXP_NEXT })).toBeNull();
    expect(pickOfferingCover([{ id: "x", kind: "stay", cover: cover("covers/room.jpg"), status: "live" }], {})).toBeNull();
  });
});

describe("#4453 importCoverAsMedia", () => {
  it("imports through grant -> quarantine -> the pipeline, with the source digest as the checksum", async () => {
    const mediaId = await importCoverAsMedia(scoped, "t-1", "covers/exp-next.jpg", { fetchCover: async () => ({ bytes, contentType: "image/jpeg" }) });
    expect(mediaId).toBe("m-new");
    expect(calls).toEqual(["grant:offering-cover.jpg:image/jpeg:5", "write:quarantine-bucket:quarantine/s/m-new/q:image/jpeg", "complete:m-new:64:5"]);
    expect(JSON.stringify(finds[0])).toContain(await sha256(bytes));
    expect(JSON.stringify(finds[0])).toContain("t-1");
  });

  it("reuses a READY image of this site with the same source digest (imported once)", async () => {
    mediaDocs = [{ id: "m-existing", checksum: await sha256(bytes) }];
    const mediaId = await importCoverAsMedia(scoped, "t-1", "covers/exp-next.jpg", { fetchCover: async () => ({ bytes, contentType: "image/jpeg" }) });
    expect(mediaId).toBe("m-existing");
    expect(calls).toEqual([]);
  });

  it("refuses anything that is not a JPEG, PNG or WebP picture, anything over 15 MB, and a refused upload (null, never an error)", async () => {
    expect(await importCoverAsMedia(scoped, "t-1", "covers/a.gif", { fetchCover: async () => ({ bytes, contentType: "image/gif" }) })).toBeNull();
    expect(await importCoverAsMedia(scoped, "t-1", "covers/a.mp4", { fetchCover: async () => ({ bytes, contentType: "video/mp4" }) })).toBeNull();
    expect(await importCoverAsMedia(scoped, "t-1", "covers/big.jpg", { fetchCover: async () => ({ bytes: new Uint8Array(15 * 1024 * 1024 + 1), contentType: "image/jpeg" }) })).toBeNull();
    expect(await importCoverAsMedia(scoped, "t-1", "covers/none.jpg", { fetchCover: async () => null })).toBeNull();
    expect(calls).toEqual([]);
    completeState = "REJECTED";
    expect(await importCoverAsMedia(scoped, "t-1", "covers/a.png", { fetchCover: async () => ({ bytes, contentType: "image/png" }) })).toBeNull();
    expect(await importCoverAsMedia(scoped, "t-1", "covers/a.jpg", { fetchCover: async () => { throw new Error("network"); } })).toBeNull();
  });
});

describe("#4453 heroPictureFromOfferings", () => {
  it("reads the feed, picks the next experience's cover and imports it", async () => {
    const fetched: string[] = [];
    const mediaId = await heroPictureFromOfferings(scoped, { tenantId: "t-1", next: { experience: EXP_NEXT } }, {
      loadFeed: async () => [
        { id: "00000000-0000-4000-8000-000000000002", kind: "event", cover: cover("covers/event.jpg"), status: "scheduled" },
        { id: EXP_NEXT, kind: "experience", cover: cover("covers/exp-next.webp"), status: "scheduled" },
      ],
      fetchCover: async (path) => {
        fetched.push(path);
        return { bytes, contentType: "image/webp" };
      },
    });
    expect(mediaId).toBe("m-new");
    expect(fetched).toEqual(["covers/exp-next.webp"]);
  });

  it("a feed that cannot be read, or has no cover, leaves the hero out (null)", async () => {
    const fetchCover = vi.fn();
    expect(await heroPictureFromOfferings(scoped, { tenantId: "t-1", next: {} }, { loadFeed: async () => { throw new Error("CORE_UNAVAILABLE"); }, fetchCover })).toBeNull();
    expect(await heroPictureFromOfferings(scoped, { tenantId: "t-1", next: {} }, { loadFeed: async () => [], fetchCover })).toBeNull();
    expect(fetchCover).not.toHaveBeenCalled();
  });
});
