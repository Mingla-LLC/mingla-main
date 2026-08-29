/**
 * ORCH-0989 [Unified cover picker sheet] — implementor happy-path regression.
 *
 * Covers (per the IMPLEMENT dispatch Step 0.5):
 *   1. gallery-first GIF browse — trendingGiphyCovers hits GIPHY /trending
 *      (no `q`) client-direct and normalizes to GiphyCoverSearchResult[].
 *   2. gallery-first Stock browse — curatedPexelsCovers invokes the
 *      event-cover-pexels-curated edge fn (key stays server-side).
 *   3. brand-video apply target — event-cover-video-apply delegates to the
 *      atomic cover_video_apply_once owner for target_kind='brand'.
 *
 * fails-on-revert: deleting coverProviderBrowseService (revert) breaks (1)+(2);
 * reverting atomic brand/event branch ownership breaks (3).
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
  // [TEST-MOD-APPROVED #2715] The edge authorizes the exact target; the locked
  // SQL RPC owns the idempotent brand/event write and application receipt.
  test("event-cover-video-apply atomically applies target_kind='brand' through cover_video_apply_once", () => {
    const applySrc = repoFile("../supabase/functions/event-cover-video-apply/index.ts");
    const migration = repoFile(
      "../supabase/migrations/20270604002715_issue_2715_deterministic_cover_video_jobs.sql",
    ).replace(/\s+/g, " ");
    expect(applySrc).toContain('supabase.rpc(\n    "cover_video_apply_once"');
    expect(applySrc).toContain("p_job_id: job.id");
    expect(applySrc).toContain("p_expected_version:");
    expect(applySrc).toContain("p_expected_url:");
    expect(applySrc).not.toMatch(/\.from\("(?:brands|events)"\)/);

    const eventBranch = migration.slice(
      migration.indexOf("IF v_job.target_kind='event'"),
      migration.indexOf("ELSIF v_job.target_kind='brand'"),
    );
    const brandBranch = migration.slice(
      migration.indexOf("ELSIF v_job.target_kind='brand'"),
      migration.indexOf("UPDATE public.event_cover_video_jobs SET status='applied'"),
    );
    expect(eventBranch).toMatch(/UPDATE public\.events[\s\S]*WHERE id=v_job\.event_id/);
    expect(brandBranch).toMatch(/UPDATE public\.brands[\s\S]*WHERE id=v_job\.brand_id/);
    expect(brandBranch).toContain("cover_media_type='video'");
    expect(brandBranch).toContain("cover_media_url=v_job.processed_url");
    expect(brandBranch).toContain("cover_media_poster_url=v_job.processed_poster_url");
    expect(migration).toContain("WHERE id=p_job_id FOR UPDATE");
    expect(migration).toContain("IF v_job.status='applied' THEN RETURN v_job");
    expect(migration).toContain("application_version=application_version+1");
    expect(migration).toContain("application_receipt=jsonb_build_object");
  });
});
