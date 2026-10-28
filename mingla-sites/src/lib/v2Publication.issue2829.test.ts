/*
 * #2829 AD-1 (T-W3) — the runtime loads a v2 publication through the same
 * door as v1: the artifact must be the generation Core recorded, pass that
 * contract, and be bound to the resolved site, design and primary host. A v1
 * publication (rollback) still loads.
 */
import { createHash } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { readPrivateObject } = vi.hoisted(() => ({ readPrivateObject: vi.fn() }));
vi.mock("./storageReader", () => ({ readPrivateObject }));

import { loadResolvedArtifact, type ResolvedSite } from "./publication";
import { upgradeV1ToV2 } from "../contracts/generated/upgradeV1ToV2.ts";
import { FX, FX_SITE, gogiV1Fixture } from "../contracts/gogiV1.fixture";

beforeAll(() => {
  Object.assign(process.env, {
    SITES_CORE_BASE_URL: "https://gqnoajqerqhnvulmnyvv.supabase.co",
    SITES_CMS_PROJECT_REF: "abcdefghijklmnopqrst",
    SITES_STORAGE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SITES_STORAGE_SUPABASE_ANON_KEY: "fixture-anon-key",
    SITES_STORAGE_READER_EMAIL: "sites-reader@example.invalid",
    SITES_STORAGE_READER_PASSWORD: "fixture-reader-password",
    SITES_PUBLICATION_ARTIFACT_BUCKET: "sites-publication-artifacts",
    SITES_MEDIA_APPROVED_BUCKET: "sites-media-approved",
    MINGLA_RUNTIME_TO_CORE_CURRENT_KID: "runtime-key-1",
    MINGLA_RUNTIME_TO_CORE_CURRENT_KEY_B64: "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=",
    SITES_CANDIDATE_PROBE_SECRET: "Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M=",
  });
});
beforeEach(() => vi.clearAllMocks());

function stored(artifact: unknown, over: Partial<ResolvedSite> = {}): ResolvedSite {
  const bytes = Buffer.from(JSON.stringify(artifact));
  const digest = createHash("sha256").update(bytes).digest("hex");
  readPrivateObject.mockResolvedValue(new Response(bytes));
  return {
    site_id: FX_SITE,
    brand_id: FX(91),
    publication_id: FX(92),
    artifact_key: `publications/${FX_SITE}/${FX(92)}/${digest}.json`,
    artifact_digest: digest,
    artifact_schema_version: 2,
    renderer_key: "sites-v2",
    renderer_version: 1,
    hostname: "example-food.sites.localhost",
    primary_hostname: "example-food.sites.localhost",
    is_primary: true,
    host_kind: "mingla_subdomain",
    design_key: "atelier",
    ...over,
  };
}

describe("#2829 v2 publications load through the one door", () => {
  it("loads a v2 artifact bound to its site, design and primary host", async () => {
    const artifact = await loadResolvedArtifact(stored(upgradeV1ToV2(gogiV1Fixture())));
    expect((artifact as { design: { key: string } }).design.key).toBe("atelier");
  });

  it("still loads a v1 publication (rollback)", async () => {
    const artifact = await loadResolvedArtifact(stored(gogiV1Fixture(), {
      artifact_schema_version: 1, renderer_key: "restaurant-website-v1", design_key: null,
    }));
    expect((artifact as { schema_version: number }).schema_version).toBe(1);
  });

  it("refuses a generation, design or canonical that disagrees with Core", async () => {
    const v2 = upgradeV1ToV2(gogiV1Fixture());
    await expect(loadResolvedArtifact(stored(v2, { artifact_schema_version: 1, renderer_key: "restaurant-website-v1" }))).rejects.toThrow();
    await expect(loadResolvedArtifact(stored(v2, { design_key: "voyage" }))).rejects.toThrow("NOT_FOUND");
    await expect(loadResolvedArtifact(stored(v2, { primary_hostname: "other.sites.localhost" }))).rejects.toThrow("NOT_FOUND");
    await expect(loadResolvedArtifact(stored(gogiV1Fixture(), { artifact_schema_version: 2 }))).rejects.toThrow();
  });
});
