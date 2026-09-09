import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = {
  deletes: [] as string[],
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
    storage.deletes.push(`${bucket}:${key}`);
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

const TENANT_ID = "00000000-0000-4000-8000-000000000401";
const SITE_ID = "00000000-0000-4000-8000-000000000402";
const EXPIRED_ID = "00000000-0000-4000-8000-000000000403";
const UNEXPIRED_ID = "00000000-0000-4000-8000-000000000404";
const EXPIRED_KEY = `quarantine/${SITE_ID}/${EXPIRED_ID}/abandoned`;
const UNEXPIRED_KEY = `quarantine/${SITE_ID}/${UNEXPIRED_ID}/active`;

beforeEach(() => {
  storage.deletes.length = 0;
});

describe("#3154 abandoned upload-grant retention", () => {
  it("terminalizes only the expired UPLOADING row after an idempotent delete", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const request = {
      payload: {
        find: async (input: { collection: string }) => {
          if (input.collection === "media") {
            return {
              docs: [
                {
                  id: EXPIRED_ID,
                  tenant: TENANT_ID,
                  state: "UPLOADING",
                  quarantine_key: EXPIRED_KEY,
                  quarantine_delete_by: "2026-09-09T00:00:00.000Z",
                  approved_master_key: null,
                  rendition_manifest: null,
                  recovery_until: null,
                  rejection_code: null,
                },
                {
                  id: UNEXPIRED_ID,
                  tenant: TENANT_ID,
                  state: "UPLOADING",
                  quarantine_key: UNEXPIRED_KEY,
                  quarantine_delete_by: "2099-09-09T00:00:00.000Z",
                  approved_master_key: null,
                  rendition_manifest: null,
                  recovery_until: null,
                  rejection_code: null,
                },
              ],
            };
          }
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

    expect(storage.deletes).toEqual([
      `quarantine-bucket:${EXPIRED_KEY}`,
    ]);
    expect(updates).toEqual([{
      collection: "media",
      id: EXPIRED_ID,
      overrideAccess: true,
      data: {
        state: "REJECTED",
        rejection_code: null,
        quarantine_key: null,
        quarantine_delete_by: null,
      },
    }]);
  });

  it("does not terminalize the row when quarantine deletion fails", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const { deleteObject } = await import("./objectStore");
    vi.mocked(deleteObject).mockRejectedValueOnce(
      new Error("STORAGE_UNAVAILABLE"),
    );
    const request = {
      payload: {
        find: async (input: { collection: string }) => {
          if (input.collection === "media") {
            return {
              docs: [{
                id: EXPIRED_ID,
                tenant: TENANT_ID,
                state: "UPLOADING",
                quarantine_key: EXPIRED_KEY,
                quarantine_delete_by: "2026-09-09T00:00:00.000Z",
                approved_master_key: null,
                rendition_manifest: null,
                recovery_until: null,
                rejection_code: null,
              }],
            };
          }
          if (input.collection === "publication-jobs") return { docs: [] };
          throw new Error("UNEXPECTED_COLLECTION");
        },
        update: async (input: Record<string, unknown>) => {
          updates.push(input);
          return input;
        },
      },
    };

    await expect(
      runRetentionSweep(request as never, SITE_ID, TENANT_ID, []),
    ).rejects.toThrow("STORAGE_UNAVAILABLE");
    expect(updates).toEqual([]);
  });
});
