import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Access, SanitizedConfig } from "payload";
import {
  readSignedSessionTenant,
  Tenants,
} from "../collections/Tenants";
import {
  readExactStudioUser,
  StudioUsers,
} from "../collections/StudioUsers";
import { sitesEndpoints } from "../endpoints/sitesEndpoints";
import {
  encodeSession,
  payloadUser,
  STUDIO_COOKIE,
  STUDIO_CSRF_COOKIE,
  type StudioSession,
} from "./session";

const SITE_ID = "00000000-0000-4000-8000-000000003029";
const BRAND_ID = "00000000-0000-4000-8000-000000003030";
const USER_ID = "00000000-0000-4000-8000-000000003031";
const GOGI_TENANT_ID = "00000000-0000-4000-8000-000000003032";
const OTHER_TENANT_ID = "00000000-0000-4000-8000-000000003033";

Object.assign(process.env, {
  DATABASE_URL: "postgresql://fixture.invalid/sites",
  PAYLOAD_SECRET: "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=",
  SITES_CORE_BASE_URL: "https://core.invalid",
  SITES_CMS_ORIGIN: "https://studio.invalid",
  SUPABASE_S3_ENDPOINT:
    "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3",
  SUPABASE_S3_REGION: "us-east-2",
  SUPABASE_S3_ACCESS_KEY_ID: "fixture",
  SUPABASE_S3_SECRET_ACCESS_KEY: "fixture",
  SITES_MEDIA_QUARANTINE_BUCKET: "sites-media-quarantine",
  SITES_MEDIA_APPROVED_BUCKET: "sites-media-approved",
  SITES_PUBLICATION_ARTIFACT_BUCKET: "sites-publication-artifacts",
  SITES_MEDIA_RECOVERY_BUCKET: "sites-media-recovery",
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

function accessArgs(user: Record<string, unknown> | null): Parameters<Access>[0] {
  return { req: { user } } as Parameters<Access>[0];
}

function studioUser(
  tenantId: string | undefined = GOGI_TENANT_ID,
  rank = 20,
  assignedTenantId: string = GOGI_TENANT_ID,
): Record<string, unknown> {
  return {
    id: USER_ID,
    collection: "studio-users",
    rank,
    ...(tenantId === undefined ? {} : { tenantId }),
    tenants: [{ tenant: assignedTenantId }],
  };
}

function session(): StudioSession {
  const now = Math.floor(Date.now() / 1000);
  return {
    version: 1,
    site_id: SITE_ID,
    brand_id: BRAND_ID,
    user_id: USER_ID,
    rank: 20,
    tenant_id: GOGI_TENANT_ID,
    issued_at: now,
    absolute_expires_at: now + 3600,
    idle_expires_at: now + 1800,
    nonce: "00000000-0000-4000-8000-000000003034",
    return_surface: "web",
  };
}

function matchesTenantConstraint(value: unknown, tenantId: string): boolean {
  if (!value || typeof value !== "object") return false;
  const constraint = value as Record<string, unknown>;
  if (Array.isArray(constraint.and)) {
    return constraint.and.every((part) =>
      matchesTenantConstraint(part, tenantId)
    );
  }
  if (!constraint.id || typeof constraint.id !== "object") return false;
  const id = constraint.id as Record<string, unknown>;
  if (typeof id.equals === "string") return id.equals === tenantId;
  if (Array.isArray(id.in)) return id.in.includes(tenantId);
  return false;
}

function componentPath(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const pathValue = (value as Record<string, unknown>).path;
  return typeof pathValue === "string" ? pathValue : null;
}

async function invokeStudioReturn(
  studioSession: StudioSession | null,
): Promise<Response> {
  const endpoint = sitesEndpoints.find(
    ({ path, method }) => path === "/mingla/return" && method === "get",
  );
  if (!endpoint) throw new Error("Missing Studio return endpoint");
  const token = studioSession ? await encodeSession(studioSession) : null;
  return endpoint.handler({
    headers: new Headers(
      token
        ? {
          cookie: `${STUDIO_COOKIE}=${encodeURIComponent(token)}; ${STUDIO_CSRF_COOKIE}=csrf-proof`,
        }
        : undefined,
    ),
    user: studioSession ? payloadUser(studioSession) : null,
  } as never);
}

let configuredCms: SanitizedConfig;
let configuredTenants: SanitizedConfig["collections"][number];

beforeAll(async () => {
  const { default: configPromise } = await import("../payload.config");
  const config = await configPromise;
  const tenants = config.collections.find(({ slug }) => slug === "tenants");
  if (!tenants) throw new Error("Missing configured tenants collection");
  configuredCms = config;
  configuredTenants = tenants;
});

describe("#3029 Studio tenant bootstrap access", () => {
  it("fails closed for anonymous, low-rank, foreign-collection, and tenantless users", async () => {
    expect(await readSignedSessionTenant(accessArgs(null))).toBe(false);
    expect(
      await readSignedSessionTenant(accessArgs(studioUser(GOGI_TENANT_ID, 19))),
    ).toBe(false);
    expect(
      await readSignedSessionTenant(
        accessArgs({
          ...studioUser(),
          collection: "admins",
        }),
      ),
    ).toBe(false);
    expect(
      await readSignedSessionTenant(
        accessArgs({
          id: USER_ID,
          collection: "studio-users",
          tenantId: GOGI_TENANT_ID,
          tenants: [{ tenant: GOGI_TENANT_ID }],
        }),
      ),
    ).toBe(false);
    expect(
      await readSignedSessionTenant(
        accessArgs({
          id: USER_ID,
          collection: "studio-users",
          rank: 20,
          tenants: [{ tenant: GOGI_TENANT_ID }],
        }),
      ),
    ).toBe(false);
    expect(
      await readSignedSessionTenant(accessArgs(studioUser(""))),
    ).toBe(false);
  });

  it("returns only the signed-session tenant predicate at rank 20 and above", async () => {
    const rank20 = await readSignedSessionTenant(accessArgs(studioUser()));
    expect(rank20).toEqual({
      id: { equals: GOGI_TENANT_ID },
    });
    expect(matchesTenantConstraint(rank20, GOGI_TENANT_ID)).toBe(true);
    expect(matchesTenantConstraint(rank20, OTHER_TENANT_ID)).toBe(false);
    const rank60 = await readSignedSessionTenant(
      accessArgs(studioUser(OTHER_TENANT_ID, 60, OTHER_TENANT_ID)),
    );
    expect(rank60).toEqual({ id: { equals: OTHER_TENANT_ID } });
  });

  it("keeps the plugin's assigned-tenant constraint and fails closed on mismatch", async () => {
    const read = configuredTenants.access.read;
    expect(typeof read).toBe("function");
    const matching = await read?.(accessArgs(studioUser()));
    expect(matching).toEqual({
      and: [
        { id: { equals: GOGI_TENANT_ID } },
        { id: { in: [GOGI_TENANT_ID] } },
      ],
    });
    expect(matchesTenantConstraint(matching, GOGI_TENANT_ID)).toBe(true);
    expect(matchesTenantConstraint(matching, OTHER_TENANT_ID)).toBe(false);
    const mismatch = await read?.(
      accessArgs(studioUser(GOGI_TENANT_ID, 20, OTHER_TENANT_ID)),
    );
    expect(mismatch).toEqual({
      and: [
        { id: { equals: GOGI_TENANT_ID } },
        { id: { in: [OTHER_TENANT_ID] } },
      ],
    });
    expect(matchesTenantConstraint(mismatch, GOGI_TENANT_ID)).toBe(false);
    expect(matchesTenantConstraint(mismatch, OTHER_TENANT_ID)).toBe(false);
  });

  it("keeps tenant and Studio-user administration hidden and immutable", async () => {
    expect(Tenants.admin?.hidden).toBe(true);
    expect(StudioUsers.admin?.hidden).toBe(true);
    expect(
      await Tenants.access?.admin?.(accessArgs(studioUser()) as never),
    ).toBe(false);
    expect(
      await readExactStudioUser(accessArgs(studioUser())),
    ).toEqual({
      id: { equals: USER_ID },
      core_user_id: { equals: USER_ID },
    });
    for (const operation of [
      Tenants.access?.create,
      Tenants.access?.update,
      Tenants.access?.delete,
      Tenants.access?.readVersions,
      Tenants.access?.unlock,
      StudioUsers.access?.create,
      StudioUsers.access?.update,
      StudioUsers.access?.delete,
      StudioUsers.access?.readVersions,
      StudioUsers.access?.unlock,
    ]) {
      expect(typeof operation).toBe("function");
      expect(await operation?.(accessArgs(studioUser()) as never)).toBe(false);
    }
    for (const operation of [
      configuredTenants.access.create,
      configuredTenants.access.update,
      configuredTenants.access.delete,
      configuredTenants.access.readVersions,
      configuredTenants.access.unlock,
    ]) {
      expect(await operation?.(accessArgs(studioUser()))).toBe(false);
    }
  });

  it("keeps the one-option tenant selector and tenant routes customer-hidden", () => {
    const selector = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "node_modules/@payloadcms/plugin-multi-tenant/dist/components/TenantSelector/index.client.js",
      ),
      "utf8",
    );
    const nav = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/StudioNav.tsx"),
      "utf8",
    );
    const payloadConfig = fs.readFileSync(
      path.resolve(process.cwd(), "src/payload.config.ts"),
      "utf8",
    );
    const provider = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "node_modules/@payloadcms/plugin-multi-tenant/dist/providers/TenantSelectionProvider/index.js",
      ),
      "utf8",
    );
    const getTenantOptions = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "node_modules/@payloadcms/plugin-multi-tenant/dist/utilities/getTenantOptions.js",
      ),
      "utf8",
    );

    expect(selector).toContain("if (options.length <= 1)");
    expect(selector).toContain("return null");
    expect(nav).not.toContain("/admin/collections/tenants");
    expect(nav).not.toContain("/admin/collections/studio-users");
    expect(payloadConfig).toContain("userHasAccessToAllTenants: () => false");
    expect(payloadConfig).toContain(
      "tenantsArrayField: { includeDefaultField: false }",
    );
    expect(
      configuredCms.admin.components?.providers.some(
        (candidate) =>
          componentPath(candidate) ===
          "@payloadcms/plugin-multi-tenant/rsc#TenantSelectionProvider",
      ),
    ).toBe(true);
    expect(provider).toContain("getTenantOptions");
    expect(getTenantOptions).toContain("overrideAccess: false");
  });
});

