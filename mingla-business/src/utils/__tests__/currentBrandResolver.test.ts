// [TEST-MOD-APPROVED META-ORCH-1232] — resolveCurrentBrandId now requires
// PERSISTED (uuid) brand ids (C1). The prior fixtures used non-uuid ids
// ("brand-a"/"brand-b") which are no longer selectable; updated to real UUIDs so
// the existing selection semantics still hold, and added the C1 temp-id case.
import { describe, expect, test } from "@jest/globals";

import { resolveCurrentBrandId } from "../currentBrandResolver";

const brand = (id: string): { id: string } => ({ id });

// Real RFC-4122 UUIDs (the resolver only selects persisted = uuid ids now).
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_Z = "99999999-9999-4999-8999-999999999999";

describe("resolveCurrentBrandId", () => {
  test("keeps a valid local selection before server default", () => {
    expect(
      resolveCurrentBrandId({
        currentBrandId: UUID_B,
        defaultBrandId: UUID_A,
        brands: [brand(UUID_B), brand(UUID_A)],
      }),
    ).toEqual({ brandId: UUID_B, reason: "keep-local" });
  });

  test("uses a valid server default when local selection is empty", () => {
    expect(
      resolveCurrentBrandId({
        currentBrandId: null,
        defaultBrandId: UUID_A,
        brands: [brand(UUID_B), brand(UUID_A)],
      }),
    ).toEqual({ brandId: UUID_A, reason: "server-default" });
  });

  test("falls back to newest fetched brand when server default is invalid", () => {
    expect(
      resolveCurrentBrandId({
        currentBrandId: null,
        defaultBrandId: UUID_Z,
        brands: [brand(UUID_B), brand(UUID_A)],
      }),
    ).toEqual({ brandId: UUID_B, reason: "newest-brand" });
  });

  test("falls back to newest fetched brand when no default exists", () => {
    expect(
      resolveCurrentBrandId({
        currentBrandId: null,
        defaultBrandId: null,
        brands: [brand(UUID_B), brand(UUID_A)],
      }),
    ).toEqual({ brandId: UUID_B, reason: "newest-brand" });
  });

  test("returns none when no brands exist", () => {
    expect(
      resolveCurrentBrandId({
        currentBrandId: null,
        defaultBrandId: null,
        brands: [],
      }),
    ).toEqual({ brandId: null, reason: "none" });
  });

  test("uses a valid default when local selection is invalid", () => {
    expect(
      resolveCurrentBrandId({
        currentBrandId: UUID_Z,
        defaultBrandId: UUID_A,
        brands: [brand(UUID_B), brand(UUID_A)],
      }),
    ).toEqual({ brandId: UUID_A, reason: "server-default" });
  });

  // META-ORCH-1232 (C1) — an optimistic `_temp_…` brands[0] is NOT selectable.
  // A zero-persisted-brand account mid-create must resolve to `reason:"none"`,
  // never the temp id (which would poison the pointer / default_brand_id column).
  test("C1: a `_temp_` brands[0] is ineligible → reason:none (zero-brand account)", () => {
    expect(
      resolveCurrentBrandId({
        currentBrandId: null,
        defaultBrandId: null,
        brands: [brand("_temp_mqvjiyi1")],
      }),
    ).toEqual({ brandId: null, reason: "none" });
  });

  // META-ORCH-1232 (C1) — when a `_temp_` row sits ahead of a persisted brand,
  // the resolver skips the temp row and selects the newest PERSISTED brand.
  test("C1: skips a leading `_temp_` row and selects the newest persisted brand", () => {
    expect(
      resolveCurrentBrandId({
        currentBrandId: null,
        defaultBrandId: null,
        brands: [brand("_temp_abc123"), brand(UUID_B), brand(UUID_A)],
      }),
    ).toEqual({ brandId: UUID_B, reason: "newest-brand" });
  });

  // META-ORCH-1232 (C1) — a `_temp_` value can never be honored as currentBrandId
  // even if it is (transiently) present in the list cache.
  test("C1: a `_temp_` currentBrandId is not kept-local", () => {
    expect(
      resolveCurrentBrandId({
        currentBrandId: "_temp_abc123",
        defaultBrandId: UUID_A,
        brands: [brand("_temp_abc123"), brand(UUID_A)],
      }),
    ).toEqual({ brandId: UUID_A, reason: "server-default" });
  });
});
