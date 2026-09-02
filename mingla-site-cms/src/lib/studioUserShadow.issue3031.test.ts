import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import type { Access, SanitizedConfig } from "payload";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  preserveLiveStudioUser,
  readExactStudioUser,
  StudioUsers,
} from "../collections/StudioUsers";
import { sitesEndpoints } from "../endpoints/sitesEndpoints";
import { proxy, strippedStudioDestination } from "../proxy";
import { callCore } from "./gateway";
import {
  encodeSession,
  payloadUser,
  STUDIO_COOKIE,
  type StudioSession,
} from "./session";
import { ensureStudioUserShadow } from "./studioUserShadow";

vi.mock("./gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gateway")>();
  return { ...actual, callCore: vi.fn() };
});

const SITE_ID = "00000000-0000-4000-8000-000000003031";
const BRAND_ID = "00000000-0000-4000-8000-000000003032";
const USER_ID = "00000000-0000-4000-8000-000000003033";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000003034";
const TENANT_ID = "00000000-0000-4000-8000-000000003035";

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

function exactShadow(id = USER_ID) {
  return { id, core_user_id: id, tenants: [] };
}

function session(overrides: Partial<StudioSession> = {}): StudioSession {
  const now = Math.floor(Date.now() / 1000);
  return {
    version: 1,
    site_id: SITE_ID,
    brand_id: BRAND_ID,
    user_id: USER_ID,
    rank: 20,
    tenant_id: TENANT_ID,
    issued_at: now,
    absolute_expires_at: now + 3600,
    idle_expires_at: now + 1800,
    nonce: "00000000-0000-4000-8000-000000003036",
    return_surface: "web",
    ...overrides,
  };
}

function accessArgs(user: Record<string, unknown> | null): Parameters<Access>[0] {
  return { req: { user } } as Parameters<Access>[0];
}

function shadowRequest(
  reads: Array<Array<Record<string, unknown>>>,
  create: ReturnType<typeof vi.fn> = vi.fn(async () => exactShadow()),
) {
  const find = vi.fn(async () => ({ docs: reads.shift() ?? [] }));
  return {
    req: { payload: { find, db: { create } } } as never,
    find,
    create,
  };
}

function exchangeEndpoint() {
  const endpoint = sitesEndpoints.find(
    ({ path: route, method }) => route === "/mingla/exchange" && method === "post",
  );
  if (!endpoint) throw new Error("Missing exchange endpoint");
  return endpoint;
}

async function invokeExchange(args?: {
  result?: Record<string, unknown>;
  shadowReads?: Array<Array<Record<string, unknown>>>;
  create?: ReturnType<typeof vi.fn>;
}) {
  const now = Date.now();
  vi.mocked(callCore).mockResolvedValueOnce(
    (args?.result ?? {
      site_id: SITE_ID,
      brand_id: BRAND_ID,
      user_id: USER_ID,
      rank: 20,
      absolute_expires_at: new Date(now + 3_600_000).toISOString(),
      idle_expires_at: new Date(now + 1_800_000).toISOString(),
    }) as never,
  );
  const create = args?.create ?? vi.fn(async () => exactShadow());
  const shadowReads = args?.shadowReads ?? [[], [exactShadow()]];
  const find = vi.fn(async ({ collection }: { collection: string }) =>
    collection === "tenants"
      ? { docs: [{ id: TENANT_ID }] }
      : { docs: shadowReads.shift() ?? [] },
  );
  const response = await exchangeEndpoint().handler({
    json: async () => ({
      code: "one-time",
      destination: "studio",
      return_surface: "web",
      site_id: SITE_ID,
      brand_id: BRAND_ID,
    }),
    payload: { find, db: { create } },
    headers: new Headers(),
  } as never);
  return { response, find, create };
}

let configuredStudioUsers: SanitizedConfig["collections"][number];

beforeAll(async () => {
  const { default: configPromise } = await import("../payload.config");
  const config = await configPromise;
  const collection = config.collections.find(
    ({ slug }) => slug === "studio-users",
  );
  if (!collection) throw new Error("Missing configured Studio users");
  configuredStudioUsers = collection;
});