describe("#3029 Studio return cleanup", () => {
  it("expires both Studio cookies only after a valid session and preserves the Gogi return", async () => {
    const studioSession = session();
    const token = await encodeSession(studioSession);
    const response = await invokeStudioReturn(studioSession);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `https://host.usemingla.com/brand/${BRAND_ID}/website`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies).toEqual([
      `${STUDIO_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`,
      `${STUDIO_CSRF_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`,
    ]);
    for (const cookie of cookies) {
      expect(cookie).not.toContain("Domain=");
      expect(cookie).not.toContain(token);
      expect(cookie).not.toContain("csrf-proof");
    }
  });

  it("preserves the exact signed native return while ending the Studio session", async () => {
    const nativeSession = { ...session(), return_surface: "native" as const };
    const response = await invokeStudioReturn(nativeSession);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `mingla-business://website-return?brandId=${BRAND_ID}`,
    );
    expect(response.headers.getSetCookie()).toHaveLength(2);
  });

  it("does not redirect or emit cleanup cookies without a valid Studio session", async () => {
    const missing = await invokeStudioReturn(null);
    const expiredSession = {
      ...session(),
      absolute_expires_at: Math.floor(Date.now() / 1000) - 1,
      idle_expires_at: Math.floor(Date.now() / 1000) - 1,
    };
    const expired = await invokeStudioReturn(expiredSession);

    for (const response of [missing, expired]) {
      expect(response.status).toBe(403);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.getSetCookie()).toEqual([]);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: { code: "SESSION_EXPIRED" },
      });
    }
  });
});
