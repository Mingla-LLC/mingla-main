import { describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({
  cmsConfig: () => ({ quarantineBucket: "sites-media-quarantine" }),
}));

vi.mock("./objectStore", () => ({
  presignedQuarantinePut: async () => ({
    url: "https://storage.invalid/upload",
    headers: { "content-type": "image/jpeg", "if-none-match": "*" },
  }),
}));

import { createUploadGrant } from "./mediaPipeline";

const TENANT_ID = "00000000-0000-4000-8000-000000000301";
const SITE_ID = "00000000-0000-4000-8000-000000000302";
const USER_ID = "00000000-0000-4000-8000-000000000303";
const MEDIA_ID = "00000000-0000-4000-8000-000000000304";

describe("media upload grant issue #2928 regression", () => {
  it("assigns the authenticated Studio tenant before the scoped follow-up update", async () => {
    const creates: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const request = {
      context: {},
      user: {
        id: USER_ID,
        tenantId: TENANT_ID,
        siteId: SITE_ID,
      },
      payload: {
        create: async (input: Record<string, unknown>) => {
          creates.push(input);
          return { id: MEDIA_ID };
        },
        update: async (input: Record<string, unknown>) => {
          updates.push(input);
          return { id: MEDIA_ID };
        },
      },
    };

    const grant = await createUploadGrant(
      request as never,
      {
        filename: "hero.jpg",
        content_type: "image/jpeg",
        bytes: 1024,
        tenant: "00000000-0000-4000-8000-000000000399",
      } as never,
    );

    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({
      collection: "media",
      overrideAccess: false,
      req: request,
      data: {
        tenant: TENANT_ID,
        state: "UPLOADING",
        original_filename_safe: "hero.jpg",
        declared_mime: "image/jpeg",
        bytes: 1024,
        created_by: USER_ID,
      },
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      collection: "media",
      id: MEDIA_ID,
      overrideAccess: false,
      req: request,
      data: {
        quarantine_key: expect.stringMatching(
          new RegExp(`^quarantine/${SITE_ID}/${MEDIA_ID}/`),
        ),
      },
    });
    expect(grant.media_id).toBe(MEDIA_ID);
  });
});
