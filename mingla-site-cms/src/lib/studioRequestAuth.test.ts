import { beforeAll, describe, expect, it, vi } from "vitest";
import { Media } from "../collections/Media";
import { enforceLiveStudioWrite } from "./access";
import { callCore } from "./gateway";
import { tombstoneMedia } from "./mediaPipeline";
import {
  encodeSession,
  payloadUser,
  STUDIO_COOKIE,
  STUDIO_CSRF_COOKIE,
  type StudioSession,
} from "./session";
import {
  loadStudioMediaAttachRecords,
  requireAuthenticatedStudioRequest,
  studioMediaGrantRequest,
} from "./studioRequestAuth";

vi.mock("./gateway", () => ({ callCore: vi.fn(async () => ({ status: "authorized" })) }));

const session: StudioSession = {
  version: 1,
  site_id: "00000000-0000-4000-8000-000000000001",
  brand_id: "00000000-0000-4000-8000-000000000002",
  user_id: "00000000-0000-4000-8000-000000000003",
  rank: 20,
  tenant_id: "00000000-0000-4000-8000-000000000004",
  issued_at: Math.floor(Date.now() / 1000),
  absolute_expires_at: Math.floor(Date.now() / 1000) + 3600,
  idle_expires_at: Math.floor(Date.now() / 1000) + 1800,
  nonce: "00000000-0000-4000-8000-000000000005",
  return_surface: "web",
};

beforeAll(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgresql://fixture.invalid/sites",
    PAYLOAD_SECRET: "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=",
    SITES_CORE_BASE_URL: "https://core.invalid",
    SITES_CMS_ORIGIN: "https://studio.invalid",
    SUPABASE_S3_ENDPOINT: "https://storage.invalid",
    SUPABASE_S3_REGION: "fixture",
    SUPABASE_S3_ACCESS_KEY_ID: "fixture",
    SUPABASE_S3_SECRET_ACCESS_KEY: "fixture",
    SITES_MEDIA_QUARANTINE_BUCKET: "quarantine",
    SITES_MEDIA_APPROVED_BUCKET: "approved",
    SITES_PUBLICATION_ARTIFACT_BUCKET: "artifacts",
    SITES_MEDIA_RECOVERY_BUCKET: "recovery",
    SITES_PREVIEW_SIGNING_SECRET:
      "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=",
    MINGLA_CMS_TO_CORE_CURRENT_KEY_B64:
      "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=",
    MINGLA_CMS_TO_CORE_CURRENT_KID: "cms-core-current",
    MINGLA_CORE_TO_CMS_CURRENT_KEY_B64:
      "Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M=",
    MINGLA_CORE_TO_CMS_CURRENT_KID: "core-cms-current",
    SITES_CANDIDATE_PROBE_SECRET:
      "REREREREREREREREREREREREREREREREREREREREREQ=",
    SITES_PUBLIC_RUNTIME_ORIGIN: "https://runtime.invalid",
  });
});

async function request(user: unknown, signedCore = false) {
  const token = await encodeSession(session);
  const csrf = "csrf-proof";
  return {
    user,
    context: signedCore ? { minglaSignedCore: true } : {},
    headers: new Headers({
      cookie: `${STUDIO_COOKIE}=${encodeURIComponent(token)}; ${STUDIO_CSRF_COOKIE}=${csrf}`,
      origin: "https://studio.invalid",
      "x-mingla-csrf": csrf,
    }),
  };
}

