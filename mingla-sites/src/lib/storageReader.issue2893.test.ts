import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadRuntimeConfig } from "./config";
import { createPrivateObjectReader } from "./storageReader";

const READER_CONFIG = {
  storageSupabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
  storageSupabaseAnonKey: "fixture-anon-key",
  storageReaderEmail: "sites-reader@example.invalid",
  storageReaderPassword: "fixture-reader-password",
};

function authResponse(token: string, expiresIn = 3600): Response {
  return Response.json({ access_token: token, expires_in: expiresIn });
}

function validEnvironment(
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    SITES_CORE_BASE_URL: "https://gqnoajqerqhnvulmnyvv.supabase.co",
    SITES_CMS_PROJECT_REF: "abcdefghijklmnopqrst",
    SITES_STORAGE_SUPABASE_URL:
      "https://abcdefghijklmnopqrst.supabase.co",
    SITES_STORAGE_SUPABASE_ANON_KEY: "fixture-anon-key",
    SITES_STORAGE_READER_EMAIL: "sites-reader@example.invalid",
    SITES_STORAGE_READER_PASSWORD: "fixture-reader-password",
    SITES_PUBLICATION_ARTIFACT_BUCKET: "sites-publication-artifacts",
    SITES_MEDIA_APPROVED_BUCKET: "sites-media-approved",
    SITES_ALLOWED_HOST_SUFFIX: "sites.usemingla.com",
    MINGLA_RUNTIME_TO_CORE_CURRENT_KID: "runtime-key-1",
    MINGLA_RUNTIME_TO_CORE_CURRENT_KEY_B64:
      "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=",
    SITES_PILOT_SITE_ID: "00000000-0000-4000-8000-000000000001",
    SITES_CANDIDATE_PROBE_SECRET:
      "Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M=",
    ...overrides,
  };
}

describe("#2893 low-privilege private object reader", () => {
  it("uses one password grant and caches its user token across authenticated reads", async () => {
    const accessToken = "authenticated-reader-token-1";
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(authResponse(accessToken))
      .mockResolvedValueOnce(new Response("artifact"))
      .mockResolvedValueOnce(new Response("media"));
    const read = createPrivateObjectReader(READER_CONFIG, {
      fetch: fetchMock,
      now: () => 1_000,
    });

    await read(
      "artifacts",
      "publications/site-1/publication-1/artifact.json",
      "force-cache",
    );
    await read(
      "approved",
      "approved/site-1/media-1/640.webp",
      "force-cache",
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [authUrl, authInit] = fetchMock.mock.calls[0];
    expect(authUrl).toBe(
      "https://abcdefghijklmnopqrst.supabase.co/auth/v1/token?grant_type=password",
    );
    expect(authInit?.method).toBe("POST");
    expect(JSON.parse(String(authInit?.body))).toEqual({
      email: READER_CONFIG.storageReaderEmail,
      password: READER_CONFIG.storageReaderPassword,
    });
    const [objectUrl, objectInit] = fetchMock.mock.calls[1];
    expect(objectUrl).toBe(
      "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/authenticated/artifacts/publications/site-1/publication-1/artifact.json",
    );
    expect(new Headers(objectInit?.headers).get("authorization")).toBe(
      `Bearer ${accessToken}`,
    );
    expect(new Headers(objectInit?.headers).get("apikey")).toBe(
      READER_CONFIG.storageSupabaseAnonKey,
    );
    expect(String(objectUrl)).not.toContain(READER_CONFIG.storageReaderPassword);
  });

  it("refreshes near expiry and retries one rejected user token exactly once", async () => {
    let now = 10_000;
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(authResponse("authenticated-reader-token-1", 60))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(authResponse("authenticated-reader-token-2", 60))
      .mockResolvedValueOnce(new Response("artifact"))
      .mockResolvedValueOnce(new Response("media"))
      .mockResolvedValueOnce(authResponse("authenticated-reader-token-3", 60))
      .mockResolvedValueOnce(new Response("media-refreshed"));
    const read = createPrivateObjectReader(READER_CONFIG, {
      fetch: fetchMock,
      now: () => now,
    });

    const recovered = await read(
      "artifacts",
      "publications/site-1/publication-1/artifact.json",
      "no-store",
    );
    expect(await recovered.text()).toBe("artifact");
    await read("approved", "approved/site-1/media-1/640.webp", "force-cache");
    expect(fetchMock).toHaveBeenCalledTimes(5);

    now += 31_000;
    const refreshed = await read(
      "approved",
      "approved/site-1/media-1/960.webp",
      "force-cache",
    );
    expect(await refreshed.text()).toBe("media-refreshed");
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("rejects malformed storage scope before authentication or object fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const read = createPrivateObjectReader(READER_CONFIG, {
      fetch: fetchMock,
      now: () => 1_000,
    });
    for (const [bucket, key] of [
      ["../artifacts", "publications/site/artifact.json"],
      ["artifacts", "../artifact.json"],
      ["artifacts", "publications//artifact.json"],
      ["artifacts", "/publications/artifact.json"],
      ["artifacts", "publications\\artifact.json"],
    ]) {
      await expect(read(bucket, key, "no-store")).rejects.toThrow(
        "STORAGE_SCOPE_INVALID",
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires the exact Sites reader variables and never retains broad server credentials", () => {
    const config = loadRuntimeConfig(validEnvironment());
    expect(config.storageSupabaseUrl).toBe(READER_CONFIG.storageSupabaseUrl);
    expect(config.sitesProjectRef).toBe("abcdefghijklmnopqrst");
    for (const url of [
      "http://abcdefghijklmnopqrst.supabase.co",
      "https://abcdefghijklmnopqrst.supabase.co/storage/v1",
      "https://other.invalid",
    ]) {
      expect(() =>
        loadRuntimeConfig(
          validEnvironment({ SITES_STORAGE_SUPABASE_URL: url }),
        )
      ).toThrow("SERVICE_CONFIGURATION_INVALID");
    }
    for (const overrides of [
      {
        NODE_ENV: "production" as const,
        SITES_CORE_BASE_URL: "https://attacker.invalid",
      },
      {
        SITES_CMS_PROJECT_REF: "zyxwvutsrqponmlkjihg",
      },
      {
        SITES_PUBLICATION_ARTIFACT_BUCKET: "artifacts",
      },
      {
        SITES_MEDIA_APPROVED_BUCKET: "approved",
      },
    ]) {
      expect(() => loadRuntimeConfig(validEnvironment(overrides)))
        .toThrow("SERVICE_CONFIGURATION_INVALID");
    }
    const sources = [
      "src/lib/config.ts",
      "src/lib/storageReader.ts",
      "src/lib/publication.ts",
      "src/app/media/[mediaId]/[width]/route.ts",
      "src/app/api/internal/candidate-probe/route.ts",
    ].map((path) => readFileSync(path, "utf8")).join("\n");
    expect(sources).not.toMatch(
      /SITES_ARTIFACT_READ_TOKEN|SUPABASE_SERVICE_ROLE|S3_ACCESS_KEY|S3_SECRET_ACCESS_KEY/,
    );
  });
});
