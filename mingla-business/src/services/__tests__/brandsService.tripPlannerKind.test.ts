/* eslint-disable import/first */
/**
 * ORCH-0855 [Tr1 Trip Planner Brand Onboarding] — service-layer regression test.
 *
 * Asserts createBrand accepts kind='trip_planner' end-to-end at the service boundary:
 *   - CreateBrandInput type admits the new value (compile-time check)
 *   - mapUiToBrandInsert passes kind through to the DB insert payload
 *   - SlugCollisionError still thrown on 23505 (existing contract unchanged)
 *
 * Fails-on-revert: if SPEC §4.3 file-3 (brandsService.ts:86 union widening) is
 * reverted, `kind: "trip_planner"` becomes a TS compile error and the test
 * file fails to type-check — ts-jest reports the compile error and the test
 * suite FAILs to load.
 *
 * Companion adversarial check: scripts/ci/orch-0855-adversarial-check.mjs
 * (tester-written, structural).
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// Loosely-typed mocks — we construct the postgrest builder chain by hand
// and don't care about strict mock arg types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const insertMock = jest.fn() as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const selectMock = jest.fn() as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const singleMock = jest.fn() as any;

jest.mock("../supabase", () => ({
  supabase: {
    from: () => ({
      insert: (payload: unknown) => insertMock(payload),
    }),
  },
}));

// appsFlyerService transitively imports react-native — stub for Node tests.
jest.mock("../appsFlyerService", () => ({
  logAppsFlyerEvent: jest.fn(),
}));

import { createBrand, SlugCollisionError } from "../brandsService";

beforeEach(() => {
  insertMock.mockReset();
  selectMock.mockReset();
  singleMock.mockReset();
  // Default chain: insert → select → single → returns happy row.
  singleMock.mockResolvedValue({
    data: {
      id: "brand-uuid-1",
      account_id: "acc-1",
      name: "Wandering Soul Retreats",
      slug: "wanderingsoul",
      description: null,
      profile_photo_url: null,
      contact_email: null,
      contact_phone: null,
      social_links: {},
      custom_links: [],
      display_attendee_count: true,
      tax_settings: {},
      default_currency: "GBP",
      stripe_connect_id: null,
      stripe_payouts_enabled: false,
      stripe_charges_enabled: false,
      kind: "trip_planner",
      address: null,
      cover_hue: 25,
      cover_media_url: null,
      cover_media_type: null,
      profile_photo_type: null,
      created_at: "2026-05-17T00:00:00.000Z",
      updated_at: "2026-05-17T00:00:00.000Z",
      deleted_at: null,
    },
    error: null,
  });
  selectMock.mockReturnValue({ single: singleMock });
  insertMock.mockReturnValue({ select: selectMock });
});

describe("ORCH-0855 — createBrand admits kind='trip_planner'", () => {
  test("happy path: insert with kind='trip_planner' returns trip-planner Brand", async () => {
    const result = await createBrand(
      {
        accountId: "acc-1",
        name: "Wandering Soul Retreats",
        slug: "wanderingsoul",
        // SPEC §4.3 file-3 — CreateBrandInput.kind union widened.
        kind: "trip_planner",
        address: null,
        coverHue: 25,
        bio: "Small group retreats in Mexico and Costa Rica",
      },
      "owner",
    );

    // Verify the insert payload carried kind='trip_planner' to the DB layer.
    expect(insertMock).toHaveBeenCalledTimes(1);
    const [payload] = insertMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload.kind).toBe("trip_planner");
    expect(payload.account_id).toBe("acc-1");
    expect(payload.name).toBe("Wandering Soul Retreats");

    // Verify the returned Brand carries the new kind through to UI layer.
    expect(result.kind).toBe("trip_planner");
    expect(result.id).toBe("brand-uuid-1");
  });

  test("kind='popup' regression (today's flow unchanged) — SC-06 + SC-16 backward-compat", async () => {
    singleMock.mockResolvedValueOnce({
      data: {
        id: "brand-uuid-2",
        account_id: "acc-1",
        name: "Pop Up Test",
        slug: "popuptest",
        description: null,
        profile_photo_url: null,
        contact_email: null,
        contact_phone: null,
        social_links: {},
        custom_links: [],
        display_attendee_count: true,
        tax_settings: {},
        default_currency: "GBP",
        stripe_connect_id: null,
        stripe_payouts_enabled: false,
        stripe_charges_enabled: false,
        kind: "popup",
        address: null,
        cover_hue: 25,
        cover_media_url: null,
        cover_media_type: null,
        profile_photo_type: null,
        created_at: "2026-05-17T00:00:00.000Z",
        updated_at: "2026-05-17T00:00:00.000Z",
        deleted_at: null,
      },
      error: null,
    });

    const result = await createBrand(
      {
        accountId: "acc-1",
        name: "Pop Up Test",
        slug: "popuptest",
        kind: "popup",
        address: null,
        coverHue: 25,
      },
      "owner",
    );

    const [payload] = insertMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload.kind).toBe("popup");
    expect(result.kind).toBe("popup");
  });

  test("SlugCollisionError still thrown on 23505 (error contract unchanged)", async () => {
    singleMock.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });

    await expect(
      createBrand(
        {
          accountId: "acc-1",
          name: "Duplicate",
          slug: "duplicate",
          kind: "trip_planner",
          address: null,
          coverHue: 25,
        },
        "owner",
      ),
    ).rejects.toBeInstanceOf(SlugCollisionError);
  });
});
