import { beforeAll, describe, expect, it } from "vitest";
import {
  buildVersionCollectionFields,
  validateQueryPaths,
  type Access,
  type SanitizedCollectionConfig,
  type SanitizedConfig,
  type Where,
} from "payload";

const LIVE_TENANT = "10000000-0000-4000-8000-000000003035";
const ASSIGNED_TENANT = "20000000-0000-4000-8000-000000003035";
const FOREIGN_TENANT = "30000000-0000-4000-8000-000000003035";
const OPERATOR = "40000000-0000-4000-8000-000000003035";
const VERSIONED_SLUGS = [
  "pages",
  "navigation",
  "footer",
  "site-settings",
] as const;

const fixtureKey = (character: string) =>
  Buffer.from(character.repeat(32)).toString("base64");

Object.assign(process.env, {
  DATABASE_URL: [
    "postgresql://",
    "fixture",
    ":",
    "fixture",
    "@",
    "db.invalid",
    "/sites",
  ].join(""),
  PAYLOAD_SECRET: fixtureKey("A"),
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
  SITES_PREVIEW_SIGNING_SECRET: fixtureKey("B"),
  MINGLA_CMS_TO_CORE_CURRENT_KEY_B64: fixtureKey("C"),
  MINGLA_CMS_TO_CORE_CURRENT_KID: "cms-core-current",
  MINGLA_CORE_TO_CMS_CURRENT_KEY_B64: fixtureKey("D"),
  MINGLA_CORE_TO_CMS_CURRENT_KID: "core-cms-current",
  SITES_CANDIDATE_PROBE_SECRET: fixtureKey("E"),
  SITES_PUBLIC_RUNTIME_ORIGIN: "https://runtime.invalid",
});

function requestArgs(
  liveTenant: string,
  assignedTenant: string,
): Parameters<Access>[0] {
  return {
    req: {
      user: {
        id: OPERATOR,
        collection: "studio-users",
        rank: 20,
        tenantId: liveTenant,
        tenants: [{ tenant: assignedTenant }],
      },
    },
  } as unknown as Parameters<Access>[0];
}

function atPath(row: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    return (value as Record<string, unknown>)[segment];
  }, row);
}

/** A deliberately strict oracle: unknown or malformed access never matches. */
function allows(where: unknown, row: Record<string, unknown>): boolean {
  if (!where || typeof where !== "object" || Array.isArray(where)) return false;
  const node = where as Record<string, unknown>;
  const entries = Object.entries(node);
  if (entries.length === 0) return false;

  if ("and" in node || "or" in node) {
    if (entries.length !== 1) return false;
    const operator = "and" in node ? "and" : "or";
    const branches = node[operator];
    if (!Array.isArray(branches) || branches.length === 0) return false;
    return operator === "and"
      ? branches.every((branch) => allows(branch, row))
      : branches.some((branch) => allows(branch, row));
  }

  return entries.every(([path, rawOperators]) => {
    if (
      !rawOperators ||
      typeof rawOperators !== "object" ||
      Array.isArray(rawOperators)
    ) return false;
    const operators = rawOperators as Record<string, unknown>;
    const operatorNames = Object.keys(operators);
    if (operatorNames.length !== 1) return false;
    const value = atPath(row, path);
    if (operatorNames[0] === "equals") return value === operators.equals;
    if (operatorNames[0] === "in" && Array.isArray(operators.in)) {
      return operators.in.includes(value);
    }
    return false;
  });
}

function pathsIn(where: unknown): string[] {
  if (!where || typeof where !== "object") return [];
  if (Array.isArray(where)) return where.flatMap(pathsIn);
  return Object.entries(where as Record<string, unknown>).flatMap(
    ([key, value]) =>
      key === "and" || key === "or" ? pathsIn(value) : [key],
  );
}

let cms: SanitizedConfig;
let versioned: SanitizedCollectionConfig[];

beforeAll(async () => {
  const { default: cmsPromise } = await import("../payload.config");
  cms = await cmsPromise;
  versioned = VERSIONED_SLUGS.map((slug) => {
    const collection = cms.collections.find((entry) => entry.slug === slug);
    if (!collection) throw new Error(`Configured collection missing: ${slug}`);
    return collection;
  });
});

