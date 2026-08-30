import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadResolvedArtifact } from "./publication";

const PILOT_SITE_ID = "00000000-0000-4000-8000-000000000001";
const FOREIGN_SITE_ID = "00000000-0000-4000-8000-000000000099";

beforeAll(() => {
  Object.assign(process.env, {
    SITES_CORE_BASE_URL: "https://core.invalid",
    SITES_ARTIFACT_READ_BASE_URL: "https://storage.invalid",
    SITES_ARTIFACT_READ_TOKEN: "fixture-read-token",
    SITES_PUBLICATION_ARTIFACT_BUCKET: "artifacts",
    SITES_MEDIA_APPROVED_BUCKET: "approved",
    MINGLA_RUNTIME_TO_CORE_CURRENT_KID: "runtime-key-1",
    MINGLA_RUNTIME_TO_CORE_CURRENT_KEY_B64:
      "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=",
    SITES_PILOT_SITE_ID: PILOT_SITE_ID,
    SITES_CANDIDATE_PROBE_SECRET:
      "Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M=",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tester-owned immutable artifact path boundary", () => {
  it("rejects a cross-site artifact key before object storage is contacted", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response("not found", { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const publicationId = "00000000-0000-4000-8000-000000000002";
    const digest = "a".repeat(64);

    await expect(
      loadResolvedArtifact({
        site_id: PILOT_SITE_ID,
        brand_id: "00000000-0000-4000-8000-000000000003",
        publication_id: publicationId,
        artifact_key:
          `publications/${FOREIGN_SITE_ID}/${publicationId}/${digest}.json`,
        artifact_digest: digest,
        artifact_schema_version: 1,
        renderer_key: "restaurant-website-v1",
        renderer_version: 1,
        hostname: "gogi.sites.usemingla.com",
      }),
    ).rejects.toThrow("NOT_FOUND");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
