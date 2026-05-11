import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const invokeMock = jest.fn<
  (...args: unknown[]) => Promise<{ data: unknown; error: Error | null }>
>();

jest.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: invokeMock,
    },
  },
}));

import { EventCoverProviderError } from "../eventCoverProviderError";
import { searchPexelsEventCovers } from "../pexelsEventCoverService";

describe("pexels event cover service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invokeMock.mockReset();
  });

  test("invokes the authenticated edge proxy with trimmed query and paging", async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        photos: [
          {
            id: 101,
            provider: "pexels",
            mediaUrl: "https://images.pexels.com/photos/101/landscape.jpeg",
            sourceUrl: "https://www.pexels.com/photo/101/",
            credit: "Jane Photographer",
            creditUrl: "https://www.pexels.com/@jane",
            alt: "Guests at a supper club",
            avgColor: "#123456",
            width: 1600,
            height: 900,
          },
        ],
        page: 2,
        nextPage: 3,
        rateLimit: { limit: 200, remaining: 199, reset: "12345" },
      },
      error: null,
    });

    const page = await searchPexelsEventCovers(" supper club ", {
      page: 2,
      perPage: 10,
    });

    expect(invokeMock).toHaveBeenCalledWith("event-cover-pexels-search", {
      body: {
        query: "supper club",
        page: 2,
        perPage: 10,
      },
    });
    expect(page.photos[0]).toMatchObject({
      provider: "pexels",
      mediaUrl: "https://images.pexels.com/photos/101/landscape.jpeg",
      credit: "Jane Photographer",
    });
  });

  test("rejects short queries before edge invocation", async () => {
    await expect(searchPexelsEventCovers(" x ")).rejects.toBeInstanceOf(
      EventCoverProviderError,
    );
    await expect(searchPexelsEventCovers(" x ")).rejects.toMatchObject({
      code: "invalid_query",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  test.each([
    ["auth_required", "auth_required"],
    ["pexels_rate_limited", "rate_limited"],
    ["pexels_not_configured", "not_configured"],
    ["invalid_query", "invalid_query"],
    ["temporary upstream outage", "provider_unavailable"],
  ])("maps edge error %s to %s", async (message, code) => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: new Error(message),
    });

    await expect(searchPexelsEventCovers("supper club")).rejects.toMatchObject({
      code,
      message,
    });
  });

  test("rejects invalid edge response shape", async () => {
    invokeMock.mockResolvedValueOnce({
      data: { photos: null },
      error: null,
    });

    await expect(searchPexelsEventCovers("supper club")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});
