import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateImportMap } from "payload";
import { describe, expect, it } from "vitest";

const checkedImportMapPath = "src/app/(payload)/admin/importMap.js";
const competingImportMapPath = "src/app/(payload)/admin/importMap.ts";
const layoutPath = "src/app/(payload)/layout.tsx";
const tsconfigPath = "tsconfig.json";
const fixtureKey = (character: string): string =>
  Buffer.from(character.repeat(32), "utf8").toString("base64");
const postgresFixtureUrl = (): string =>
  [
    "postgresql",
    "://",
    "sites_cms_app.abcdefghijklmnopqrst",
    ":",
    "fixture",
    "@",
    "aws-0-us-east-2.pooler.supabase.com",
    ":6543/postgres?sslmode=require",
  ].join("");

const expectedKeys = [
  "@payloadcms/plugin-multi-tenant/client#WatchTenantCollection",
  "@payloadcms/plugin-multi-tenant/client#TenantField",
  "@payloadcms/plugin-multi-tenant/client#AssignTenantFieldTrigger",
  "@payloadcms/plugin-multi-tenant/rsc#TenantSelector",
  "@payloadcms/plugin-multi-tenant/rsc#TenantSelectionProvider",
  "@payloadcms/richtext-lexical/rsc#RscEntryLexicalCell",
  "@payloadcms/richtext-lexical/rsc#RscEntryLexicalField",
  "@payloadcms/richtext-lexical/rsc#LexicalDiffComponent",
  "@payloadcms/richtext-lexical/client#LinkFeatureClient",
  "@payloadcms/richtext-lexical/client#UnorderedListFeatureClient",
  "@payloadcms/richtext-lexical/client#OrderedListFeatureClient",
  "@payloadcms/richtext-lexical/client#BoldFeatureClient",
  "@payloadcms/richtext-lexical/client#ItalicFeatureClient",
  "@payloadcms/richtext-lexical/client#HeadingFeatureClient",
  "@payloadcms/richtext-lexical/client#ParagraphFeatureClient",
  "@/components/StudioNav#default",
  "@/components/StudioLogo#default",
  "@payloadcms/storage-s3/client#S3ClientUploadHandler",
  "@payloadcms/next/rsc#CollectionCards",
].sort();

const fixtureEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  DATABASE_URL: postgresFixtureUrl(),
  PAYLOAD_SECRET: fixtureKey("A"),
  SITES_CORE_BASE_URL: "https://gqnoajqerqhnvulmnyvv.supabase.co",
  SITES_CMS_ORIGIN: "https://studio.sites.usemingla.com",
  SUPABASE_S3_ENDPOINT:
    "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3",
  SUPABASE_S3_REGION: "us-east-2",
  SUPABASE_S3_ACCESS_KEY_ID: "fixture-access-key",
  SUPABASE_S3_SECRET_ACCESS_KEY: "fixture-secret-key",
  SITES_MEDIA_QUARANTINE_BUCKET: "sites-media-quarantine",
  SITES_MEDIA_APPROVED_BUCKET: "sites-media-approved",
  SITES_PUBLICATION_ARTIFACT_BUCKET: "sites-publication-artifacts",
  SITES_MEDIA_RECOVERY_BUCKET: "sites-media-recovery",
  SITES_PREVIEW_SIGNING_SECRET: fixtureKey("A"),
  MINGLA_CMS_TO_CORE_CURRENT_KID: "cms-core-current",
  MINGLA_CMS_TO_CORE_CURRENT_KEY_B64: fixtureKey("B"),
  MINGLA_CORE_TO_CMS_CURRENT_KID: "core-cms-current",
  MINGLA_CORE_TO_CMS_CURRENT_KEY_B64: fixtureKey("C"),
  SITES_CANDIDATE_PROBE_SECRET: fixtureKey("D"),
  SITES_PUBLIC_RUNTIME_ORIGIN: "https://gogi.sites.usemingla.com",
};

