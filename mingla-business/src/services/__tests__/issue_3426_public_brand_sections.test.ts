/**
 * #3426 — IMPLEMENTOR suite for the brand page's date-decided sections, client
 * side. Runs in `mingla-business jest (full suite)`, the ALWAYS-RUN required
 * lane (its roots stop at mingla-business, so the shared module under
 * packages/brand-rendering is pinned from here — the #3188 precedent).
 *
 * WHAT IS PROVEN
 *   C-1  the shared feed maps a section row to the page's card shape exactly,
 *        with no theme and the server's starts_at / ends_at untouched;
 *   C-2  a page is limit rows plus a has-more signal from the (limit + 1)th row,
 *        which is never shown;
 *   C-3  the next cursor is the field the section is ORDERED by — ends_at for
 *        happening_now and past, starts_at for upcoming — plus the row id;
 *   C-4  a row for a different section is dropped, never shown in the wrong place;
 *   C-5  merged pages keep order and show each offering once;
 *   C-6  Happening now is read to the end, and a looping cursor is capped;
 *   C-7  the Host web / Business service sends exactly the RPC and arguments the
 *        migration defines, and surfaces an RPC error instead of an empty page;
 *   C-8  every surface is wired: the shared renderer no longer discards
 *        `pastEvents`, the Business adapter maps and passes it, and BOTH the
 *        Host route and the Explorer screen pass happeningNow / past /
 *        onLoadMorePast through the SAME shared feed module.
 *
 * FAILS-ON-REVERT: see the #3426 implementation report — restoring
 * `void providedPastEvents;` reds C-8; paging past on starts_at reds C-3;
 * removing the section filter reds C-4.
 */

import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const rpcMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import {
  BRAND_HAPPENING_NOW_MAX_PAGES,
  BRAND_SECTION_RPC,
  brandSectionCursorFor,
  brandSectionPageFromRows,
  collectBrandHappeningNow,
  mapBrandSectionRow,
  mergeBrandSectionPages,
  type BrandSectionPage,
  type BrandSectionRowRaw,
} from "@mingla/brand-rendering/brandSectionFeed";

import {
  fetchPublicBrandHappeningNow,
  fetchPublicBrandOfferingSection,
} from "../publicBrandSectionsService";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

const row = (
  id: string,
  section: BrandSectionRowRaw["section"],
  overrides: Partial<BrandSectionRowRaw> = {},
): BrandSectionRowRaw => ({
  offering_id: id,
  brand_id: "brand-1",
  brand_slug: "lantern-room",
  brand_name: "Lantern Room",
  offering_type: "event",
  offering_slug: `slug-${id}`,
  title: `Title ${id}`,
  description: null,
  cover_media_url: null,
  cover_media_type: null,
  section,
  starts_at: "2026-09-10T18:00:00+00:00",
  ends_at: "2026-09-10T22:00:00+00:00",
  price_from_cents: 1500,
  currency: "GBP",
  is_free: false,
  published_at: "2026-08-01T00:00:00+00:00",
  ...overrides,
});

beforeEach(() => {
  rpcMock.mockReset();
});

