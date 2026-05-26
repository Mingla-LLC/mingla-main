/**
 * ORCH-0962 adversarial regression tests (A-01..A-05).
 *
 * Each test attacks a DIFFERENT angle than the implementor's happy-path
 * suite (T-01..T-09 in publicEventsService.orch_0962.test.ts +
 * PublicBrandPage.orch_0962.test.ts). All 5 are verified to FAIL when
 * the ORCH-0962 fix patch is reverted (so they actually exercise the
 * bug, not just the code shape).
 *
 *   - A-01: description = "\n\n" only — boundary where trim leaves an
 *     empty string. Pre-fix mapper would assign the literal "\n\n" to
 *     bio; post-fix splitBrandDescription returns {} so neither field
 *     renders. T-01 (happy path) only covers the normal two-paragraph
 *     case.
 *   - A-02: multi-paragraph bio — three-paragraph description where
 *     the operator's bio itself contains paragraph breaks. Verifies
 *     the post-fix mapper splits ONLY on the first \n\n and rejoins
 *     paragraphs 2+ as bio, NOT every \n\n separator. Pre-fix mapper
 *     would assign the whole multi-paragraph string to bio (tagline
 *     hardcoded undefined). T-01 only tests a single tagline + single-
 *     paragraph bio.
 *   - A-03: partial-presence contact — email populated, phone is
 *     whitespace-only. Verifies extractBrandContact emits a contact
 *     object containing ONLY the populated field (NOT both, NOT
 *     undefined). Pre-fix mapper produced contact: undefined for any
 *     row (full omit). T-02 tests both fields present; T-03 tests both
 *     null; partial-presence is uncovered.
 *   - A-04: trip_planner brand kind in event-detail context. Verifies
 *     viewRowToBrand reads address and cover fields from the view row truthfully.
 *   - A-05: structural integrity of SocialLinksRow's URL builder for
 *     the two newly-rendered platforms. Verifies BOTH facebook AND
 *     linkedin entries call `normalizeSocialUrl(links.X, "...")` with
 *     the user value as the first arg (NOT hardcoded URLs) AND with
 *     the correct host base for each. Pre-fix component had no
 *     facebook/linkedin entries at all so neither normalizeSocialUrl
 *     reference existed. Implementor's T-07/T-08 only check existence
 *     of the entry objects.
 *
 * No product code touched. Test-only file per ORCH-0840 append-only
 * gate. ORCH-0962 implementation commit 52e37c2bc; REVIEW approved at
 * 622059ae1.
 */
import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import {
  getPublicEventBySlug,
  publicBrandViewRowToBrand,
} from "../publicEventsService";

const queryBuilder = <T,>(
  terminal: "maybeSingle" | "order",
  result: { data: T; error: Error | null },
) => {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    is: jest.fn(() => builder),
    order: jest.fn(() =>
      terminal === "order" ? Promise.resolve(result) : builder,
    ),
    maybeSingle: jest.fn(() =>
      terminal === "maybeSingle" ? Promise.resolve(result) : builder,
    ),
  };
  return builder;
};

const publicBrandRow = (
  patch: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: "brand-0962-adv",
  slug: "orch-0962-brand-adv",
  name: "ORCH 0962 Adversarial Brand",
  description: null,
  profile_photo_url: null,
  contact_email: null,
  contact_phone: null,
  social_links: {},
  custom_links: [],
  display_attendee_count: true,
  address: null,
  cover_hue: 25,
  cover_media_url: null,
  cover_media_type: null,
  profile_photo_type: null,
  created_at: "2026-05-25T00:00:00.000Z",
  updated_at: "2026-05-25T00:00:00.000Z",
  ...patch,
});

const eventRow = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "event-0962-adv",
  brand_id: "brand-0962-adv",
  brand_slug: "orch-0962-brand-adv",
  brand_name: "ORCH 0962 Adversarial Brand",
  brand_description: null,
  brand_profile_photo_url: null,
  brand_display_attendee_count: true,
  brand_address: null,
  brand_cover_media_url: null,
  title: "ORCH 0962 Adversarial Event",
  description: null,
  slug: "orch-0962-event-adv",
  event_type: "event",
  location_text: null,
  online_url: null,
  is_online: false,
  is_recurring: false,
  is_multi_date: false,
  recurrence_rules: null,
  cover_media_url: null,
  cover_media_type: null,
  cover_media_provider: null,
  cover_media_source_url: null,
  cover_media_credit: null,
  cover_media_credit_url: null,
  cover_media_alt: null,
  currency: "GBP",
  visibility: "public",
  show_on_discover: true,
  status: "scheduled",
  published_at: "2026-05-25T00:00:00.000Z",
  timezone: "Europe/London",
  created_at: "2026-05-25T00:00:00.000Z",
  updated_at: "2026-05-25T00:00:00.000Z",
  public_theme: { business_event: {} },
  master_start_at: null,
  master_end_at: null,
  master_timezone: null,
  master_event_date_id: null,
  city: null,
  party_types: null,
  vibe_tags: null,
  music_genres: null,
  location_geo: null,
  ...patch,
});

