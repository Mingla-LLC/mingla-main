import { beforeAll, describe, expect, it } from "vitest";
import {
  buildVersionCollectionFields,
  validateQueryPaths,
  type Access,
  type CollectionConfig,
  type SanitizedCollectionConfig,
  type SanitizedConfig,
  type Where,
} from "payload";
import { Footer } from "../collections/Footer";
import { Navigation } from "../collections/Navigation";
import { Pages } from "../collections/Pages";
import { SiteSettings } from "../collections/SiteSettings";
import {
  tenantRead,
  tenantVersionRead,
  tenantWrite,
} from "./access";

const TENANT_ID = "00000000-0000-4000-8000-000000003035";
const OTHER_TENANT_ID = "00000000-0000-4000-8000-000000003036";
const USER_ID = "00000000-0000-4000-8000-000000003037";

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

const rawVersionedCollections: CollectionConfig[] = [
  Pages,
  Navigation,
  Footer,
  SiteSettings,
];
const rawAccess = new Map(
  rawVersionedCollections.map((collection) => [
    collection.slug,
    {
      create: collection.access?.create,
      read: collection.access?.read,
      readVersions: collection.access?.readVersions,
      update: collection.access?.update,
    },
  ]),
);

function accessArgs(user: Record<string, unknown> | null): Parameters<Access>[0] {
  return { req: { user } } as Parameters<Access>[0];
}