describe("#3426 shared section feed (packages/brand-rendering/brandSectionFeed)", () => {
  test("C-1 maps a section row to the card shape with no theme and the server's dates untouched", () => {
    const mapped = mapBrandSectionRow(
      row("a", "past", {
        offering_type: "trip",
        description: "A long weekend",
        cover_media_url: "https://cdn.example/cover.jpg",
        cover_media_type: "video",
        currency: null,
        is_free: true,
        price_from_cents: null,
      }),
    );
    expect(mapped).toEqual({
      offeringId: "a",
      brandId: "brand-1",
      brandSlug: "lantern-room",
      brandName: "Lantern Room",
      offeringType: "trip",
      offeringSlug: "slug-a",
      name: "Title a",
      bio: "A long weekend",
      coverMediaUrl: "https://cdn.example/cover.jpg",
      coverMediaType: "video",
      theme: null,
      startsAt: "2026-09-10T18:00:00+00:00",
      endsAt: "2026-09-10T22:00:00+00:00",
      priceFromMinorUnits: null,
      currency: "USD",
      isFree: true,
      publishedAt: "2026-08-01T00:00:00+00:00",
    });
  });

  test("C-2 a page is `limit` rows; the (limit + 1)th row only signals more and is never shown", () => {
    const rows = ["a", "b", "c"].map((id) => row(id, "past"));
    const exact = brandSectionPageFromRows("past", rows.slice(0, 2), 2);
    expect(exact.rows.map((r) => r.offeringId)).toEqual(["a", "b"]);
    expect(exact.hasMore).toBe(false);
    expect(exact.nextCursor).toBeNull();

    const more = brandSectionPageFromRows("past", rows, 2);
    expect(more.rows.map((r) => r.offeringId)).toEqual(["a", "b"]);
    expect(more.hasMore).toBe(true);

    expect(brandSectionPageFromRows("past", null, 20)).toEqual({
      rows: [],
      hasMore: false,
      nextCursor: null,
    });
  });

  test("C-3 the cursor pages on the field each section is ordered by", () => {
    const upcoming = brandSectionPageFromRows(
      "upcoming",
      [
        row("u1", "upcoming", { starts_at: "2026-10-01T10:00:00+00:00", ends_at: "2026-10-01T12:00:00+00:00" }),
        row("u2", "upcoming", { starts_at: "2026-10-02T10:00:00+00:00", ends_at: "2026-10-02T12:00:00+00:00" }),
      ],
      1,
    );
    expect(upcoming.nextCursor).toEqual({ at: "2026-10-01T10:00:00+00:00", id: "u1" });

    for (const section of ["past", "happening_now"] as const) {
      const page = brandSectionPageFromRows(
        section,
        [
          row("p1", section, { starts_at: "2026-09-01T10:00:00+00:00", ends_at: "2026-09-03T10:00:00+00:00" }),
          row("p2", section, { starts_at: "2026-08-01T10:00:00+00:00", ends_at: "2026-08-02T10:00:00+00:00" }),
        ],
        1,
      );
      expect(page.nextCursor).toEqual({ at: "2026-09-03T10:00:00+00:00", id: "p1" });
    }

    // No orderable value -> no cursor, never a guessed one.
    expect(
      brandSectionCursorFor("past", { offeringId: "x", startsAt: "2026-01-01T00:00:00Z", endsAt: null }),
    ).toBeNull();
    expect(
      brandSectionCursorFor("upcoming", { offeringId: "x", startsAt: null, endsAt: "2026-01-01T00:00:00Z" }),
    ).toBeNull();
  });

  test("C-4 a row for a different section is dropped", () => {
    const page = brandSectionPageFromRows(
      "past",
      [row("past-1", "past"), row("now-1", "happening_now"), row("up-1", "upcoming")],
      20,
    );
    expect(page.rows.map((r) => r.offeringId)).toEqual(["past-1"]);
  });

  test("C-5 merged pages keep order and show each offering once (kind + id)", () => {
    const pageOne = brandSectionPageFromRows("past", [row("a", "past"), row("b", "past")], 20);
    const pageTwo = brandSectionPageFromRows(
      "past",
      [row("b", "past"), row("b", "past", { offering_type: "rsvp" }), row("c", "past")],
      20,
    );
    expect(
      mergeBrandSectionPages([pageOne, pageTwo]).map((r) => `${r.offeringType}:${r.offeringId}`),
    ).toEqual(["event:a", "event:b", "rsvp:b", "event:c"]);
  });

  test("C-6 happening now is read to the end, and a looping cursor is capped", async () => {
    const pages: BrandSectionPage[] = [
      brandSectionPageFromRows("happening_now", [row("n1", "happening_now"), row("n2", "happening_now")], 1),
      brandSectionPageFromRows("happening_now", [row("n2", "happening_now"), row("n3", "happening_now")], 1),
      brandSectionPageFromRows("happening_now", [row("n3", "happening_now")], 1),
    ];
    const cursors: unknown[] = [];
    const fetchPage = jest.fn(async (cursor: unknown) => {
      cursors.push(cursor);
      return pages[cursors.length - 1] as BrandSectionPage;
    });
    const all = await collectBrandHappeningNow(fetchPage);
    expect(all.map((r) => r.offeringId)).toEqual(["n1", "n2", "n3"]);
    expect(cursors[0]).toBeNull();
    expect(cursors).toHaveLength(3);

    const forever = jest.fn(async () =>
      brandSectionPageFromRows("happening_now", [row("loop", "happening_now"), row("loop2", "happening_now")], 1),
    );
    const capped = await collectBrandHappeningNow(forever);
    expect(forever).toHaveBeenCalledTimes(BRAND_HAPPENING_NOW_MAX_PAGES);
    expect(capped.map((r) => r.offeringId)).toEqual(["loop"]);
  });
});

