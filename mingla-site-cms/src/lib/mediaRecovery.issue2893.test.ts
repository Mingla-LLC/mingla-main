import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { sha256 } from "./crypto";

const storage = {
  objects: new Map<string, Uint8Array>(),
  reads: [] as string[],
  writes: [] as string[],
  deletes: [] as string[],
  events: [] as string[],
  writeAttempts: 0,
  failWriteAt: null as number | null,
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
    storage.deletes.push(`${bucket}:${key}`);
    storage.events.push(`delete:${bucket}:${key}`);
    storage.objects.delete(`${bucket}:${key}`);
  },
  readObject: async (bucket: string, key: string) => {
    storage.reads.push(`${bucket}:${key}`);
    storage.events.push(`read:${bucket}:${key}`);
    const value = storage.objects.get(`${bucket}:${key}`);
    if (!value) throw new Error("STORAGE_UNAVAILABLE");
    return value;
  },
  writeObject: async (
    bucket: string,
    key: string,
    bytes: Uint8Array,
  ) => {
    const attempt = storage.writeAttempts;
    storage.writeAttempts += 1;
    if (storage.failWriteAt === attempt) throw new Error("STORAGE_UNAVAILABLE");
    storage.writes.push(`${bucket}:${key}`);
    storage.events.push(`write:${bucket}:${key}`);
    storage.objects.set(`${bucket}:${key}`, bytes);
  },
  presignedQuarantinePut: async () => ({
    url: "https://upload.invalid",
    headers: {},
  }),
}));

import {
  completeUpload,
  mediaMayBePurged,
  mediaStorageObjects,
  restoreTombstonedMedia,
  runRetentionSweep,
  tombstoneMedia,
} from "./mediaPipeline";

const TENANT_ID = "00000000-0000-4000-8000-000000000101";
const SITE_ID = "00000000-0000-4000-8000-000000000102";
const MEDIA_ID = "00000000-0000-4000-8000-000000000103";
const SOURCE_DIGEST = "a".repeat(64);
const WIDTHS = [320, 640, 960, 1440, 1920] as const;
const BYTES = new TextEncoder().encode("verified-media-object");

async function mediaFixture(
  state: "READY" | "TOMBSTONED",
  overrides: Record<string, unknown> = {},
) {
  const digest = await sha256(BYTES);
  const base = `approved/${SITE_ID}/${MEDIA_ID}/${SOURCE_DIGEST}`;
  return {
    id: MEDIA_ID,
    tenant: TENANT_ID,
    state,
    approved_master_key: `${base}/master.webp`,
    recovery_until: "2099-01-01T00:00:00.000Z",
    rendition_manifest: {
      version: 1,
      master: {
        key: `${base}/master.webp`,
        digest,
        bytes: BYTES.byteLength,
      },
      renditions: WIDTHS.map((width) => ({
        target_width: width,
        width,
        key: `${base}/${width}.webp`,
        digest,
        bytes: BYTES.byteLength,
      })),
    },
    ...overrides,
  };
}

function requestFor(
  media: Awaited<ReturnType<typeof mediaFixture>>,
  actor: { tenantId: string; siteId: string } = {
    tenantId: TENANT_ID,
    siteId: SITE_ID,
  },
) {
  const updates: Array<Record<string, unknown>> = [];
  const events: string[] = [];
  const payload = {
    findByID: async () => media,
    find: async (input: { collection: string }) => {
      if (input.collection === "pages") return { docs: [] };
      if (input.collection === "site-settings") return { docs: [] };
      throw new Error("UNEXPECTED_COLLECTION");
    },
    update: async (input: Record<string, unknown>) => {
      events.push("database-update");
      storage.events.push("database-update");
      updates.push(input);
      return {
        ...media,
        ...(input.data as Record<string, unknown>),
      };
    },
  };
  return {
    request: {
      context: {},
      user: { id: "user-1", ...actor },
      payload,
    },
    updates,
    events,
  };
}

function seedApproved(media: Awaited<ReturnType<typeof mediaFixture>>) {
  for (
    const object of mediaStorageObjects(
      media,
      TENANT_ID,
      SITE_ID,
      MEDIA_ID,
    )
  ) {
    storage.objects.set(`approved-bucket:${object.approvedKey}`, BYTES);
  }
}

beforeEach(() => {
  storage.objects.clear();
  storage.reads.length = 0;
  storage.writes.length = 0;
  storage.deletes.length = 0;
  storage.events.length = 0;
  storage.writeAttempts = 0;
  storage.failWriteAt = null;
});

