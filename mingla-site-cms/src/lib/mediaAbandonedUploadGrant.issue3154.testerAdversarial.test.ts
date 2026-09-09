import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = {
  events: [] as string[],
  failures: new Set<string>(),
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
  deleteObject: vi.fn(async (bucket: string, key: string) => {
    storage.events.push(`delete:${bucket}:${key}`);
    if (storage.failures.has(key)) throw new Error("STORAGE_UNAVAILABLE");
  }),
  readObject: async () => {
    throw new Error("UNEXPECTED_STORAGE_READ");
  },
  writeObject: async () => {
    throw new Error("UNEXPECTED_STORAGE_WRITE");
  },
  presignedQuarantinePut: async () => ({
    url: "https://upload.invalid",
    headers: {},
  }),
}));

import { runRetentionSweep } from "./mediaPipeline";

const TENANT_ID = "60000000-0000-4000-8000-000000003154";
const SITE_ID = "70000000-0000-4000-8000-000000003154";
const EXPIRED_UPLOAD_ID = "80000000-0000-4000-8000-000000003154";
const ACTIVE_UPLOAD_ID = "90000000-0000-4000-8000-000000003154";
const COMMITTED_ID = "a0000000-0000-4000-8000-000000003154";
const FAILED_UPLOAD_ID = "b0000000-0000-4000-8000-000000003154";
const NOW_MS = Date.parse("2026-09-09T16:00:00.000Z");

function mediaRow({
  id,
  state,
  key,
  deleteBy,
  rejectionCode = null,
}: {
  id: string;
  state: string;
  key: string;
  deleteBy: string;
  rejectionCode?: string | null;
}) {
  return {
    id,
    tenant: TENANT_ID,
    state,
    quarantine_key: key,
    quarantine_delete_by: deleteBy,
    approved_master_key: null,
    rendition_manifest: null,
    recovery_until: null,
    rejection_code: rejectionCode,
  };
}

function requestWith(media: Array<ReturnType<typeof mediaRow>>) {
  return {
    payload: {
      find: async (input: { collection: string }) => {
        if (input.collection === "media") return { docs: media };
        if (input.collection === "publication-jobs") return { docs: [] };
        throw new Error("UNEXPECTED_COLLECTION");
      },
      update: async (input: Record<string, unknown>) => {
        storage.events.push(`update:${String(input.id)}:${JSON.stringify(input.data)}`);
        return input;
      },
    },
  };
}

beforeEach(() => {
  storage.events.length = 0;
  storage.failures.clear();
  vi.spyOn(Date, "now").mockReturnValue(NOW_MS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("#3154 tester adversarial retention boundary", () => {
  it("deletes before exactly one terminal update while leaving active grants untouched", async () => {
    const expiredUploadKey = `quarantine/${SITE_ID}/${EXPIRED_UPLOAD_ID}/missing`;
    const activeUploadKey = `quarantine/${SITE_ID}/${ACTIVE_UPLOAD_ID}/active`;
    const committedKey = `quarantine/${SITE_ID}/${COMMITTED_ID}/committed`;
    const request = requestWith([
      mediaRow({
        id: EXPIRED_UPLOAD_ID,
        state: "UPLOADING",
        key: expiredUploadKey,
        deleteBy: new Date(NOW_MS).toISOString(),
        rejectionCode: "MUST_BE_CLEARED",
      }),
      mediaRow({
        id: ACTIVE_UPLOAD_ID,
        state: "UPLOADING",
        key: activeUploadKey,
        deleteBy: new Date(NOW_MS + 1).toISOString(),
      }),
      mediaRow({
        id: COMMITTED_ID,
        state: "PROCESSING",
        key: committedKey,
        deleteBy: new Date(NOW_MS - 1).toISOString(),
        rejectionCode: "PROCESSING_DIAGNOSTIC",
      }),
    ]);

    await runRetentionSweep(request as never, SITE_ID, TENANT_ID, []);

    expect(storage.events).toEqual([
      `delete:quarantine-bucket:${expiredUploadKey}`,
      `update:${EXPIRED_UPLOAD_ID}:${JSON.stringify({
        state: "REJECTED",
        rejection_code: null,
        quarantine_key: null,
        quarantine_delete_by: null,
      })}`,
      `delete:quarantine-bucket:${committedKey}`,
      `update:${COMMITTED_ID}:${JSON.stringify({
        quarantine_key: null,
        quarantine_delete_by: null,
      })}`,
    ]);
    expect(storage.events.some((event) => event.includes(ACTIVE_UPLOAD_ID))).toBe(false);
    expect(storage.events.filter((event) =>
      event.startsWith(`update:${EXPIRED_UPLOAD_ID}:`))).toHaveLength(1);
  });

  it("does not mutate an expired upload when quarantine deletion fails", async () => {
    const failedKey = `quarantine/${SITE_ID}/${FAILED_UPLOAD_ID}/unavailable`;
    storage.failures.add(failedKey);
    const request = requestWith([mediaRow({
      id: FAILED_UPLOAD_ID,
      state: "UPLOADING",
      key: failedKey,
      deleteBy: new Date(NOW_MS - 1).toISOString(),
    })]);

    await expect(
      runRetentionSweep(request as never, SITE_ID, TENANT_ID, []),
    ).rejects.toThrow("STORAGE_UNAVAILABLE");
    expect(storage.events).toEqual([
      `delete:quarantine-bucket:${failedKey}`,
    ]);
  });
});
