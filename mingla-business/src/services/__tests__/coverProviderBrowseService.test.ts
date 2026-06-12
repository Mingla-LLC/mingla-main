/**
 * ORCH-0989 [Unified cover picker sheet] — implementor happy-path regression.
 *
 * Covers (per the IMPLEMENT dispatch Step 0.5):
 *   1. gallery-first GIF browse — trendingGiphyCovers hits GIPHY /trending
 *      (no `q`) client-direct and normalizes to GiphyCoverSearchResult[].
 *   2. gallery-first Stock browse — curatedPexelsCovers invokes the
 *      event-cover-pexels-curated edge fn (key stays server-side).
 *   3. brand-video apply target — event-cover-video-apply writes
 *      brands.cover_media_url + cover_media_type='video' for target_kind='brand'.
 *
 * fails-on-revert: deleting coverProviderBrowseService (revert) breaks (1)+(2);
 * reverting the brand apply branch breaks (3).
 */

import { readFileSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

// ORCH-1127: the service now imports expo-constants (extra-first key read).
// This suite exercises the process.env fallback path, so `extra` is empty.
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} } },
}));

// Mock the supabase client BEFORE importing the service so the curated path
// resolves to a controllable functions.invoke.
const invokeMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

import {
  curatedPexelsCovers,
  trendingGiphyCovers,
} from "../coverProviderBrowseService";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

const realFetch = globalThis.fetch;

describe("ORCH-0989 coverProviderBrowseService — gallery-first browse", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    // The service reads the GIPHY key from process.env — set the key without
    // clobbering the rest of process (e.g. process.cwd used elsewhere).
    process.env.EXPO_PUBLIC_GIPHY_API_KEY = "test-giphy-key";
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("trendingGiphyCovers calls GIPHY /trending (no q) and normalizes results", async () => {
    const fetchMock = jest.fn(async (url: string): Promise<Response> => {
      expect(url).toContain("https://api.giphy.com/v1/gifs/trending");
      // gallery-first: trending takes NO query param.
      expect(url).not.toContain("q=");
      expect(url).toContain("api_key=test-giphy-key");
      return {
        status: 200,
        ok: true,
        json: async () => ({
          data: [
            {
              id: "gif-1",
              title: "trending one",
              url: "https://giphy.com/gifs/gif-1",
              images: {
                fixed_width: { url: "https://media.giphy.com/preview.gif" },
                downsized_medium: { url: "https://media.giphy.com/full.gif" },
              },
            },
          ],
        }),
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const results = await trendingGiphyCovers({ limit: 24 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "gif-1",
      provider: "giphy",
      previewUrl: "https://media.giphy.com/preview.gif",
      mediaUrl: "https://media.giphy.com/full.gif",
    });
  });

  test("curatedPexelsCovers invokes the curated edge fn (key server-side)", async () => {
    invokeMock.mockResolvedValue({
      data: {
        photos: [
          {
            id: 42,
            provider: "pexels",
            mediaUrl: "https://images.pexels.com/photo-42.jpg",
            sourceUrl: "https://www.pexels.com/photo/42",
            credit: "A Photographer",
            creditUrl: "https://www.pexels.com/@a",
            alt: "a curated photo",
            avgColor: "#223344",
            width: 1200,
            height: 800,
          },
        ],
        page: 1,
        nextPage: 2,
        rateLimit: { limit: 200, remaining: 199, reset: null },
      },
      error: null,
    });

    const page = await curatedPexelsCovers({ perPage: 20 });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0][0]).toBe("event-cover-pexels-curated");
    expect(page.photos).toHaveLength(1);
    expect(page.photos[0]).toMatchObject({ id: 42, provider: "pexels" });
  });
});

describe("ORCH-0989 brand-video apply target", () => {
  test("event-cover-video-apply writes brands.cover_media_url for target_kind='brand'", () => {
    const applySrc = repoFile("../supabase/functions/event-cover-video-apply/index.ts");
    // The brand branch must UPDATE brands SET cover_media_url + type='video'.
    expect(applySrc).toMatch(/target_kind === "brand"/);
    expect(applySrc).toMatch(/\.from\("brands"\)/);
    expect(applySrc).toMatch(/cover_media_url: job\.processed_url/);
    expect(applySrc).toMatch(/cover_media_type: "video"/);
  });
});