describe("#2830 live Studio request authority", () => {
  it("rejects a valid signed cookie when the Core-backed strategy revoked the user", async () => {
    await expect(
      requireAuthenticatedStudioRequest(await request(null) as never),
    ).rejects.toThrow("SESSION_EXPIRED");
  });

  it("rejects a valid signed cookie when the authenticated actor mismatches it", async () => {
    const base = payloadUser(session);
    for (const mismatch of [
      { id: "00000000-0000-4000-8000-000000000099" },
      { collection: "users" },
      { siteId: "00000000-0000-4000-8000-000000000099" },
      { brandId: "00000000-0000-4000-8000-000000000099" },
      { tenantId: "00000000-0000-4000-8000-000000000099" },
      { rank: 50 },
    ]) {
      await expect(
        requireAuthenticatedStudioRequest(
          await request({ ...base, ...mismatch }) as never,
        ),
      ).rejects.toThrow("FORBIDDEN");
    }
  });

  it("accepts the exact live actor without carrying or creating signed-Core authority", async () => {
    const liveUser = payloadUser(session);
    const authorized = await requireAuthenticatedStudioRequest(
      await request(liveUser, true) as never,
    );
    expect(authorized.session).toEqual(session);
    expect(authorized.request.user).toBe(liveUser);
    expect(authorized.request.context).not.toHaveProperty("minglaSignedCore");
    expect(studioMediaGrantRequest(authorized.request).context).toMatchObject({
      minglaMediaGrant: true,
    });
    expect(studioMediaGrantRequest(authorized.request).context).not.toHaveProperty(
      "minglaSignedCore",
    );
  });

  it("keeps ordinary Payload page writes on the current Core authorization wall", async () => {
    const authorized = await requireAuthenticatedStudioRequest(
      await request(payloadUser(session)) as never,
    );
    await enforceLiveStudioWrite({
      operation: "update",
      overrideAccess: false,
      req: authorized.request,
    } as never);
    expect(callCore).toHaveBeenCalledWith(
      `/internal/v1/sites/${session.site_id}/authorize`,
      session.site_id,
      expect.any(String),
      { user_id: session.user_id, min_rank: 20 },
    );
  });

  it("exposes READY only to the granted Media read while keeping the Page request ordinary", async () => {
    const calls: Array<{ collection: string; req: { context: Record<string, unknown> } }> = [];
    const request = {
      context: {},
      payload: {
        findByID: vi.fn(async (input) => {
          calls.push(input);
          if (input.collection === "media") {
            return { id: "media-1", state: "READY" };
          }
          return { id: "page-1", revision: "revision-1", blocks: [] };
        }),
      },
    } as never;

    const records = await loadStudioMediaAttachRecords(
      request,
      "page-1",
      "media-1",
    );

    expect(records.media.state).toBe("READY");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.collection).toBe("pages");
    expect(calls[0]?.req).toBe(request);
    expect(calls[0]?.req.context).not.toHaveProperty("minglaMediaGrant");
    expect(calls[1]?.collection).toBe("media");
    expect(calls[1]?.req).not.toBe(request);
    expect(calls[1]?.req.context).toMatchObject({ minglaMediaGrant: true });
    expect(calls[1]?.req.context).not.toHaveProperty("minglaSignedCore");
  });

  it("uses the real Media field access callbacks to hide every system-only field", async () => {
    const fields = Media.fields as Array<{
      name?: string;
      access?: { read?: (args: { req: unknown }) => unknown };
    }>;
    const ordinary = await request(payloadUser(session));
    const granted = studioMediaGrantRequest(ordinary as never);
    const signedCore = {
      ...ordinary,
      context: { minglaSignedCore: true },
    };

    for (const name of [
      "state",
      "detected_mime",
      "bytes",
      "width",
      "height",
      "checksum",
      "quarantine_key",
      "approved_master_key",
      "rendition_manifest",
      "rejection_code",
      "created_by",
      "quarantine_delete_by",
      "recovery_until",
      "tombstoned_at",
    ]) {
      const read = fields.find((field) => field.name === name)?.access?.read;
      expect(read, `${name} must define field access.read`).toBeTypeOf("function");
      expect(read!({ req: ordinary }), `${name} ordinary tenant read`).toBe(false);
      expect(read!({ req: granted }), `${name} media-grant read`).toBe(true);
      expect(read!({ req: signedCore }), `${name} signed-Core read`).toBe(true);
    }
  });

  it("bounds tombstone Media grants without mutating ordinary relationship reads", async () => {
    const liveUser = payloadUser(session);
    const base = await request(liveUser);
    const calls: Array<{
      operation: "findByID" | "find" | "update";
      collection: string;
      req: { context: Record<string, unknown>; user: unknown; headers: Headers };
    }> = [];
    const payload = {
      findByID: vi.fn(async (input) => {
        calls.push({ operation: "findByID", ...input });
        return input.req.context.minglaMediaGrant === true
          ? { id: "media-1", tenant: session.tenant_id, state: "READY" }
          : { id: "media-1", tenant: session.tenant_id };
      }),
      find: vi.fn(async (input) => {
        calls.push({ operation: "find", ...input });
        return { docs: [] };
      }),
      update: vi.fn(async (input) => {
        calls.push({ operation: "update", ...input });
        return { id: "media-1", state: "TOMBSTONED" };
      }),
    };
    const ordinaryRequest = { ...base, payload } as never;

    await expect(tombstoneMedia(ordinaryRequest, "media-1")).resolves.toMatchObject({
      state: "TOMBSTONED",
    });

    const mediaRead = calls.find((call) => call.operation === "findByID")!;
    const relationshipReads = calls.filter((call) => call.operation === "find");
    const mediaUpdate = calls.find((call) => call.operation === "update")!;
    expect(mediaRead.req.context).toMatchObject({ minglaMediaGrant: true });
    expect(relationshipReads.map((call) => call.collection)).toEqual([
      "pages",
      "site-settings",
    ]);
    for (const call of relationshipReads) {
      expect(call.req).toBe(ordinaryRequest);
      expect(call.req.context).not.toHaveProperty("minglaMediaGrant");
    }
    expect(mediaUpdate.req.context).toMatchObject({ minglaMediaGrant: true });
    for (const call of [mediaRead, mediaUpdate]) {
      expect(call.req).not.toBe(ordinaryRequest);
      expect(call.req.context).not.toHaveProperty("minglaSignedCore");
      expect(call.req.user).toBe(liveUser);
      expect(call.req.headers).toBe(base.headers);
    }
    expect(base.context).toEqual({});

    vi.mocked(callCore).mockClear();
    await enforceLiveStudioWrite({
      operation: "update",
      overrideAccess: false,
      req: mediaUpdate.req,
    } as never);
    expect(callCore).toHaveBeenCalledWith(
      `/internal/v1/sites/${session.site_id}/authorize`,
      session.site_id,
      expect.any(String),
      { user_id: session.user_id, min_rank: 20 },
    );
  });
});
