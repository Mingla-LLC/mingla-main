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

let readyByChecksum: Array<{ id: string }> = [];
const finds: unknown[] = [];
const scoped = {
  payload: {
    findByID: async () => ({ quarantine_key: "quarantine/s/m-1/q" }),
    find: async (args: unknown) => { finds.push(args); return { docs: readyByChecksum }; },
  },
} as never;
const bytes = new Uint8Array([1, 2, 3, 4]);

beforeEach(() => {
  calls.length = 0;
  completeState = "READY";
  readyByChecksum = [];
  finds.length = 0;
});

describe("#2829 W11 importBrandCover", () => {
  it("a JPEG cover goes through grant -> quarantine -> the pipeline and comes back READY", async () => {
    const id = await importBrandCover(scoped, "t-1", "brand_covers/b/c.jpg", { fetchCover: async () => ({ bytes, contentType: "image/jpeg" }) });
    expect(id).toBe("m-1");
    expect(calls).toEqual(["grant:brand-cover.jpg:image/jpeg:4", "write:quarantine-bucket:quarantine/s/m-1/q:image/jpeg", "complete:m-1:64:4"]);
  });

  it("an unreadable cover, a GIF, or a refused picture gives null (the colour panel), never an error", async () => {
    expect(await importBrandCover(scoped, "t-1", "brand_covers/b/c.jpg", { fetchCover: async () => null })).toBeNull();
    expect(await importBrandCover(scoped, "t-1", "brand_covers/b/c.gif", { fetchCover: async () => ({ bytes, contentType: "image/gif" }) })).toBeNull();
    expect(calls).toEqual([]);
    completeState = "REJECTED";
    expect(await importBrandCover(scoped, "t-1", "brand_covers/b/c.png", { fetchCover: async () => ({ bytes, contentType: "image/png" }) })).toBeNull();
    expect(await importBrandCover(scoped, "t-1", "brand_covers/b/c.jpg", { fetchCover: async () => { throw new Error("network"); } })).toBeNull();
  });

  it("#4453 a cover already imported (a READY image of this site with the same SHA-256) is reused, never imported again", async () => {
    readyByChecksum = [{ id: "m-existing" }];
    const id = await importBrandCover(scoped, "t-1", "brand_covers/b/c.jpg", { fetchCover: async () => ({ bytes, contentType: "image/jpeg" }) });
    expect(id).toBe("m-existing");
    expect(calls).toEqual([]);
    const where = JSON.stringify((finds[0] as { where: unknown }).where);
    expect(where).toContain('"tenant":{"equals":"t-1"}');
    expect(where).toContain('"state":{"equals":"READY"}');
    expect(where).toContain('"kind":{"equals":"image"}');
    // SHA-256 of [1,2,3,4]
    expect(where).toContain("9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a");
  });
});