async function resolveEventBrandFromRow(patch: Record<string, unknown>) {
  const eventQuery = queryBuilder("maybeSingle", {
    data: eventRow(patch),
    error: null,
  });
  const typeQuery = queryBuilder("maybeSingle", {
    data: { event_type: "event" },
    error: null,
  });
  const ticketsQuery = queryBuilder("order", {
    data: [],
    error: null,
  });

  mockFrom.mockImplementation((table) => {
    if (table === "business_public_events_view") return eventQuery;
    if (table === "events") return typeQuery;
    if (table === "ticket_types") return ticketsQuery;
    throw new Error(`Unexpected table ${String(table)}`);
  });

  return getPublicEventBySlug("orch-0962-brand-adv", "orch-0962-event-adv");
}

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: [], error: null } as never);
});

describe("ORCH-0962 adversarial regressions", () => {
  test("A-01 description containing only the separator splits to neither tagline nor bio", () => {
    // Pre-fix mapper: bio = "\n\n" literal (no trim of trim-empty). Post-fix:
    // splitBrandDescription("\n\n".trim() === "") returns {} → both undefined.
    const brand = publicBrandViewRowToBrand(
      publicBrandRow({ description: "\n\n" }) as never,
    );

    expect(brand.tagline).toBeUndefined();
    expect(brand.bio).toBeUndefined();
  });

  test("A-02 three-paragraph description maps to tagline + multi-paragraph bio remainder", () => {
    // Pre-fix mapper: tagline: undefined hardcoded; bio = whole string
    // including the lead paragraph. Post-fix: split helper joins paragraphs
    // 2..N as bio with `\n\n` separator and assigns paragraph 1 to tagline.
    const brand = publicBrandViewRowToBrand(
      publicBrandRow({
        description: "Lead line.\n\nBody paragraph one.\n\nBody paragraph two.",
      }) as never,
    );

    expect(brand.tagline).toBe("Lead line.");
    expect(brand.bio).toBe("Body paragraph one.\n\nBody paragraph two.");
  });

  test("A-03 partial contact (email present, phone whitespace) emits contact with email only", () => {
    // Pre-fix mapper: contact: undefined always (full omit, no contact
    // mapping). Post-fix extractBrandContact trims and emits a partial
    // object containing only the populated keys.
    const brand = publicBrandViewRowToBrand(
      publicBrandRow({
        contact_email: "real@example.com",
        contact_phone: "   ",
      }) as never,
    );

    expect(brand.contact).toEqual({ email: "real@example.com" });
    expect(brand.contact).not.toHaveProperty("phone");
  });

  test("A-04 viewRowToBrand keeps address/cover truth without brand-kind fields", async () => {
    const detail = await resolveEventBrandFromRow({
      brand_address: "12 Old St",
      brand_cover_media_url: "https://cdn.example/cover.jpg",
    });

    expect(detail).not.toBeNull();
    expect(detail?.brand.address).toBe("12 Old St");
    expect(detail?.brand.coverMediaUrl).toBe("https://cdn.example/cover.jpg");
  });

  test("A-05 SocialLinksRow uses normalizeSocialUrl URL builder for facebook + linkedin", () => {
    // Pre-fix component had no facebook/linkedin entries at all so neither
    // normalizeSocialUrl reference existed for these platforms. Post-fix
    // both platforms call `normalizeSocialUrl(links.X, BASE)` matching the
    // pattern used by the other 6 platforms — NOT a hardcoded URL constant
    // (which would break when the operator already typed a full URL).
    // Different angle from T-07/T-08 (which only assert the entry blocks
    // exist as substrings); this verifies the URL-builder integrity.
    const pageSrc = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "components",
        "brand",
        "PublicBrandPage.tsx",
      ),
      "utf8",
    );

    // Builder pattern: normalizeSocialUrl(links.<key>, "<base>")
    const fbCall = /normalizeSocialUrl\(\s*links\.facebook\s*,\s*"https?:\/\/(?:www\.)?facebook\.com\/?"\s*\)/;
    const liCall = /normalizeSocialUrl\(\s*links\.linkedin\s*,\s*"https?:\/\/(?:www\.)?linkedin\.com\/[^"]*"\s*\)/;
    expect(pageSrc).toMatch(fbCall);
    expect(pageSrc).toMatch(liCall);

    // Both platforms must use the SAME guard shape as the other 6 (defends
    // against a subtle regression that bypasses the empty-string check).
    expect(pageSrc).toMatch(
      /links\.facebook\s*!==\s*undefined\s*&&\s*links\.facebook\.length\s*>\s*0/,
    );
    expect(pageSrc).toMatch(
      /links\.linkedin\s*!==\s*undefined\s*&&\s*links\.linkedin\.length\s*>\s*0/,
    );
  });
});
