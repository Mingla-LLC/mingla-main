import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hasGrantedAnalyticsConsent } from "./consent";
import { signedCorePost } from "./coreGateway";

const PILOT_SITE_ID = "00000000-0000-4000-8000-000000000001";
const FOREIGN_SITE_ID = "00000000-0000-4000-8000-000000000099";

beforeAll(() => {
  Object.assign(process.env, {
    SITES_CORE_BASE_URL: "https://gqnoajqerqhnvulmnyvv.supabase.co",
    SITES_CMS_PROJECT_REF: "abcdefghijklmnopqrst",
    SITES_STORAGE_SUPABASE_URL:
      "https://abcdefghijklmnopqrst.supabase.co",
    SITES_STORAGE_SUPABASE_ANON_KEY: "fixture-anon-key",
    SITES_STORAGE_READER_EMAIL: "sites-reader@example.invalid",
    SITES_STORAGE_READER_PASSWORD: "fixture-reader-password",
    SITES_PUBLICATION_ARTIFACT_BUCKET: "sites-publication-artifacts",
    SITES_MEDIA_APPROVED_BUCKET: "sites-media-approved",
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

describe("public runtime signing boundary", () => {
  it("rejects a foreign site before issuing any Core request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      signedCorePost({
        edgeFunction: "brand-site-attribution",
        path: `/internal/v1/sites/${FOREIGN_SITE_ID}/analytics-events`,
        siteId: FOREIGN_SITE_ID,
        body: { action: "event", site_id: FOREIGN_SITE_ID },
      }),
    ).rejects.toThrow("SITE_SCOPE_MISMATCH");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("analytics consent cookie boundary", () => {
  it("accepts only the exact consent cookie name and value", () => {
    expect(
      hasGrantedAnalyticsConsent(
        "session=fixture; mingla_site_analytics_consent_v1=granted",
      ),
    ).toBe(true);
    for (const cookieHeader of [
      null,
      "xmingla_site_analytics_consent_v1=granted",
      "mingla_site_analytics_consent_v1=granted-extra",
      "mingla_site_analytics_consent_v1=necessary",
      "other=mingla_site_analytics_consent_v1=granted",
    ]) {
      expect(hasGrantedAnalyticsConsent(cookieHeader)).toBe(false);
    }
  });
});
