/* eslint-disable import/first */
/**
 * Issue #4420 — the experience checkout resolver (by event id) takes its stops from
 * the gated public reader, never from experience_stops directly.
 *
 * The table serves a stop row to the public only while the experience's address is
 * visible, so a direct read would return no stops for a hidden-address experience.
 * The reader keeps the stop name, photos and time and applies the address rule.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpcMock = jest.fn() as any;
const tables: string[] = [];

function makeBuilder(table: string, single: unknown) {
  tables.push(table);
  const builder: Record<string, unknown> = {};
  const chain = (): unknown => builder;
  for (const m of ["select", "eq", "in", "is", "order", "limit"]) builder[m] = chain;
  builder.maybeSingle = async () => ({ data: single, error: null });
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  return builder;
}

const eventRow = {
  id: "exp-1",
  brand_id: "brand-1",
  title: "Wine Crawl",
  description: null,
  slug: "wine-crawl",
  status: "scheduled",
  visibility: "public",
  timezone: "UTC",
  theme: { experience_meta: { venue_text: "Raleigh, US" } },
  cover_media_url: null,
  cover_media_type: null,
  is_recurring: false,
  is_multi_date: false,
  recurrence_rules: null,
  experience_intents: ["group-fun"],
  brands: { id: "brand-1", slug: "lantern-vine", name: "Lantern & Vine" },
};

jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (table: string) => makeBuilder(table, table === "events" ? eventRow : null),
  },
}));

jest.mock("expo-image", () => ({}), { virtual: true });

import { getPublicExperienceById } from "../publicExperienceService";

describe("#4420 — by-id experience stops come from the public reader", () => {
  beforeEach(() => {
    tables.length = 0;
    rpcMock.mockReset();
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "pg_public_experience_by_slug") {
        return Promise.resolve({
          data: {
            stops: [
              {
                id: "stop-1",
                stopOrder: 0,
                placeName: "First stop",
                address: null,
                description: "Start here",
                startTime: null,
                lat: null,
                lng: null,
                imageUrls: ["https://example.test/a.jpg"],
              },
            ],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });
  });

  test("never reads experience_stops and keeps the reader's redacted stops", async () => {
    const payload = await getPublicExperienceById("exp-1");

    expect(tables).not.toContain("experience_stops");
    expect(rpcMock).toHaveBeenCalledWith("pg_public_experience_by_slug", {
      p_brand_slug: "lantern-vine",
      p_experience_slug: "wine-crawl",
    });
    expect(payload?.experience.stops).toEqual([
      expect.objectContaining({
        placeName: "First stop",
        address: null,
        lat: null,
        lng: null,
        imageUrls: ["https://example.test/a.jpg"],
        description: "Start here",
      }),
    ]);
    expect(payload?.experience.venueText).toBe("Raleigh, US");
  });

  // ORCH-1138 SC-2 (moved here from a source pin in
  // experiencePageRedesign.orch1138): the page gets the real authored stop
  // blurb, the stop's coordinates when the reader serves them, and the vibe
  // intents.
  test("keeps the authored blurb, the served coordinates and the vibe intents", async () => {
    rpcMock.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === "pg_public_experience_by_slug"
          ? {
              data: {
                stops: [
                  {
                    id: "stop-1",
                    stopOrder: 0,
                    placeName: "First stop",
                    address: "1 Main St",
                    description: "Start with a flight of reds",
                    startTime: null,
                    lat: 35.78,
                    lng: -78.64,
                    imageUrls: [],
                  },
                ],
              },
              error: null,
            }
          : { data: [], error: null },
      ),
    );
    const payload = await getPublicExperienceById("exp-1");
    expect(payload?.experience.stops[0]).toEqual(
      expect.objectContaining({
        description: "Start with a flight of reds",
        lat: 35.78,
        lng: -78.64,
      }),
    );
    expect(payload?.experience.intents).toEqual(["group-fun"]);
  });

  test("a reader error is thrown, never hidden", async () => {
    rpcMock.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === "pg_public_experience_by_slug"
          ? { data: null, error: { message: "boom" } }
          : { data: [], error: null },
      ),
    );
    await expect(getPublicExperienceById("exp-1")).rejects.toEqual({ message: "boom" });
  });
});