async function effectiveAccess(
  collection: SanitizedCollectionConfig,
  liveTenant = LIVE_TENANT,
  assignedTenant = LIVE_TENANT,
): Promise<unknown> {
  const access = collection.access.readVersions;
  if (typeof access !== "function") return false;
  return access(requestArgs(liveTenant, assignedTenant));
}

function validatorRequest() {
  return {
    payload: {
      collections: Object.fromEntries(
        cms.collections.map((collection) => [
          collection.slug,
          { config: collection },
        ]),
      ),
      config: cms,
    },
  } as never;
}

describe("#3035 adversarial composed version tenancy", () => {
  it.each(VERSIONED_SLUGS)(
    "requires both signed and assigned tenant constraints for %s",
    async (slug) => {
      const collection = versioned.find((entry) => entry.slug === slug);
      expect(collection).toBeDefined();
      const effective = await effectiveAccess(collection!);

      expect(effective).not.toBe(true);
      expect(effective).not.toBe(false);
      expect(pathsIn(effective).sort()).toEqual([
        "version.tenant",
        "version.tenant",
      ]);
      expect(JSON.stringify(effective)).toContain(
        `"equals":"${LIVE_TENANT}"`,
      );
      expect(JSON.stringify(effective)).toContain(`"in":["${LIVE_TENANT}"]`);
      expect(allows(effective, { version: { tenant: LIVE_TENANT } })).toBe(
        true,
      );
      expect(allows(effective, { version: { tenant: FOREIGN_TENANT } })).toBe(
        false,
      );
    },
  );

  it.each(VERSIONED_SLUGS)(
    "denies both halves of an assignment mismatch for %s",
    async (slug) => {
      const collection = versioned.find((entry) => entry.slug === slug);
      expect(collection).toBeDefined();
      const mismatch = await effectiveAccess(
        collection!,
        LIVE_TENANT,
        ASSIGNED_TENANT,
      );

      expect(allows(mismatch, { version: { tenant: LIVE_TENANT } })).toBe(
        false,
      );
      expect(allows(mismatch, { version: { tenant: ASSIGNED_TENANT } })).toBe(
        false,
      );
      expect(allows(mismatch, { version: { tenant: FOREIGN_TENANT } })).toBe(
        false,
      );
    },
  );

  it.each(VERSIONED_SLUGS)(
    "Payload accepts the clean tree and rejects root-tenant contamination for %s",
    async (slug) => {
      const collection = versioned.find((entry) => entry.slug === slug);
      expect(collection).toBeDefined();
      const effective = await effectiveAccess(collection!);
      expect(effective).not.toBe(false);
      expect(effective).not.toBe(true);
      const versionFields = buildVersionCollectionFields(cms, collection!, true);

      await expect(
        validateQueryPaths({
          collectionConfig: collection!,
          overrideAccess: true,
          req: validatorRequest(),
          versionFields,
          where: effective as Where,
        }),
      ).resolves.toBeUndefined();

      const contaminated = {
        and: [effective, { tenant: { equals: LIVE_TENANT } }],
      } as Where;
      await expect(
        validateQueryPaths({
          collectionConfig: collection!,
          overrideAccess: true,
          req: validatorRequest(),
          versionFields,
          where: contaminated,
        }),
      ).rejects.toThrow("The following path cannot be queried: tenant");
    },
  );

  it.each([
    ["missing", undefined],
    ["null", null],
    ["boolean bypass", true],
    ["empty object", {}],
    ["empty conjunction", { and: [] }],
    ["mixed node", { and: [], tenant: { equals: LIVE_TENANT } }],
    ["unknown operator", { "version.tenant": { exists: true } }],
    ["malformed membership", { "version.tenant": { in: LIVE_TENANT } }],
  ])("fails its access oracle closed for a %s tree", (_label, malformed) => {
    expect(allows(malformed, { version: { tenant: LIVE_TENANT } })).toBe(false);
  });
});
