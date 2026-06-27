// META-ORCH-1232 — TESTER adversarial regression (mingla-tester).
//
// Angle ATTACKED (intentionally DIFFERENT from the implementor's happy-path unit
// tests, which verified the resolver, the validator, and the service guard each
// in isolation): this asserts the C1 corruption-prevention as a COMPOSED SYSTEM
// INVARIANT across the real failing chain —
//
//     resolveCurrentBrandId(zero-brand cache w/ a `_temp_` row)
//        -> its returned brandId
//           -> fed straight into setCreatorDefaultBrand (the actual 22P02 sink)
//
// The original bug was NOT any single function — it was the COMPOSITION: the
// resolver handed a `_temp_` id downstream and the service issued the UPDATE. A
// future refactor could keep every unit test green (e.g. the resolver still
// "rejects temp ids" in isolation) yet reintroduce the leak by changing what the
// resolver returns for the zero-brand case, or by loosening the validator so a
// crafted non-uuid slips through. This test pins the END-TO-END property and adds
// adversarial id shapes the unit tests do not cover (whitespace-padded uuid,
// `_temp_` as a non-prefix substring, uppercase `_TEMP_`, uuid-ish-but-wrong).
//
// Fails-on-revert: revert ANY of the three C1 guards (resolver newest-brand
// filter, the validator, or the service pre-check) and this goes red.
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import { resolveCurrentBrandId } from "../currentBrandResolver";
import { isPersistedBrandId, InvalidBrandIdError } from "../brandId";

// Mock supabase so we can ASSERT the DB UPDATE is never issued for a poisoned id.
jest.mock("../../services/supabase", () => ({
  supabase: { from: jest.fn() },
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { setCreatorDefaultBrand } from "../../services/creatorAccount";
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { supabase } from "../../services/supabase";

const fromMock = supabase.from as jest.Mock;

const REAL_UUID = "655ba0ef-537f-4720-bff6-805b39d9d9d2"; // shape of a real prod brand id
const TEMP_ID = "_temp_mqvjiyi1"; // shape minted by useCreateBrand.onMutate

const okUpdateBuilder = () => {
  const b: Record<string, unknown> = {};
  b.update = jest.fn(() => b);
  b.eq = jest.fn(() => b);
  b.select = jest.fn(() => b);
  b.maybeSingle = jest.fn(() =>
    Promise.resolve({ data: { id: "account-1" }, error: null }),
  );
  return b;
};

beforeEach(() => {
  fromMock.mockReset();
});

describe("META-ORCH-1232 adversarial — composed C1 guard chain (tester)", () => {
  test("THE EXACT BUG: zero-brand cache holding only a `_temp_` row resolves to null, and that null never issues a default-brand UPDATE", async () => {
    // This is Seth's exact failure state: default_brand_id NULL, no real brand,
    // but useCreateBrand.onMutate has prepended an optimistic `_temp_` row into
    // the same list cache useCurrentBrandRecovery reads.
    const resolution = resolveCurrentBrandId({
      currentBrandId: null,
      defaultBrandId: null,
      brands: [{ id: TEMP_ID }], // ONLY the optimistic row
    });

    // Resolver MUST NOT hand the temp id downstream — it returns a null clear,
    // never the literal `_temp_…` string (which is what poisoned the pointer).
    expect(resolution.brandId).toBeNull();
    expect(resolution.reason).toBe("none");

    // Feeding the resolver's output to the real DB sink: a null is a legitimate
    // clear (it issues an UPDATE setting default_brand_id = null — that is NOT
    // the corruption; the corruption was writing the literal `_temp_…` string).
    const builder = okUpdateBuilder();
    fromMock.mockReturnValue(builder);
    await expect(
      setCreatorDefaultBrand("account-1", resolution.brandId),
    ).resolves.toBeUndefined();
    // And critically: the value written is null, NEVER a `_temp_` string.
    expect(builder.update).toHaveBeenCalledWith({ default_brand_id: null });
  });

  test("if a `_temp_` id somehow reaches the service directly, NO Supabase UPDATE is issued (suspenders guard holds independently of the resolver)", async () => {
    // Simulates a future refactor that bypasses the resolver guard — the service
    // pre-check must still fail-closed so 22P02 can never escape.
    await expect(
      setCreatorDefaultBrand("account-1", TEMP_ID),
    ).rejects.toBeInstanceOf(InvalidBrandIdError);
    expect(fromMock).not.toHaveBeenCalled();
  });

  test.each([
    [" 655ba0ef-537f-4720-bff6-805b39d9d9d2", "leading-whitespace uuid"],
    ["655ba0ef-537f-4720-bff6-805b39d9d9d2 ", "trailing-whitespace uuid"],
    ["x_temp_655ba0ef", "_temp_ as a non-prefix substring"],
    ["_TEMP_MQVJIYI1", "uppercase _TEMP_ (must still be non-uuid → rejected)"],
    ["655ba0ef-537f-4720-bff6-805b39d9d9d2-extra", "uuid with trailing garbage"],
    ["655ba0ef537f4720bff6805b39d9d9d2", "uuid without hyphens"],
    ["gggggggg-gggg-4ggg-8ggg-gggggggggggg", "uuid shape, non-hex chars"],
  ])(
    "adversarial non-persistable id %j (%s) is rejected by the validator AND issues no UPDATE",
    async (badId) => {
      expect(isPersistedBrandId(badId)).toBe(false);
      await expect(
        setCreatorDefaultBrand("account-1", badId as string),
      ).rejects.toBeInstanceOf(InvalidBrandIdError);
      expect(fromMock).not.toHaveBeenCalled();
    },
  );

  test("a genuinely persisted UUID flows ALL THE WAY THROUGH: resolver keeps it AND the service issues the UPDATE (guards do not over-block real ids)", async () => {
    const resolution = resolveCurrentBrandId({
      currentBrandId: REAL_UUID,
      defaultBrandId: null,
      brands: [{ id: REAL_UUID }, { id: TEMP_ID }], // real + an optimistic row
    });
    expect(resolution.brandId).toBe(REAL_UUID);
    expect(resolution.reason).toBe("keep-local");

    const builder = okUpdateBuilder();
    fromMock.mockReturnValue(builder);
    await expect(
      setCreatorDefaultBrand("account-1", resolution.brandId),
    ).resolves.toBeUndefined();
    expect(builder.update).toHaveBeenCalledWith({ default_brand_id: REAL_UUID });
  });
});
