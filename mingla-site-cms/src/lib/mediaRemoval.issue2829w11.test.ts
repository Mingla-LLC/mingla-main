/*
 * #2829 W11 (amendment A11) — owners remove media from Studio when nothing
 * uses it: pictures, file videos and stream videos alike. Media the draft
 * uses, or that a publication Core protects shows (live, last good, a version
 * that can be restored), is refused with a reason the owner can act on, and
 * nothing is copied or changed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "./crypto";

const SITE = "00000000-0000-4000-8000-0000000000a1";
const TENANT = "00000000-0000-4000-8000-0000000000c3";
const MEDIA = "00000000-0000-4000-8000-0000000000d4";
const CHECKSUM = "a".repeat(64);
const VIDEO = new TextEncoder().encode("mp4-bytes");

const store = {
  objects: new Map<string, Uint8Array>(),
  writes: [] as Array<{ name: string; type: string }>,
  deletes: [] as string[],
};
const core = { protectedKeys: [] as string[], fails: false };

vi.mock("./config", () => ({
  cmsConfig: () => ({
    approvedBucket: "approved-bucket",
    recoveryBucket: "recovery-bucket",
    quarantineBucket: "quarantine-bucket",
    artifactBucket: "artifact-bucket",
  }),
}));
vi.mock("./gateway", () => ({
  readCoreRetentionProjection: async () => {
    if (core.fails) throw new Error("CORE_UNAVAILABLE");
    return { protected_artifact_keys: core.protectedKeys };
  },
}));
vi.mock("./objectStore", () => ({
  readObject: async (bucket: string, key: string) => {
    const value = store.objects.get(`${bucket}:${key}`);
    if (!value) throw new Error("STORAGE_UNAVAILABLE");
    return value;
  },
  writeObject: async (bucket: string, key: string, bytes: Uint8Array, type: string) => {
    store.writes.push({ name: `${bucket}:${key}`, type });
    store.objects.set(`${bucket}:${key}`, bytes);
  },
  deleteObject: async (bucket: string, key: string) => {
    store.deletes.push(`${bucket}:${key}`);
    store.objects.delete(`${bucket}:${key}`);
  },
  presignedQuarantinePut: async () => ({ url: "https://upload.invalid", headers: {} }),
  listObjects: async () => [],
}));

import { mediaStorageObjects, restoreTombstonedMedia, runRetentionSweep, tombstoneMedia } from "./mediaPipeline";
import { studioMediaRemovalRefusal } from "./studioMediaClient";

const masterKey = `approved/${SITE}/${MEDIA}/${CHECKSUM}/master.mp4`;

async function fileVideo(state = "READY", overrides: Record<string, unknown> = {}) {
  return {
    id: MEDIA, tenant: TENANT, state, kind: "file_video",
    approved_master_key: masterKey,
    recovery_until: "2099-01-01T00:00:00.000Z",
    rendition_manifest: { version: 1, master: { key: masterKey, digest: await sha256(VIDEO), bytes: VIDEO.byteLength, chunk_size: 1048576, chunk_digests: [] }, renditions: [] },
    ...overrides,
  };
}
const streamVideo = (state = "READY") => ({ id: MEDIA, tenant: TENANT, state, kind: "stream_video", stream_video_id: "bunny-1", approved_master_key: null, rendition_manifest: null, recovery_until: "2099-01-01T00:00:00.000Z" });

function requestFor(media: Record<string, unknown>, usedBy: { pages?: unknown[] } = {}) {
  const updates: Array<Record<string, unknown>> = [];
  const payload = {
    findByID: async () => media,
    find: async (input: { collection: string }) => {
      if (input.collection === "pages") return { docs: usedBy.pages ?? [] };
      if (["site-settings", "navigation", "footer", "destinations", "stories", "categories", "testimonials"].includes(input.collection)) return { docs: [] };
      if (input.collection === "media") return { docs: [media] };
      if (input.collection === "publication-jobs") return { docs: [] };
      throw new Error("UNEXPECTED_COLLECTION");
    },
    update: async (input: Record<string, unknown>) => {
      updates.push(input);
      return { ...media, ...(input.data as Record<string, unknown>) };
    },
  };
  return { request: { context: {}, user: { id: "u1", tenantId: TENANT, siteId: SITE }, payload }, updates };
}

beforeEach(() => {
  store.objects.clear();
  store.writes = [];
  store.deletes = [];
  core.protectedKeys = [];
  core.fails = false;
});

describe("#2829 W11 videos can be removed when unused", () => {
  it("a file video: its MP4 is copied to recovery as video/mp4, then it is marked removed", async () => {
    store.objects.set(`approved-bucket:${masterKey}`, VIDEO);
    const { request, updates } = requestFor(await fileVideo());
    await tombstoneMedia(request as never, MEDIA);
    expect(store.writes).toEqual([{ name: `recovery-bucket:recovery/${TENANT}/${SITE}/${MEDIA}/${CHECKSUM}/master.mp4`, type: "video/mp4" }]);
    expect(updates[0]!.data).toMatchObject({ state: "TOMBSTONED" });
  });

  it("restoring a file video writes the MP4 back as video/mp4", async () => {
    store.objects.set(`recovery-bucket:recovery/${TENANT}/${SITE}/${MEDIA}/${CHECKSUM}/master.mp4`, VIDEO);
    const { request, updates } = requestFor(await fileVideo("TOMBSTONED"));
    await restoreTombstonedMedia(request as never, MEDIA);
    expect(store.writes).toEqual([{ name: `approved-bucket:${masterKey}`, type: "video/mp4" }]);
    expect(updates[0]!.data).toMatchObject({ state: "READY" });
  });

  it("a stream video has nothing in Sites storage: it is marked removed with no copy", async () => {
    const { request, updates } = requestFor(streamVideo());
    await tombstoneMedia(request as never, MEDIA);
    expect(store.writes).toEqual([]);
    expect(updates[0]!.data).toMatchObject({ state: "TOMBSTONED" });
    expect(mediaStorageObjects(streamVideo(), TENANT, SITE, MEDIA)).toEqual([]);
  });

  it("a removed file video past its recovery window is purged from both buckets by retention", async () => {
    const recoveryKey = `recovery/${TENANT}/${SITE}/${MEDIA}/${CHECKSUM}/master.mp4`;
    store.objects.set(`approved-bucket:${masterKey}`, VIDEO);
    store.objects.set(`recovery-bucket:${recoveryKey}`, VIDEO);
    const { request } = requestFor(await fileVideo("TOMBSTONED", { recovery_until: "2020-01-01T00:00:00.000Z" }));
    await runRetentionSweep(request as never, SITE, TENANT, []);
    expect(store.deletes).toEqual([`approved-bucket:${masterKey}`, `recovery-bucket:${recoveryKey}`]);
  });

  it("a malformed file video record is refused before any copy", async () => {
    const { request } = requestFor(await fileVideo("READY", { approved_master_key: `approved/${SITE}/${MEDIA}/${CHECKSUM}/other.mp4` }));
    await expect(tombstoneMedia(request as never, MEDIA)).rejects.toThrow("VALIDATION_FAILED");
    expect(store.writes).toEqual([]);
  });
});

describe("#2829 W11 in-use removal is refused with a plain reason", () => {
  it("used by the draft: MEDIA_IN_USE_DRAFT, nothing copied", async () => {
    store.objects.set(`approved-bucket:${masterKey}`, VIDEO);
    const page = { id: "p1", tenant: TENANT, path: "/", blocks: [{ blockType: "hero", video: MEDIA }] };
    const { request, updates } = requestFor(await fileVideo(), { pages: [page] });
    await expect(tombstoneMedia(request as never, MEDIA)).rejects.toThrow("MEDIA_IN_USE_DRAFT");
    expect(store.writes).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("shown by a publication Core protects: MEDIA_IN_USE_LIVE, nothing copied", async () => {
    const artifactKey = `publications/${SITE}/00000000-0000-4000-8000-000000000001/${"b".repeat(64)}.json`;
    core.protectedKeys = [artifactKey];
    store.objects.set(`artifact-bucket:${artifactKey}`, new TextEncoder().encode(JSON.stringify({ media: [{ id: MEDIA }] })));
    store.objects.set(`approved-bucket:${masterKey}`, VIDEO);
    const { request, updates } = requestFor(await fileVideo());
    await expect(tombstoneMedia(request as never, MEDIA)).rejects.toThrow("MEDIA_IN_USE_LIVE");
    expect(store.writes).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("a protected publication that doesn't show it doesn't block removal", async () => {
    const artifactKey = `publications/${SITE}/00000000-0000-4000-8000-000000000001/${"b".repeat(64)}.json`;
    core.protectedKeys = [artifactKey];
    store.objects.set(`artifact-bucket:${artifactKey}`, new TextEncoder().encode(JSON.stringify({ media: [{ id: "someone-else" }] })));
    const { request, updates } = requestFor(streamVideo());
    await tombstoneMedia(request as never, MEDIA);
    expect(updates[0]!.data).toMatchObject({ state: "TOMBSTONED" });
  });

  it("when Core can't say what is live, the removal is refused (nothing copied)", async () => {
    core.fails = true;
    store.objects.set(`approved-bucket:${masterKey}`, VIDEO);
    const { request, updates } = requestFor(await fileVideo());
    await expect(tombstoneMedia(request as never, MEDIA)).rejects.toThrow("SERVICE_TEMPORARILY_UNAVAILABLE");
    expect(store.writes).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("the owner reads where it is still used and what to do; never a generic failure", () => {
    expect(studioMediaRemovalRefusal(new Error("MEDIA_IN_USE_DRAFT"))).toBe("This is still used in your draft website. Take it off the page or entry that uses it, then remove it. Nothing was removed.");
    expect(studioMediaRemovalRefusal(new Error("MEDIA_IN_USE_LIVE"))).toBe("Your live website (or a version you can restore) still shows this. Publish a version without it, then remove it. Nothing was removed.");
    expect(studioMediaRemovalRefusal(new Error("SERVICE_TEMPORARILY_UNAVAILABLE"))).toContain("nothing was removed");
    expect(studioMediaRemovalRefusal(new Error("INVALID_STATE"))).toContain("Nothing was removed");
  });
});
