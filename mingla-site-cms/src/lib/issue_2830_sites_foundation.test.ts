import { beforeAll, describe, expect, it } from "vitest";
import { publicationDraftDigest, stable } from "./artifactBuilder";
import { requestTenant } from "./tenantIntegrity";
import { artifactMayBePurged, mediaMayBePurged } from "./mediaPipeline";
import { canAccessStudioAdmin, StudioUsers } from "../collections/StudioUsers";

const SITE_ID = "00000000-0000-4000-8000-000000000001";
const BRAND_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000003";
const TENANT_ID = "00000000-0000-4000-8000-000000000004";

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

describe("#2830 exact draft and tenant boundary", () => {
  it("admits an authenticated custom Studio session without exposing the hidden user collection", () => {
    expect(canAccessStudioAdmin?.({ req: { user: null } } as never)).toBe(false);
    expect(
      canAccessStudioAdmin?.({
        req: { user: { id: USER_ID, tenantId: TENANT_ID, rank: 20 } },
      } as never),
    ).toBe(true);
    expect(StudioUsers.admin?.hidden).toBe(true);
    expect(StudioUsers.access?.read?.({ req: { user: { id: USER_ID } } } as never)).toBe(false);
  });

  it("canonicalizes an exact draft deterministically and changes on content", async () => {
    const draft = {
      pages: [{ id: "home", title: "Gogi", revision: 4 }],
      navigation: { pages: ["home"] },
      footer: { address: "London" },
      settings: { display_name: "Gogi Restaurant" },
      media: [{ id: "image-1", checksum: "a".repeat(64) }],
    };
    const first = await publicationDraftDigest(draft);
    const reordered = await publicationDraftDigest({
      ...draft,
      settings: { display_name: "Gogi Restaurant" },
    });
    const changed = await publicationDraftDigest({
      ...draft,
      pages: [{ id: "home", title: "Changed", revision: 5 }],
    });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
    expect(stable({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it("never accepts an unsigned internal tenant context", () => {
    expect(() =>
      requestTenant({
        context: { minglaInternalTenantId: TENANT_ID },
        user: null,
      } as never),
    ).toThrow("FORBIDDEN");
    expect(
      requestTenant({
        context: {
          minglaSignedCore: true,
          minglaInternalTenantId: TENANT_ID,
        },
        user: null,
      } as never),
    ).toBe(TENANT_ID);
  });
});

describe("#2830 retention protection", () => {
  const now = Date.parse("2026-08-30T12:00:00Z");
  it("never purges protected media and waits for the 30-day recovery window", () => {
    expect(
      mediaMayBePurged({
        state: "TOMBSTONED",
        recoveryUntil: "2026-08-29T12:00:00Z",
        referencedByProtectedPublication: true,
        nowMs: now,
      }),
    ).toBe(false);
    expect(
      mediaMayBePurged({
        state: "TOMBSTONED",
        recoveryUntil: "2026-08-31T12:00:00Z",
        referencedByProtectedPublication: false,
        nowMs: now,
      }),
    ).toBe(false);
    expect(
      mediaMayBePurged({
        state: "TOMBSTONED",
        recoveryUntil: "2026-08-29T12:00:00Z",
        referencedByProtectedPublication: false,
        nowMs: now,
      }),
    ).toBe(true);
  });

  it("retains active/newest artifacts and purges only old unprotected history", () => {
    expect(
      artifactMayBePurged({
        protectedByCore: true,
        completedAt: "2025-01-01T00:00:00Z",
        newestRank: 500,
        nowMs: now,
      }),
    ).toBe(false);
    expect(
      artifactMayBePurged({
        protectedByCore: false,
        completedAt: "2025-01-01T00:00:00Z",
        newestRank: 50,
        nowMs: now,
      }),
    ).toBe(false);
    expect(
      artifactMayBePurged({
        protectedByCore: false,
        completedAt: "2025-01-01T00:00:00Z",
        newestRank: 51,
        nowMs: now,
      }),
    ).toBe(true);
  });
});

describe("#2830 private preview grant", () => {
  it("binds the exact tenant, revision and digest and rejects tampering", async () => {
    const { decodePreviewGrant, encodePreviewGrant } =
      await import("./session");
    const issuedAt = Math.floor(Date.now() / 1000);
    const token = await encodePreviewGrant({
      version: 1,
      issuer: "mingla-site-cms",
      audience: "mingla-studio-preview",
      site_id: SITE_ID,
      brand_id: BRAND_ID,
      user_id: USER_ID,
      tenant_id: TENANT_ID,
      source_revision: "4",
      source_digest: "a".repeat(64),
      renderer_key: "restaurant-website-v1",
      renderer_version: 1,
      issued_at: issuedAt,
      expires_at: issuedAt + 1800,
      nonce: "00000000-0000-4000-8000-000000000005",
    });
    const decoded = await decodePreviewGrant(token);
    expect(decoded?.source_revision).toBe("4");
    expect(decoded?.source_digest).toBe("a".repeat(64));
    expect(await decodePreviewGrant(`${token.slice(0, -1)}x`)).toBeNull();
  });
});

describe("#2830 fixed Studio return contract", () => {
  it("derives only the signed web or native Website workspace target", async () => {
    const { decodeSession, encodeSession, studioReturnLocation } =
      await import("./session");
    const now = Math.floor(Date.now() / 1000);
    const base = {
      version: 1 as const,
      site_id: SITE_ID,
      brand_id: BRAND_ID,
      user_id: USER_ID,
      rank: 20,
      tenant_id: TENANT_ID,
      issued_at: now,
      absolute_expires_at: now + 3600,
      idle_expires_at: now + 1800,
      nonce: "00000000-0000-4000-8000-000000000006",
    };
    const web = await decodeSession(
      await encodeSession({ ...base, return_surface: "web" }),
    );
    const native = await decodeSession(
      await encodeSession({ ...base, return_surface: "native" }),
    );
    expect(studioReturnLocation(web!)).toBe(
      `https://business.usemingla.com/brand/${BRAND_ID}/website`,
    );
    expect(studioReturnLocation(native!)).toBe(
      `mingla-business://website-return?brandId=${BRAND_ID}`,
    );
    expect(
      await decodeSession(
        await encodeSession({
          ...base,
          return_surface: "https://attacker.invalid" as never,
        }),
      ),
    ).toBeNull();
  });
});