function studioUser(
  tenantId: string | null = TENANT_ID,
  rank = 20,
  assignedTenantId = TENANT_ID,
): Record<string, unknown> {
  return {
    id: USER_ID,
    collection: "studio-users",
    rank,
    ...(tenantId === null ? {} : { tenantId }),
    tenants: [{ tenant: assignedTenantId }],
  };
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function matchesWhere(where: unknown, row: Record<string, unknown>): boolean {
  if (!where || typeof where !== "object") return false;
  const constraint = where as Record<string, unknown>;
  if (Array.isArray(constraint.and)) {
    return constraint.and.every((part) => matchesWhere(part, row));
  }
  if (Array.isArray(constraint.or)) {
    return constraint.or.some((part) => matchesWhere(part, row));
  }
  return Object.entries(constraint).every(([path, operatorValue]) => {
    if (!operatorValue || typeof operatorValue !== "object") return false;
    const operators = operatorValue as Record<string, unknown>;
    const actual = valueAtPath(row, path);
    if ("equals" in operators) return actual === operators.equals;
    if (Array.isArray(operators.in)) return operators.in.includes(actual);
    return false;
  });
}

function tenantLeafPaths(where: unknown): string[] {
  if (!where || typeof where !== "object") return [];
  if (Array.isArray(where)) return where.flatMap(tenantLeafPaths);
  return Object.entries(where as Record<string, unknown>).flatMap(
    ([key, value]) => {
      if (key === "tenant" || key === "version.tenant") return [key];
      return tenantLeafPaths(value);
    },
  );
}

let configuredCms: SanitizedConfig;
let configuredVersionedCollections: SanitizedCollectionConfig[];

beforeAll(async () => {
  const { default: configPromise } = await import("../payload.config");
  configuredCms = await configPromise;
  configuredVersionedCollections = rawVersionedCollections.map(
    ({ slug }) => {
      const collection = configuredCms.collections.find(
        (candidate) => candidate.slug === slug,
      );
      if (!collection) throw new Error(`Missing configured ${slug} collection`);
      return collection;
    },
  );
});

describe("#3035 tenant-scoped version access", () => {
  it("keeps ordinary access at tenant and version access at version.tenant", async () => {
    expect(await tenantRead(accessArgs(studioUser()))).toEqual({
      tenant: { equals: TENANT_ID },
    });
    expect(await tenantWrite(accessArgs(studioUser()))).toEqual({
      tenant: { equals: TENANT_ID },
    });
    expect(await tenantVersionRead(accessArgs(studioUser()))).toEqual({
      "version.tenant": { equals: TENANT_ID },
    });
  });

  it.each([
    ["anonymous", null],
    ["low rank", studioUser(TENANT_ID, 19)],
    ["missing tenant", studioUser(null)],
    ["empty tenant", studioUser("")],
    ["invalid user", {}],
  ])("fails both predicates closed for %s", async (_label, currentUser) => {
    expect(await tenantRead(accessArgs(currentUser))).toBe(false);
    expect(await tenantVersionRead(accessArgs(currentUser))).toBe(false);
  });

  it("binds only the dedicated predicate to every version-enabled tenant collection", () => {
    expect(
      configuredCms.collections
        .filter((collection) => Boolean(collection.versions))
        .map(({ slug }) => slug),
    ).toEqual(["pages", "navigation", "footer", "site-settings"]);
    expect(rawVersionedCollections.map(({ slug }) => slug)).toEqual([
      "pages",
      "navigation",
      "footer",
      "site-settings",
    ]);
    for (const collection of rawVersionedCollections) {
      expect(collection.versions).toBeTruthy();
      expect(rawAccess.get(collection.slug)?.readVersions).toBe(
        tenantVersionRead,
      );
      expect(rawAccess.get(collection.slug)?.readVersions).not.toBe(tenantRead);
      expect(rawAccess.get(collection.slug)?.read).toBe(tenantRead);
      expect(rawAccess.get(collection.slug)?.create).toBe(tenantWrite);
      expect(rawAccess.get(collection.slug)?.update).toBe(tenantWrite);
    }
  });

  it("produces a plugin-wrapped where tree that validates against real version fields and isolates tenants", async () => {
    const ownVersion = { version: { tenant: TENANT_ID } };
    const otherVersion = { version: { tenant: OTHER_TENANT_ID } };
    const payloadCollections = Object.fromEntries(
      configuredCms.collections.map((collection) => [
        collection.slug,
        { config: collection },
      ]),
    );

    for (const collection of configuredVersionedCollections) {
      const effective = await collection.access.readVersions(
        accessArgs(studioUser()),
      );
      expect(effective).not.toBe(false);
      expect(effective).not.toBe(true);
      expect(effective).toEqual({
        and: [
          { "version.tenant": { equals: TENANT_ID } },
          { "version.tenant": { in: [TENANT_ID] } },
        ],
      });
      expect(tenantLeafPaths(effective)).toEqual([
        "version.tenant",
        "version.tenant",
      ]);
      expect(matchesWhere(effective, ownVersion)).toBe(true);
      expect(matchesWhere(effective, otherVersion)).toBe(false);

      const versionFields = buildVersionCollectionFields(
        configuredCms,
        collection,
        true,
      );
      await expect(
        validateQueryPaths({
          collectionConfig: collection,
          overrideAccess: true,
          req: {
            payload: {
              collections: payloadCollections,
              config: configuredCms,
            },
          } as never,
          versionFields,
          where: effective as Where,
        }),
      ).resolves.toBeUndefined();
    }
  });

  it("keeps the effective plugin access fail-closed and denies assignment mismatch", async () => {
    for (const collection of configuredVersionedCollections) {
      expect(await collection.access.readVersions(accessArgs(null))).toBe(false);
      expect(
        await collection.access.readVersions(
          accessArgs(studioUser(TENANT_ID, 19)),
        ),
      ).toBe(false);
      expect(
        await collection.access.readVersions(accessArgs(studioUser(null))),
      ).toBe(false);

      const mismatch = await collection.access.readVersions(
        accessArgs(studioUser(TENANT_ID, 20, OTHER_TENANT_ID)),
      );
      expect(mismatch).not.toBe(false);
      expect(
        matchesWhere(mismatch, { version: { tenant: TENANT_ID } }),
      ).toBe(false);
      expect(
        matchesWhere(mismatch, { version: { tenant: OTHER_TENANT_ID } }),
      ).toBe(false);
    }
  });
});
