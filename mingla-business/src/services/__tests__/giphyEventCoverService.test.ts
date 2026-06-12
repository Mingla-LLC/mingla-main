import { afterAll, beforeEach, describe, expect, jest, test } from "@jest/globals";

// ORCH-1127: the service now imports expo-constants (extra-first key read).
// These suites exercise the process.env fallback path, so `extra` is empty.
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} } },
}));

import { EventCoverProviderError } from "../eventCoverProviderError";
import { searchGiphyEventCovers } from "../giphyEventCoverService";

describe("giphy event cover service", () => {
  const originalFetch = global.fetch;
  const originalGiphyApiKey = process.env.EXPO_PUBLIC_GIPHY_API_KEY;
  const originalGiphyKey = process.env.EXPO_PUBLIC_GIPHY_KEY;

  const fetchJson = (body: unknown, status = 200): Response =>
    ({
      json: async () => body,
      ok: status >= 200 && status < 300,
      status,
    }) as Response;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_GIPHY_API_KEY = "public-giphy-key";
    delete process.env.EXPO_PUBLIC_GIPHY_KEY;
    global.fetch = jest.fn(async () =>
      fetchJson({
        data: [
          {
            id: "gif-1",
            title: "Jazz night",
            url: "https://giphy.com/gifs/jazz-night",
            images: {
              fixed_width: { url: "https://media.giphy.com/preview.gif" },
              downsized_medium: { url: "https://media.giphy.com/medium.gif" },
              downsized: { url: "https://media.giphy.com/downsized.gif" },
              original: { url: "https://media.giphy.com/original.gif" },
            },
          },
        ],
      }),
    ) as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
    process.env.EXPO_PUBLIC_GIPHY_API_KEY = originalGiphyApiKey;
    process.env.EXPO_PUBLIC_GIPHY_KEY = originalGiphyKey;
  });

  test("calls direct GIPHY search with exact query, rating, clamped limit, and offset", async () => {
    await expect(
      searchGiphyEventCovers(" jazz night ", { limit: 99, offset: -10 }),
    ).resolves.toHaveLength(1);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const requestUrl = new URL(String((global.fetch as jest.Mock).mock.calls[0][0]));
    expect(requestUrl.origin + requestUrl.pathname).toBe(
      "https://api.giphy.com/v1/gifs/search",
    );
    expect(requestUrl.searchParams.get("q")).toBe("jazz night");
    expect(requestUrl.searchParams.get("rating")).toBe("pg");
    expect(requestUrl.searchParams.get("limit")).toBe("25");
    expect(requestUrl.searchParams.get("offset")).toBe("0");
    expect(requestUrl.searchParams.get("api_key")).toBe("public-giphy-key");
  });

  test("normalizes selected GIF URL fallback order and provider metadata", async () => {
    (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce(
      fetchJson({
        data: [
          {
            id: "gif-downsized",
            title: "  Supper club loop  ",
            source_post_url: "https://artist.example.com/post",
            images: {
              fixed_width: { url: "https://media.giphy.com/preview.gif" },
              downsized: { url: "https://media.giphy.com/downsized.gif" },
              original: { url: "https://media.giphy.com/original.gif" },
            },
          },
          {
            id: "gif-original",
            title: "",
            source: "https://source.example.com/original",
            images: {
              fixed_width: { url: "https://media.giphy.com/preview-2.gif" },
              original: { url: "https://media.giphy.com/original-2.gif" },
            },
          },
          {
            id: "missing-preview",
            images: {
              original: { url: "https://media.giphy.com/not-renderable.gif" },
            },
          },
        ],
      }),
    );

    const results = await searchGiphyEventCovers("supper club");

    expect(results).toEqual([
      {
        id: "gif-downsized",
        provider: "giphy",
        previewUrl: "https://media.giphy.com/preview.gif",
        mediaUrl: "https://media.giphy.com/downsized.gif",
        sourceUrl: "https://artist.example.com/post",
        credit: "GIPHY",
        creditUrl: "https://artist.example.com/post",
        alt: "Supper club loop",
      },
      {
        id: "gif-original",
        provider: "giphy",
        previewUrl: "https://media.giphy.com/preview-2.gif",
        mediaUrl: "https://media.giphy.com/original-2.gif",
        sourceUrl: "https://source.example.com/original",
        credit: "GIPHY",
        creditUrl: "https://source.example.com/original",
        alt: null,
      },
    ]);
  });

  test("maps provider configuration, rate, availability, and response errors", async () => {
    delete process.env.EXPO_PUBLIC_GIPHY_API_KEY;
    delete process.env.EXPO_PUBLIC_GIPHY_KEY;

    await expect(searchGiphyEventCovers("ok")).rejects.toMatchObject({
      code: "not_configured",
    });

    process.env.EXPO_PUBLIC_GIPHY_KEY = "fallback-public-giphy-key";
    (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce(
      fetchJson({ data: [] }, 429),
    );
    await expect(searchGiphyEventCovers("ok")).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
    });

    (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce(
      fetchJson({ data: [] }, 503),
    );
    await expect(searchGiphyEventCovers("ok")).rejects.toMatchObject({
      code: "provider_unavailable",
      status: 503,
    });

    (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce(
      fetchJson({ data: null }),
    );
    await expect(searchGiphyEventCovers("ok")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  test("rejects short query before provider calls", async () => {
    await expect(searchGiphyEventCovers(" x ")).rejects.toBeInstanceOf(
      EventCoverProviderError,
    );
    await expect(searchGiphyEventCovers(" x ")).rejects.toMatchObject({
      code: "invalid_query",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