describe("#2893 deterministic media recovery", () => {
  it("leaves no untracked approved object when processing fails after partial writes", async () => {
    const source = new Uint8Array(
      await sharp({
        create: {
          width: 32,
          height: 32,
          channels: 3,
          background: { r: 120, g: 40, b: 20 },
        },
      }).png().toBuffer(),
    );
    const checksum = await sha256(source);
    const quarantineKey = `quarantine/${SITE_ID}/${MEDIA_ID}/upload`;
    const media: Record<string, unknown> = {
      id: MEDIA_ID,
      tenant: TENANT_ID,
      state: "UPLOADING",
      quarantine_key: quarantineKey,
      declared_mime: "image/png",
      bytes: source.byteLength,
    };
    const updates: Array<Record<string, unknown>> = [];
    const request = {
      context: {},
      user: { id: "user-1", tenantId: TENANT_ID, siteId: SITE_ID },
      payload: {
        findByID: async () => media,
        update: async (input: Record<string, unknown>) => {
          const data = input.data as Record<string, unknown>;
          Object.assign(media, data);
          updates.push(data);
          return { ...media };
        },
      },
    };
    storage.objects.set(`quarantine-bucket:${quarantineKey}`, source);
    storage.failWriteAt = 2;

    await expect(
      completeUpload(
        request as never,
        MEDIA_ID,
        checksum,
        source.byteLength,
      ),
    ).rejects.toThrow("STORAGE_UNAVAILABLE");

    expect(
      [...storage.objects.keys()].filter((identity) =>
        identity.startsWith("approved-bucket:")),
    ).toEqual([]);
    expect(media).toMatchObject({
      state: "RETRYABLE_FAILED",
      approved_master_key: null,
      rendition_manifest: null,
      quarantine_key: quarantineKey,
    });
    expect(updates.some((data) => data.rendition_manifest)).toBe(true);
    expect(storage.deletes.filter((identity) =>
      identity.startsWith("approved-bucket:"))).toHaveLength(6);
  });

  it("copies and verifies every approved object before the READY row becomes TOMBSTONED", async () => {
    const media = await mediaFixture("READY");
    seedApproved(media);
    const { request, updates } = requestFor(media);

    await tombstoneMedia(request as never, MEDIA_ID);

    const objects = mediaStorageObjects(media, TENANT_ID, SITE_ID, MEDIA_ID);
    expect(storage.writes).toEqual(
      objects.map(
        (object) => `recovery-bucket:${object.recoveryKey}`,
      ),
    );
    expect(storage.deletes).toEqual([]);
    expect(updates).toHaveLength(1);
    expect(updates[0].data).toMatchObject({ state: "TOMBSTONED" });
    expect(storage.events.at(-1)).toBe("database-update");
    for (const object of objects) {
      expect(object.recoveryKey).toBe(
        `recovery/${TENANT_ID}/${SITE_ID}/${MEDIA_ID}/${SOURCE_DIGEST}/${object.approvedKey.split("/").at(-1)}`,
      );
      expect(
        storage.reads.indexOf(`recovery-bucket:${object.recoveryKey}`),
      ).toBeGreaterThan(-1);
    }
  });

  it("rejects a wrong tenant or noncanonical approved path before storage mutation", async () => {
    const media = await mediaFixture("READY");
    const foreign = requestFor(media, {
      tenantId: "00000000-0000-4000-8000-000000000199",
      siteId: SITE_ID,
    });
    await expect(
      tombstoneMedia(foreign.request as never, MEDIA_ID),
    ).rejects.toThrow("FORBIDDEN");
    expect(storage.writes).toEqual([]);
    expect(foreign.updates).toEqual([]);

    const wrongSiteId = "00000000-0000-4000-8000-000000000199";
    const digest = await sha256(BYTES);
    const wrongBase =
      `approved/${wrongSiteId}/${MEDIA_ID}/${SOURCE_DIGEST}`;
    const wrongPath = await mediaFixture("READY", {
      approved_master_key: `${wrongBase}/master.webp`,
      rendition_manifest: {
        version: 1,
        master: {
          key: `${wrongBase}/master.webp`,
          digest,
          bytes: BYTES.byteLength,
        },
        renditions: WIDTHS.map((width) => ({
          target_width: width,
          width,
          key: `${wrongBase}/${width}.webp`,
          digest,
          bytes: BYTES.byteLength,
        })),
      },
    });
    const scoped = requestFor(wrongPath);
    await expect(
      tombstoneMedia(scoped.request as never, MEDIA_ID),
    ).rejects.toThrow("VALIDATION_FAILED");
    expect(storage.writes).toEqual([]);
    expect(scoped.updates).toEqual([]);
  });

  it("restores only inside the recovery window after verifying every recovery digest", async () => {
    const media = await mediaFixture("TOMBSTONED");
    const objects = mediaStorageObjects(media, TENANT_ID, SITE_ID, MEDIA_ID);
    for (const object of objects) {
      storage.objects.set(`recovery-bucket:${object.recoveryKey}`, BYTES);
    }
    const { request, updates } = requestFor(media);

    await restoreTombstonedMedia(request as never, MEDIA_ID);

    expect(storage.writes).toEqual(
      objects.map((object) => `approved-bucket:${object.approvedKey}`),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].data).toEqual({
      state: "READY",
      tombstoned_at: null,
    });
  });

  it("rejects a cross-tenant restore before reading recovery storage", async () => {
    const media = await mediaFixture("TOMBSTONED");
    const foreign = requestFor(media, {
      tenantId: "00000000-0000-4000-8000-000000000199",
      siteId: SITE_ID,
    });

    await expect(
      restoreTombstonedMedia(foreign.request as never, MEDIA_ID),
    ).rejects.toThrow("FORBIDDEN");
    expect(storage.reads).toEqual([]);
    expect(storage.writes).toEqual([]);
    expect(foreign.updates).toEqual([]);
  });

  it("keeps an expired, missing, or corrupt recovery safely TOMBSTONED", async () => {
    const expired = await mediaFixture("TOMBSTONED", {
      recovery_until: "2020-01-01T00:00:00.000Z",
    });
    const expiredRequest = requestFor(expired);
    await expect(
      restoreTombstonedMedia(expiredRequest.request as never, MEDIA_ID),
    ).rejects.toThrow("INVALID_STATE");
    expect(expiredRequest.updates).toEqual([]);

    const media = await mediaFixture("TOMBSTONED");
    const missingRequest = requestFor(media);
    await expect(
      restoreTombstonedMedia(missingRequest.request as never, MEDIA_ID),
    ).rejects.toThrow("STORAGE_UNAVAILABLE");
    expect(missingRequest.updates).toEqual([]);

    const [first] = mediaStorageObjects(media, TENANT_ID, SITE_ID, MEDIA_ID);
    storage.objects.set(
      `recovery-bucket:${first.recoveryKey}`,
      new TextEncoder().encode("corrupt"),
    );
    const corruptRequest = requestFor(media);
    await expect(
      restoreTombstonedMedia(corruptRequest.request as never, MEDIA_ID),
    ).rejects.toThrow("STORAGE_UNAVAILABLE");
    expect(corruptRequest.updates).toEqual([]);
  });

  it("never permits purge while a protected publication still references the media", () => {
    expect(
      mediaMayBePurged({
        state: "TOMBSTONED",
        recoveryUntil: "2020-01-01T00:00:00.000Z",
        referencedByProtectedPublication: true,
        nowMs: Date.parse("2026-01-01T00:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("sweeps approved and recovery copies only after expiry and protection checks pass", async () => {
    const media = await mediaFixture("TOMBSTONED", {
      recovery_until: "2020-01-01T00:00:00.000Z",
    });
    seedApproved(media);
    const objects = mediaStorageObjects(media, TENANT_ID, SITE_ID, MEDIA_ID);
    for (const object of objects) {
      storage.objects.set(`recovery-bucket:${object.recoveryKey}`, BYTES);
    }
    const updates: Array<Record<string, unknown>> = [];
    const request = {
      payload: {
        find: async (input: { collection: string }) => {
          if (input.collection === "media") return { docs: [media] };
          if (input.collection === "publication-jobs") return { docs: [] };
          throw new Error("UNEXPECTED_COLLECTION");
        },
        update: async (input: Record<string, unknown>) => {
          updates.push(input);
          return input;
        },
      },
    };

    await runRetentionSweep(request as never, SITE_ID, TENANT_ID, []);

    expect(storage.deletes).toEqual(
      objects.flatMap((object) => [
        `approved-bucket:${object.approvedKey}`,
        `recovery-bucket:${object.recoveryKey}`,
      ]),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].data).toEqual({
      approved_master_key: null,
      rendition_manifest: null,
      recovery_until: null,
    });
  });

  it("retains both copy sets when a protected snapshot references expired media", async () => {
    const media = await mediaFixture("TOMBSTONED", {
      recovery_until: "2020-01-01T00:00:00.000Z",
    });
    const artifactKey =
      `publications/${SITE_ID}/00000000-0000-4000-8000-000000000104/${"b".repeat(64)}.json`;
    storage.objects.set(
      `artifact-bucket:${artifactKey}`,
      new TextEncoder().encode(JSON.stringify({ media: [{ id: MEDIA_ID }] })),
    );
    const updates: Array<Record<string, unknown>> = [];
    const request = {
      payload: {
        find: async (input: { collection: string }) => {
          if (input.collection === "media") return { docs: [media] };
          if (input.collection === "publication-jobs") return { docs: [] };
          throw new Error("UNEXPECTED_COLLECTION");
        },
        update: async (input: Record<string, unknown>) => {
          updates.push(input);
          return input;
        },
      },
    };

    await runRetentionSweep(
      request as never,
      SITE_ID,
      TENANT_ID,
      [artifactKey],
    );

    expect(storage.deletes).toEqual([]);
    expect(updates).toEqual([]);
  });
});
