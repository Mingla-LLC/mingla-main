/*
 * #2829 W11 (amendment A14) — the retention sweep removes offering-cover
 * renditions that no kept publication (and no recent preview) refers to,
 * after a grace period, and never touches a site photo, another site's
 * rendition, or anything when storage can't be listed or read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const SITE = "00000000-0000-4000-8000-0000000000a1";
const OTHER_SITE = "00000000-0000-4000-8000-0000000000b2";
const TENANT = "00000000-0000-4000-8000-0000000000c3";
const NOW = Date.parse("2026-11-20T12:00:00.000Z");
const OLD = "2026-10-01T00:00:00.000Z"; // 50 days before NOW
const RECENT = "2026-11-15T00:00:00.000Z"; // 5 days before NOW

const store = {
  objects: new Map<string, { bytes: Uint8Array; lastModified: string }>(),
  deletes: [] as string[],
  listFails: false,
};

vi.mock("./config", () => ({
  cmsConfig: () => ({
    approvedBucket: "approved-bucket",
    recoveryBucket: "recovery-bucket",
    quarantineBucket: "quarantine-bucket",
    artifactBucket: "artifact-bucket",
  }),
}));

vi.mock("./objectStore", () => ({
  deleteObject: async (bucket: string, key: string) => {
    store.deletes.push(`${bucket}:${key}`);
    store.objects.delete(`${bucket}:${key}`);
  },
  readObject: async (bucket: string, key: string) => {
    const value = store.objects.get(`${bucket}:${key}`);
    if (!value) throw new Error("STORAGE_UNAVAILABLE");
    return value.bytes;
  },
  writeObject: async () => undefined,
  presignedQuarantinePut: async () => ({ url: "https://upload.invalid", headers: {} }),
  listObjects: async (bucket: string, prefix: string) => {
    if (store.listFails) throw new Error("STORAGE_UNAVAILABLE");
    return [...store.objects.entries()]
      .filter(([name]) => name.startsWith(`${bucket}:${prefix}`))
      .map(([name, value]) => ({ key: name.slice(bucket.length + 1), lastModified: value.lastModified }));
  },
}));

import { offeringMediaKey } from "../contracts/generated/artifactV2.ts";
import { isSiteRenditionKey, RENDITION_GRACE_MS, renditionKeysOf, sweepOfferingRenditions } from "./offeringCoverRenditions";
import { runRetentionSweep } from "./mediaPipeline";

const digest = (char: string) => char.repeat(64);
const put = (bucket: string, key: string, lastModified: string, body = "x") =>
  store.objects.set(`${bucket}:${key}`, { bytes: new TextEncoder().encode(body), lastModified });
const artifactWith = (keys: string[]) => JSON.stringify({
  media: [],
  offering_media: [{ path: "covers/a.jpg", source_width: 2000, source_height: 1500, variants: keys.map((key) => ({ name: "c400", width: 400, height: 300, integrity: digest("e"), object_key: key })) }],
});
const pubKey = (n: number) => `publications/${SITE}/00000000-0000-4000-8000-00000000000${n}/${digest(String(n))}.json`;

beforeEach(() => {
  store.objects.clear();
  store.deletes = [];
  store.listFails = false;
});

describe("#2829 W11 which keys are renditions", () => {
  it("a rendition key of this site, never a site photo with the same shape, never another site", () => {
    const rendition = offeringMediaKey(SITE, digest("a"), "c400");
    expect(isSiteRenditionKey(SITE, rendition)).toBe(true);
    // A site photo: approved/<site>/<media id>/<checksum>/c400.webp — the folder is the media id.
    expect(isSiteRenditionKey(SITE, `approved/${SITE}/00000000-0000-4000-8000-000000000999/${digest("a")}/c400.webp`)).toBe(false);
    expect(isSiteRenditionKey(SITE, offeringMediaKey(OTHER_SITE, digest("a"), "c400"))).toBe(false);
    expect(isSiteRenditionKey(SITE, `approved/${SITE}/x/${digest("a")}/master.webp`)).toBe(false);
  });

  it("reads rendition keys from an artifact, and nothing from a malformed one", () => {
    expect(renditionKeysOf(JSON.parse(artifactWith(["k1", "k2"])))).toEqual(["k1", "k2"]);
    expect(renditionKeysOf({ offering_media: "nope" })).toEqual([]);
    expect(renditionKeysOf(null)).toEqual([]);
  });
});

describe("#2829 W11 sweepOfferingRenditions", () => {
  const deps = () => ({
    list: async (prefix: string) => [...store.objects.entries()]
      .filter(([name]) => name.split(":")[1]!.startsWith(prefix))
      .map(([name, value]) => ({ key: name.split(":")[1]!, lastModified: value.lastModified })),
    readArtifact: async (key: string) => {
      const value = store.objects.get(`artifact-bucket:${key}`);
      if (!value) throw new Error("STORAGE_UNAVAILABLE");
      return JSON.parse(new TextDecoder().decode(value.bytes));
    },
    remove: async (key: string) => { store.deletes.push(key); },
  });

  it("removes an old rendition no kept publication names; keeps the named one, the recent one, photos and other sites", async () => {
    const kept = offeringMediaKey(SITE, digest("a"), "c400");
    const orphan = offeringMediaKey(SITE, digest("b"), "c768");
    const fresh = offeringMediaKey(SITE, digest("c"), "w1600");
    const photo = `approved/${SITE}/00000000-0000-4000-8000-000000000999/${digest("d")}/c400.webp`;
    const foreign = offeringMediaKey(OTHER_SITE, digest("b"), "c768");
    for (const key of [kept, orphan, photo, foreign]) put("approved-bucket", key, OLD);
    put("approved-bucket", fresh, RECENT);
    put("artifact-bucket", pubKey(1), OLD, artifactWith([kept]));
    const result = await sweepOfferingRenditions({ siteId: SITE, keptArtifactKeys: [pubKey(1)], deps: deps(), nowMs: NOW });
    expect(store.deletes).toEqual([orphan]);
    expect(result).toEqual({ scanned: 3, kept: 2, purged: 1 });
  });

  it("a rendition a recent preview still shows (a private share link) is kept; an old preview protects nothing", async () => {
    const shown = offeringMediaKey(SITE, digest("a"), "c400");
    const stale = offeringMediaKey(SITE, digest("b"), "c400");
    put("approved-bucket", shown, OLD);
    put("approved-bucket", stale, OLD);
    put("artifact-bucket", `publications/${SITE}/preview-${"1".repeat(32)}/${digest("1")}.json`, RECENT, artifactWith([shown]));
    put("artifact-bucket", `publications/${SITE}/preview-${"2".repeat(32)}/${digest("2")}.json`, OLD, artifactWith([stale]));
    await sweepOfferingRenditions({ siteId: SITE, keptArtifactKeys: [], deps: deps(), nowMs: NOW });
    expect(store.deletes).toEqual([stale]);
  });

  it("the grace period is longer than the longest private preview link (14 days)", () => {
    expect(RENDITION_GRACE_MS).toBeGreaterThan(14 * 24 * 60 * 60_000);
  });

  it("a kept artifact that cannot be read deletes nothing", async () => {
    put("approved-bucket", offeringMediaKey(SITE, digest("b"), "c400"), OLD);
    await expect(sweepOfferingRenditions({ siteId: SITE, keptArtifactKeys: [pubKey(3)], deps: deps(), nowMs: NOW }))
      .rejects.toThrow("STORAGE_UNAVAILABLE");
    expect(store.deletes).toEqual([]);
  });
});

describe("#2829 W11 runRetentionSweep cleans renditions with the rest of retention", () => {
  const request = (jobs: Array<{ artifact_key: string; updatedAt: string }>) => ({
    payload: {
      find: async (input: { collection: string }) => {
        if (input.collection === "media") return { docs: [] };
        if (input.collection === "publication-jobs") return { docs: jobs };
        throw new Error("UNEXPECTED_COLLECTION");
      },
      update: async (input: unknown) => input,
    },
  });

  it("keeps renditions of the protected and not-yet-purgeable publications, removes the rest after the grace period", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    try {
      const live = offeringMediaKey(SITE, digest("a"), "c400");
      const recentJob = offeringMediaKey(SITE, digest("b"), "c400");
      const gone = offeringMediaKey(SITE, digest("c"), "c400");
      for (const key of [live, recentJob, gone]) put("approved-bucket", key, OLD);
      put("artifact-bucket", pubKey(1), OLD, artifactWith([live]));
      put("artifact-bucket", pubKey(2), OLD, artifactWith([recentJob]));
      // Job 2 is newest and recent: kept even though Core doesn't protect it.
      await runRetentionSweep(
        request([{ artifact_key: pubKey(2), updatedAt: RECENT }, { artifact_key: pubKey(1), updatedAt: OLD }]) as never,
        SITE, TENANT, [pubKey(1)],
      );
      expect(store.deletes).toEqual([`approved-bucket:${gone}`]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("when storage can't be listed, nothing is deleted and the sweep still answers", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      put("approved-bucket", offeringMediaKey(SITE, digest("c"), "c400"), OLD);
      store.listFails = true;
      const result = await runRetentionSweep(request([]) as never, SITE, TENANT, []);
      expect(store.deletes).toEqual([]);
      expect(result).toEqual({ protected_artifacts: 0, protected_media: 0, purged_media: 0, purged_artifacts: 0 });
      expect(info.mock.calls.map((call) => String(call[0])).join("\n")).toContain("retention.offering_renditions_skipped");
    } finally {
      info.mockRestore();
      vi.useRealTimers();
    }
  });
});