describe("#3426 Host web / Business service", () => {
  test("C-7 sends exactly the migration's RPC and arguments, first page and next page", async () => {
    rpcMock.mockResolvedValueOnce({ data: [row("a", "past"), row("b", "past")], error: null });
    const first = await fetchPublicBrandOfferingSection("lantern-room", "past", null, 1);
    expect(BRAND_SECTION_RPC).toBe("pg_public_brand_offering_section");
    expect(rpcMock).toHaveBeenLastCalledWith("pg_public_brand_offering_section", {
      p_brand_slug: "lantern-room",
      p_section: "past",
      p_cursor_at: null,
      p_cursor_id: null,
      p_limit: 1,
    });
    expect(first.hasMore).toBe(true);

    rpcMock.mockResolvedValueOnce({ data: [row("b", "past")], error: null });
    await fetchPublicBrandOfferingSection("lantern-room", "past", first.nextCursor, 1);
    expect(rpcMock).toHaveBeenLastCalledWith("pg_public_brand_offering_section", {
      p_brand_slug: "lantern-room",
      p_section: "past",
      p_cursor_at: "2026-09-10T22:00:00+00:00",
      p_cursor_id: "a",
      p_limit: 1,
    });
  });

  test("C-7 an RPC error is thrown, never turned into an empty section", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: new Error("permission denied") });
    await expect(fetchPublicBrandOfferingSection("lantern-room", "past")).rejects.toThrow(
      "permission denied",
    );
  });

  test("C-7 happening now asks for the happening_now section and follows the server's cursor", async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: Array.from({ length: 101 }, (_, i) =>
          row(`n${String(i).padStart(3, "0")}`, "happening_now", {
            ends_at: `2026-09-15T${String(10 + (i % 10)).padStart(2, "0")}:00:00+00:00`,
          }),
        ),
        error: null,
      })
      .mockResolvedValueOnce({ data: [row("last", "happening_now")], error: null });
    const all = await fetchPublicBrandHappeningNow("lantern-room");
    expect(all).toHaveLength(101);
    expect(rpcMock).toHaveBeenCalledTimes(2);
    const [, firstArgs] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
    const [, secondArgs] = rpcMock.mock.calls[1] as [string, Record<string, unknown>];
    expect(firstArgs).toMatchObject({ p_section: "happening_now", p_cursor_at: null, p_limit: 100 });
    expect(secondArgs).toMatchObject({ p_section: "happening_now", p_cursor_id: "n099", p_limit: 100 });
  });
});

describe("#3426 every surface is wired", () => {
  const renderer = read("packages/brand-rendering/PublicBrandPage.tsx");
  const adapter = read("mingla-business/src/components/brand/PublicBrandPage.tsx");
  const route = read("mingla-business/app/b/[brandSlug]/index.tsx");
  const hostHooks = read("mingla-business/src/hooks/usePublicBrandSections.ts");
  const explorerScreen = read("app-mobile/src/screens/ConsumerBrandProfileScreen.tsx");
  const explorerHooks = read("app-mobile/src/hooks/useBrandOfferingSections.ts");

  test("C-8 the shared renderer no longer discards pastEvents and has a Past tab", () => {
    expect(renderer).not.toMatch(/void\s+providedPastEvents/);
    expect(renderer).toContain("legacyPastCards(providedPastEvents ?? [], providedPastTrips ?? [])");
    expect(renderer).toContain('tabs.push("past")');
    expect(renderer).toContain("<HappeningNowBlock");
  });

  test("C-8 the Business adapter maps pastEvents and passes every section prop", () => {
    expect(adapter).not.toMatch(/void\s+pastEvents/);
    expect(adapter).toContain("pastEvents={sharedPastEvents}");
    for (const prop of [
      "happeningNow={happeningNow}",
      "past={past}",
      "pastHasMore={pastHasMore}",
      "pastLoadState={pastLoadState}",
    ]) {
      expect(adapter).toContain(prop);
    }
    expect(adapter).toMatch(/onLoadMorePast,\s*\n\s*onReservationsTabViewed/);
  });

  test("C-8 Host web route and Explorer screen both feed Happening now and Past", () => {
    for (const source of [route, explorerScreen]) {
      expect(source).toMatch(/happeningNow=\{\w+\.data \?\? \[\]\}/);
      expect(source).toMatch(/past=\{\w+\.rows \?\? \[\]\}/);
      expect(source).toMatch(/pastHasMore=\{\w+\.hasMore\}/);
      expect(source).toMatch(/pastLoadState=\{\w+\.loadState\}/);
      expect(source).toMatch(/onLoadMorePast[=:]\s*\{?\w+\.loadMore/);
    }
    for (const hooks of [hostHooks, explorerHooks]) {
      expect(hooks).toContain('from "@mingla/brand-rendering/brandSectionFeed"');
      expect(hooks).toContain("mergeBrandSectionPages(query.data.pages)");
    }
  });
});
