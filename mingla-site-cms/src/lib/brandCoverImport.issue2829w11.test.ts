/*
 * #2829 W11 (A17) — the brand's Mingla cover becomes site media through the
 * owner's own upload pipeline, or nothing happens (colour panel).
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
    return { media_id: "m-1" };
  },
  completeUpload: async (_req: unknown, id: string, checksum: string, bytes: number) => {
    calls.push(`complete:${id}:${checksum.length}:${bytes}`);
    return { state: completeState };
  },
}));

import { importBrandCover } from "./brandCoverImport";

const scoped = { payload: { findByID: async () => ({ quarantine_key: "quarantine/s/m-1/q" }) } } as never;
const bytes = new Uint8Array([1, 2, 3, 4]);

beforeEach(() => {
  calls.length = 0;
  completeState = "READY";
});

describe("#2829 W11 importBrandCover", () => {
  it("a JPEG cover goes through grant -> quarantine -> the pipeline and comes back READY", async () => {
    const id = await importBrandCover(scoped, "brand_covers/b/c.jpg", { fetchCover: async () => ({ bytes, contentType: "image/jpeg" }) });
    expect(id).toBe("m-1");
    expect(calls).toEqual(["grant:brand-cover.jpg:image/jpeg:4", "write:quarantine-bucket:quarantine/s/m-1/q:image/jpeg", "complete:m-1:64:4"]);
  });

  it("an unreadable cover, a GIF, or a refused picture gives null (the colour panel), never an error", async () => {
    expect(await importBrandCover(scoped, "brand_covers/b/c.jpg", { fetchCover: async () => null })).toBeNull();
    expect(await importBrandCover(scoped, "brand_covers/b/c.gif", { fetchCover: async () => ({ bytes, contentType: "image/gif" }) })).toBeNull();
    expect(calls).toEqual([]);
    completeState = "REJECTED";
    expect(await importBrandCover(scoped, "brand_covers/b/c.png", { fetchCover: async () => ({ bytes, contentType: "image/png" }) })).toBeNull();
    expect(await importBrandCover(scoped, "brand_covers/b/c.jpg", { fetchCover: async () => { throw new Error("network"); } })).toBeNull();
  });
});