function semanticBindings(source: string): Map<string, string> {
  const identifiers = new Map<string, string>();
  const importPattern = /import \{ ([A-Za-z0-9_$]+) as ([A-Za-z0-9_$]+) \} from '([^']+)'/g;
  for (const match of source.matchAll(importPattern)) {
    identifiers.set(match[2], `${match[3]}#${match[1]}`);
  }

  const bindings = new Map<string, string>();
  const mapPattern = /^\s*"([^"]+)": ([A-Za-z0-9_$]+),?$/gm;
  for (const match of source.matchAll(mapPattern)) {
    const binding = identifiers.get(match[2]);
    if (!binding) throw new Error(`Unresolved generated import-map identifier: ${match[2]}`);
    bindings.set(match[1], binding);
  }
  return bindings;
}

async function freshGeneratedMap(): Promise<string> {
  const previousEnvironment = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(fixtureEnvironment)) {
    previousEnvironment.set(name, process.env[name]);
    process.env[name] = value;
  }

  const previousRootDir = process.env.ROOT_DIR;
  const rootDir = mkdtempSync(path.join(tmpdir(), "mingla-issue-3026-"));
  const targetDirectory = path.join(rootDir, "src/app/(payload)/admin");
  mkdirSync(targetDirectory, { recursive: true });
  process.env.ROOT_DIR = rootDir;

  try {
    const { default: configPromise } = await import("../payload.config");
    const config = await configPromise;
    await generateImportMap(config, { force: true, log: false });
    return readFileSync(path.join(targetDirectory, "importMap.js"), "utf8");
  } finally {
    if (previousRootDir === undefined) delete process.env.ROOT_DIR;
    else process.env.ROOT_DIR = previousRootDir;
    for (const [name, value] of previousEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(rootDir, { recursive: true, force: true });
  }
}

describe("#3026 Payload import-map synchronization", () => {
  it("keeps one generator-owned map semantically equal to the current Payload config", async () => {
    expect(existsSync(checkedImportMapPath)).toBe(true);
    expect(existsSync(competingImportMapPath)).toBe(false);

    const checkedSource = readFileSync(checkedImportMapPath, "utf8");
    expect(checkedSource).toContain("/** @type import('payload').ImportMap */");
    const checked = semanticBindings(checkedSource);
    const generated = semanticBindings(await freshGeneratedMap());
    expect([...checked.keys()].sort()).toEqual(expectedKeys);
    expect([...checked.entries()].sort()).toEqual([...generated.entries()].sort());
  });

  it("preserves the Payload server-action boundary and canonical map import", () => {
    const layout = readFileSync(layoutPath, "utf8");
    expect(layout).toContain('import { importMap } from "./admin/importMap.js";');
    expect(layout).toMatch(
      /const serverFunction: ServerFunctionClient = async \(args\) => \{\s*"use server";\s*return handleServerFunctions\(\{ \.\.\.args, config, importMap \}\);\s*\};/,
    );
    expect(layout).toContain("serverFunction={serverFunction}");
  });

  it("keeps the generated JavaScript map inside strict TypeScript checking", () => {
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8")) as {
      compilerOptions?: { allowJs?: unknown; noEmit?: unknown; strict?: unknown };
    };
    expect(tsconfig.compilerOptions?.allowJs).toBe(true);
    expect(tsconfig.compilerOptions?.strict).toBe(true);
    expect(tsconfig.compilerOptions?.noEmit).toBe(true);
  });
});

describe("#3026 deployment build cannot bypass import-map generation", () => {
  it("runs the canonical generator immediately before every Next production build", () => {
    const packageManifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, unknown>;
    };

    expect(packageManifest.scripts?.["generate:importmap"]).toBe(
      "payload generate:importmap",
    );
    expect(packageManifest.scripts?.build).toBe(
      "npm run generate:importmap && next build",
    );
  });
});
