import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "./crypto";

const storage = new Map<string, Uint8Array>();

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
    storage.delete(`${bucket}:${key}`);
  },
  readObject: async (bucket: string, key: string) => {
    const value = storage.get(`${bucket}:${key}`);
    if (!value) throw new Error("STORAGE_UNAVAILABLE");
    return value;
  },
  writeObject: async (
    bucket: string,
    key: string,
    bytes: Uint8Array,
  ) => {
    storage.set(`${bucket}:${key}`, bytes);
  },
  presignedQuarantinePut: async () => ({
    url: "https://upload.invalid",
    headers: {},
  }),
}));

import {
  completeUpload,
  mediaStorageObjects,
  restoreTombstonedMedia,
  runRetentionSweep,
  tombstoneMedia,
} from "./mediaPipeline";

const TENANT_ID = "00000000-0000-4000-8000-000000000301";
const SITE_ID = "00000000-0000-4000-8000-000000000302";
const MEDIA_ID = "00000000-0000-4000-8000-000000000303";
const SOURCE_DIGEST = "a".repeat(64);
const WIDTHS = [320, 640, 960, 1440, 1920] as const;
const BYTES = new TextEncoder().encode("issue-2933-media");

async function readyMedia() {
  const digest = await sha256(BYTES);
  const base = `approved/${SITE_ID}/${MEDIA_ID}/${SOURCE_DIGEST}`;
  return {
    id: MEDIA_ID,
    tenant: TENANT_ID,
    state: "READY",
    approved_master_key: `${base}/master.webp`,
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
  };
}

beforeEach(() => storage.clear());

describe("#2933 Payload hidden media fields", () => {
  it("opts the completion read into the persisted quarantine pointer", async () => {
    const key = `quarantine/${SITE_ID}/${MEDIA_ID}/upload`;
    const source = new TextEncoder().encode("not-an-image");
    const checksum = await sha256(source);
    storage.set(`quarantine-bucket:${key}`, source);
    const reads: Array<Record<string, unknown>> = [];
    const request = {
      context: {},
      user: { id: "user-1", tenantId: TENANT_ID, siteId: SITE_ID },
      payload: {
        findByID: async (input: Record<string, unknown>) => {
          reads.push(input);
          return {
            id: MEDIA_ID,
            tenant: TENANT_ID,
            state: "UPLOADING",
            quarantine_key: key,
            declared_mime: "image/png",
            bytes: source.byteLength,
          };
        },
        update: async (input: Record<string, unknown>) => input.data,
      },
    };

    await expect(
      completeUpload(request as never, MEDIA_ID, checksum, source.byteLength),
    ).rejects.toThrow("MEDIA_REJECTED");

    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({
      collection: "media",
      id: MEDIA_ID,
      overrideAccess: false,
      showHiddenFields: true,
    });
  });

  it("keeps tombstone and restore reads private while making lifecycle fields available server-side", async () => {
    const media = await readyMedia();
    for (const object of mediaStorageObjects(media, TENANT_ID, SITE_ID, MEDIA_ID)) {
      storage.set(`approved-bucket:${object.approvedKey}`, BYTES);
    }
    const reads: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const request = {
      context: {},
      user: { id: "user-1", tenantId: TENANT_ID, siteId: SITE_ID },
      payload: {
        findByID: async (input: Record<string, unknown>) => {
          reads.push(input);
          return media;
        },
        find: async () => ({ docs: [] }),
        update: async (input: Record<string, unknown>) => {
          updates.push(input);
          return { ...media, ...(input.data as Record<string, unknown>) };
        },
      },
    };

    const tombstoned = await tombstoneMedia(request as never, MEDIA_ID);

    expect(tombstoned).toMatchObject({
      state: "TOMBSTONED",
      recovery_until: expect.any(String),
    });
    expect(reads[0]).toMatchObject({ showHiddenFields: true });
    expect(updates[0]).toMatchObject({ showHiddenFields: true });

    const stoppedRequest = {
      ...request,
      payload: {
        ...request.payload,
        findByID: async (input: Record<string, unknown>) => {
          expect(input).toMatchObject({ showHiddenFields: true });
          throw new Error("STOP_AFTER_PROTECTED_READ");
        },
      },
    };
    await expect(
      restoreTombstonedMedia(stoppedRequest as never, MEDIA_ID),
    ).rejects.toThrow("STOP_AFTER_PROTECTED_READ");
  });

  it("opts the retention scan into hidden cleanup and recovery fields", async () => {
    const reads: Array<Record<string, unknown>> = [];
    const request = {
      payload: {
        find: async (input: Record<string, unknown>) => {
          reads.push(input);
          return { docs: [] };
        },
        update: async () => ({}),
      },
    };

    await expect(
      runRetentionSweep(request as never, SITE_ID, TENANT_ID, []),
    ).resolves.toEqual({
      protected_artifacts: 0,
      protected_media: 0,
      purged_media: 0,
      purged_artifacts: 0,
    });

    expect(reads[0]).toMatchObject({
      collection: "media",
      overrideAccess: true,
      showHiddenFields: true,
    });
  });
});
