// META-ORCH-1232 (C1) — the shared persisted-brand-id validator. A brand id is
// selectable / writable to a uuid column ONLY if it is a real UUID; any
// `_temp_…` optimistic id (or non-uuid) is rejected at this single chokepoint.
import { describe, expect, test } from "@jest/globals";

import {
  isPersistedBrandId,
  InvalidBrandIdError,
  TEMP_BRAND_ID_PREFIX,
} from "../brandId";

describe("isPersistedBrandId (META-ORCH-1232 C1)", () => {
  test("accepts a real RFC-4122 UUID", () => {
    expect(isPersistedBrandId("11111111-1111-4111-8111-111111111111")).toBe(true);
    // Upper-case + non-v4 variant still a valid uuid shape (uuid column accepts it).
    expect(isPersistedBrandId("ABCDEF01-2345-1678-9ABC-DEF012345678")).toBe(true);
  });

  test("rejects the optimistic `_temp_` id (the logged 22P02 source)", () => {
    expect(isPersistedBrandId("_temp_mqvjiyi1")).toBe(false);
    expect(isPersistedBrandId(`${TEMP_BRAND_ID_PREFIX}abc123`)).toBe(false);
  });

  test("rejects null / undefined / empty / arbitrary non-uuid strings", () => {
    expect(isPersistedBrandId(null)).toBe(false);
    expect(isPersistedBrandId(undefined)).toBe(false);
    expect(isPersistedBrandId("")).toBe(false);
    expect(isPersistedBrandId("brand-a")).toBe(false);
    expect(isPersistedBrandId("not-a-uuid")).toBe(false);
  });

  test("InvalidBrandIdError is a typed, named error carrying the bad id", () => {
    const err = new InvalidBrandIdError("_temp_x");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("InvalidBrandIdError");
    expect(err.message).toContain("_temp_x");
  });
});