beforeEach(() => vi.mocked(callCore).mockReset());

describe("#3031 credential-free Studio user shadow", () => {
  it("creates with the exact custom UUID, link, empty tenants, and no credential data", async () => {
    const fixture = shadowRequest([[], [exactShadow()]]);
    await ensureStudioUserShadow(fixture.req, USER_ID);

    expect(fixture.create).toHaveBeenCalledOnce();
    const call = fixture.create.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      collection: "studio-users",
      customID: USER_ID,
      data: { core_user_id: USER_ID, tenants: [] },
    });
    for (const forbidden of [
      "email", "password", "salt", "hash", "apiKey", "sessions", "rank",
      "siteId", "brandId", "tenantId", "token", "refreshToken",
    ]) expect(call.data).not.toHaveProperty(forbidden);
  });

  it("is a no-op for one exact existing shadow", async () => {
    const fixture = shadowRequest([[exactShadow()]]);
    await ensureStudioUserShadow(fixture.req, USER_ID);
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it.each([
    ["crossed primary ID", [{ ...exactShadow(), id: OTHER_USER_ID }]],
    ["crossed Core link", [{ ...exactShadow(), core_user_id: OTHER_USER_ID }]],
    ["persisted tenant", [{ ...exactShadow(), tenants: [{ tenant: TENANT_ID }] }]],
    ["duplicate conflict", [exactShadow(), { ...exactShadow(), id: OTHER_USER_ID }]],
  ])("fails closed for %s", async (_label, docs) => {
    const fixture = shadowRequest([docs]);
    await expect(ensureStudioUserShadow(fixture.req, USER_ID)).rejects.toThrow(
      "STUDIO_USER_SHADOW_MISMATCH",
    );
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it("rejects malformed IDs before any read or write", async () => {
    const fixture = shadowRequest([]);
    await expect(ensureStudioUserShadow(fixture.req, "not-a-uuid")).rejects.toThrow(
      "STUDIO_USER_SHADOW_MISMATCH",
    );
    expect(fixture.find).not.toHaveBeenCalled();
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it("accepts a unique-conflict race only after the exact postcondition", async () => {
    const create = vi.fn(async () => {
      throw Object.assign(new Error("duplicate"), { code: "23505" });
    });
    const exact = shadowRequest([[], [exactShadow()]], create);
    await expect(ensureStudioUserShadow(exact.req, USER_ID)).resolves.toBeUndefined();

    const mismatch = shadowRequest(
      [[], [{ ...exactShadow(), core_user_id: OTHER_USER_ID }]],
      create,
    );
    await expect(ensureStudioUserShadow(mismatch.req, USER_ID)).rejects.toThrow(
      "STUDIO_USER_SHADOW_MISMATCH",
    );
  });

  it("never swallows an arbitrary create failure", async () => {
    const failure = Object.assign(new Error("database unavailable"), {
      code: "08006",
    });
    const fixture = shadowRequest(
      [[], [exactShadow()]],
      vi.fn(async () => { throw failure; }),
    );
    await expect(ensureStudioUserShadow(fixture.req, USER_ID)).rejects.toBe(failure);
    expect(fixture.find).toHaveBeenCalledOnce();
  });
});

describe("#3031 exchange placement and safe failure", () => {
  it("ensures the shadow after tenant/site/brand verification and before cookies", async () => {
    const { response, find, create } = await invokeExchange();
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(find.mock.calls.map(([arg]) => arg.collection)).toEqual([
      "tenants",
      "studio-users",
      "studio-users",
    ]);
    expect(create).toHaveBeenCalledOnce();
  });

  it("does not ensure or set cookies when verified context mismatches", async () => {
    const { response, find, create } = await invokeExchange({
      result: {
        site_id: SITE_ID,
        brand_id: OTHER_USER_ID,
        user_id: USER_ID,
        rank: 20,
        absolute_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        idle_expires_at: new Date(Date.now() + 1_800_000).toISOString(),
      },
    });
    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(find.mock.calls.map(([arg]) => arg.collection)).toEqual(["tenants"]);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns the value-safe envelope and no cookies when ensure fails", async () => {
    const { response } = await invokeExchange({
      create: vi.fn(async () => { throw new Error("private database detail"); }),
    });
    expect(response.status).toBe(503);
    expect(response.headers.getSetCookie()).toEqual([]);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "SERVICE_TEMPORARILY_UNAVAILABLE",
        message: "Website tools are temporarily unavailable.",
        retryable: true,
        return_url: `https://host.usemingla.com/brand/${BRAND_ID}/website?studioResult=exchange_expired`,
      },
    });
  });
});

describe("#3031 exact-self current user", () => {
  const live = payloadUser(session()) as Record<string, unknown>;

  it("denies anonymous, foreign collection, malformed and other identities", async () => {
    expect(await readExactStudioUser(accessArgs(null))).toBe(false);
    expect(await readExactStudioUser(accessArgs({ ...live, collection: "admins" }))).toBe(false);
    expect(await readExactStudioUser(accessArgs({ ...live, id: "bad" }))).toBe(false);
    const predicate = await readExactStudioUser(accessArgs(live));
    expect(predicate).toEqual({
      id: { equals: USER_ID },
      core_user_id: { equals: USER_ID },
    });
    expect(JSON.stringify(predicate)).not.toContain(OTHER_USER_ID);
  });

  it("keeps the plugin constraint while allowing only the exact own row", async () => {
    const result = await configuredStudioUsers.access.read?.(accessArgs(live));
    expect(JSON.stringify(result)).toContain(`\"equals\":\"${USER_ID}\"`);
    expect(JSON.stringify(result)).toContain("core_user_id");
    expect(JSON.stringify(result)).toContain("tenants.tenant");
    expect(JSON.stringify(result)).not.toContain(OTHER_USER_ID);
  });

  it("returns the live virtual projection only after an exact shadow lookup", async () => {
    expect(StudioUsers.hooks?.me).toContain(preserveLiveStudioUser);
    const studioSession = session();
    const token = await encodeSession(studioSession);
    const virtual = payloadUser(studioSession);
    const result = await preserveLiveStudioUser({
      args: {
        req: {
          headers: new Headers({ cookie: `${STUDIO_COOKIE}=${encodeURIComponent(token)}` }),
          user: virtual,
        },
      },
      user: exactShadow(),
    } as never);
    expect(result).toEqual({ user: virtual, exp: studioSession.idle_expires_at });
    expect((result as { user: Record<string, unknown> }).user).toMatchObject({
      tenantId: TENANT_ID,
      rank: 20,
      siteId: SITE_ID,
      brandId: BRAND_ID,
      tenants: [{ tenant: TENANT_ID }],
    });

    await expect(preserveLiveStudioUser({
      args: { req: { headers: new Headers(), user: virtual } },
      user: exactShadow(),
    } as never)).rejects.toThrow("FORBIDDEN");
    await expect(preserveLiveStudioUser({
      args: {
        req: {
          headers: new Headers({ cookie: `${STUDIO_COOKIE}=${encodeURIComponent(token)}` }),
          user: virtual,
        },
      },
      user: { ...exactShadow(), core_user_id: OTHER_USER_ID },
    } as never)).rejects.toThrow("FORBIDDEN");
  });

  it("preserves Core authorization as the revocation wall", async () => {
    vi.mocked(callCore).mockRejectedValueOnce(new Error("FORBIDDEN"));
    const authenticate = StudioUsers.auth && typeof StudioUsers.auth === "object"
      ? StudioUsers.auth.strategies?.[0]?.authenticate
      : undefined;
    const token = await encodeSession(session());
    await expect(authenticate?.({
      headers: new Headers({ cookie: `${STUDIO_COOKIE}=${encodeURIComponent(token)}` }),
      payload: {} as never,
    })).resolves.toEqual({ user: null });

    vi.mocked(callCore).mockClear();
    const lowRankToken = await encodeSession(session({ rank: 19 }));
    await expect(authenticate?.({
      headers: new Headers({
        cookie: `${STUDIO_COOKIE}=${encodeURIComponent(lowRankToken)}`,
      }),
      payload: {} as never,
    })).resolves.toEqual({ user: null });
    expect(callCore).not.toHaveBeenCalled();
  });

  it("keeps the shadow immutable and relationship FKs anchored to its exact primary key", async () => {
    for (const operation of [
      StudioUsers.access?.create,
      StudioUsers.access?.update,
      StudioUsers.access?.delete,
      StudioUsers.access?.readVersions,
      StudioUsers.access?.unlock,
    ]) expect(await operation?.(accessArgs(live) as never)).toBe(false);
    expect(StudioUsers.admin?.hidden).toBe(true);
    expect(StudioUsers.auth).toMatchObject({
      disableLocalStrategy: true,
      useAPIKey: false,
      useSessions: false,
      removeTokenFromResponses: true,
    });
    const migration = fs.readFileSync(
      path.resolve(process.cwd(), "src/migrations/20260830_122002_issue_2830_sites_foundation.ts"),
      "utf8",
    );
    expect(migration).toContain("payload_preferences_rels_studio_users_fk");
    expect(migration).toContain("payload_locked_documents_rels_studio_users_fk");
    expect(migration).toContain('REFERENCES "sites_cms"."studio_users"("id")');
  });
});

describe("#3031 stripped Studio routes", () => {
  it.each([
    ["/admin", "/admin/collections/pages"],
    ["/admin/", "/admin/collections/pages"],
    ["/admin/account", "/admin/collections/pages"],
    ["/admin/account/security", "/admin/collections/pages"],
    ["/admin/collections/tenants", "/admin/collections/pages"],
    ["/admin/collections/tenants/one", "/admin/collections/pages"],
    ["/admin/collections/studio-users", "/admin/collections/pages"],
    ["/admin/collections/studio-users/one", "/admin/collections/pages"],
    ["/admin/collections/media", "/studio/media"],
    ["/admin/collections/media/one", "/studio/media"],
  ])("maps %s to %s", (source, destination) => {
    expect(strippedStudioDestination(source)).toBe(destination);
  });

  it.each([
    "/administrator",
    "/admin/accounting",
    "/admin/collections/tenants-old",
    "/admin/collections/studio-users-old",
    "/admin/collections/mediator",
    "/admin/collections/pages",
  ])("does not match lookalike or approved path %s", (source) => {
    expect(strippedStudioDestination(source)).toBeNull();
  });

  it("redirects valid sessions but keeps invalid sessions on session-expired", async () => {
    const token = await encodeSession(session());
    const valid = await proxy(new NextRequest("https://studio.invalid/admin", {
      headers: { cookie: `${STUDIO_COOKIE}=${encodeURIComponent(token)}` },
    }));
    expect(valid.status).toBe(307);
    expect(valid.headers.get("location")).toBe(
      "https://studio.invalid/admin/collections/pages",
    );
    const invalid = await proxy(new NextRequest("https://studio.invalid/admin"));
    expect(invalid.status).toBe(307);
    expect(invalid.headers.get("location")).toBe(
      "https://studio.invalid/mingla/session-expired",
    );
    const near = await proxy(new NextRequest(
      "https://studio.invalid/admin/collections/mediator",
      { headers: { cookie: `${STUDIO_COOKIE}=${encodeURIComponent(token)}` } },
    ));
    expect(near.headers.get("location")).toBeNull();
  });

  it("hides only the stock Account control and preserves custom Studio nav", () => {
    const styles = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/(payload)/studio.css"),
      "utf8",
    );
    const nav = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/StudioNav.tsx"),
      "utf8",
    );
    expect(styles).toContain(".app-header__account");
    expect(styles).toContain("display: none !important");
    for (const label of [
      "Pages", "Media", "Navigation", "Footer", "Site settings & SEO",
      "Preview", "View live site", "Return to Mingla",
    ]) expect(nav).toContain(`\"${label}\"`);
    expect(nav).toContain('["Media", "/studio/media"]');
    expect(nav).not.toContain("/admin/collections/media");
  });
});
