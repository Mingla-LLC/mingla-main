/*
 * #2829 W5 — where forms send, and whether a contact form is shown.
 *
 *  - production always sends to Core, local mode to the local Core stack
 *    (the #4111 stand-in and its override are gone since the merge onto
 *    #4111: the real functions run locally);
 *  - the enquiry status is cached per site for 60 s and, when Core cannot
 *    answer, is "unknown" (the form stays) and the failure is logged.
 */
import { describe, expect, it, vi } from "vitest";
import { loadRuntimeConfig } from "./config";
import { assertNoLocalModeOnVercelBuild, localModeEnabled } from "./localMode";
import { clearEnquiryAvailabilityCache, enquiryAvailability, ENQUIRY_STATUS_FRESH_MS } from "./enquiryAvailability";

const KEY = "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=";
const PROBE = "Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M=";

function production(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    SITES_CORE_BASE_URL: "https://gqnoajqerqhnvulmnyvv.supabase.co",
    SITES_CMS_PROJECT_REF: "abcdefghijklmnopqrst",
    SITES_STORAGE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SITES_STORAGE_SUPABASE_ANON_KEY: "fixture-anon-key",
    SITES_STORAGE_READER_EMAIL: "sites-reader@example.invalid",
    SITES_STORAGE_READER_PASSWORD: "fixture-reader-password",
    SITES_PUBLICATION_ARTIFACT_BUCKET: "sites-publication-artifacts",
    SITES_MEDIA_APPROVED_BUCKET: "sites-media-approved",
    MINGLA_RUNTIME_TO_CORE_CURRENT_KID: "runtime-key-1",
    MINGLA_RUNTIME_TO_CORE_CURRENT_KEY_B64: KEY,
    SITES_CANDIDATE_PROBE_SECRET: PROBE,
    ...overrides,
  };
}

const local = (overrides: Partial<NodeJS.ProcessEnv> = {}) => production({
  SITES_LOCAL_MODE: "1",
  SITES_CORE_BASE_URL: "http://127.0.0.1:55321",
  SITES_STORAGE_SUPABASE_URL: "http://127.0.0.1:55421",
  ...overrides,
});

describe("#2829 W5 forms send to Mingla's Core", () => {
  it("sends to Core in production", () => {
    expect(loadRuntimeConfig(production()).formsFunctionsBaseUrl).toBe("https://gqnoajqerqhnvulmnyvv.supabase.co");
  });

  it("sends to the local Core stack in local mode, and ignores the retired stand-in override", () => {
    expect(loadRuntimeConfig(local()).formsFunctionsBaseUrl).toBe("http://127.0.0.1:55321");
    expect(loadRuntimeConfig(local({ SITES_LOCAL_FORMS_STUB_ORIGIN: "http://127.0.0.1:3199" })).formsFunctionsBaseUrl).toBe("http://127.0.0.1:55321");
    expect(loadRuntimeConfig(production({ SITES_LOCAL_FORMS_STUB_ORIGIN: "http://127.0.0.1:3199" })).formsFunctionsBaseUrl).toBe("https://gqnoajqerqhnvulmnyvv.supabase.co");
  });
});

describe("#2829 W5 whether the contact form is shown", () => {
  const site = { site_id: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001" };

  it("caches Mingla's answer per site for 60 s", async () => {
    clearEnquiryAvailabilityCache();
    let now = 1_000;
    const fetcher = vi.fn(async () => "unavailable" as const);
    expect(await enquiryAvailability(site, { fetcher, now: () => now })).toBe("unavailable");
    now += ENQUIRY_STATUS_FRESH_MS - 1;
    expect(await enquiryAvailability(site, { fetcher, now: () => now })).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 2;
    await enquiryAvailability(site, { fetcher, now: () => now });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("answers unknown (form kept) and logs when Core cannot answer", async () => {
    clearEnquiryAvailabilityCache();
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    expect(await enquiryAvailability(site, { fetcher: async () => { throw new Error("down"); } })).toBe("unknown");
    expect(log.mock.calls.some(([line]) => String(line).includes("public.forms.enquiry_status_unknown"))).toBe(true);
    log.mockRestore();
  });
});
