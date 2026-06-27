// META-ORCH-1232 (C1) — setCreatorDefaultBrand rejects a non-persisted (non-uuid)
// brand id BEFORE issuing the UPDATE so a `_temp_…` id can never reach the
// `creator_accounts.default_brand_id` uuid column (Postgres 22P02).
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import { setCreatorDefaultBrand } from "../creatorAccount";
import { InvalidBrandIdError } from "../../utils/brandId";
import { supabase } from "../supabase";

jest.mock("../supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

const fromMock = supabase.from as jest.Mock;

const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// .update().eq().select().maybeSingle() chain that resolves to a written row.
const updateBuilder = () => {
  const builder: Record<string, unknown> = {};
  builder.update = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.select = jest.fn(() => builder);
  builder.maybeSingle = jest.fn(() =>
    Promise.resolve({ data: { id: "account-1" }, error: null }),
  );
  return builder;
};

beforeEach(() => {
  fromMock.mockReset();
});

describe("setCreatorDefaultBrand — META-ORCH-1232 C1", () => {
  test("throws InvalidBrandIdError and issues NO update for a `_temp_` id", async () => {
    await expect(
      setCreatorDefaultBrand("account-1", "_temp_mqvjiyi1"),
    ).rejects.toBeInstanceOf(InvalidBrandIdError);
    expect(fromMock).not.toHaveBeenCalled();
  });

  test("throws InvalidBrandIdError for any non-uuid id (no update)", async () => {
    await expect(
      setCreatorDefaultBrand("account-1", "brand-a"),
    ).rejects.toBeInstanceOf(InvalidBrandIdError);
    expect(fromMock).not.toHaveBeenCalled();
  });

  test("allows a null clear (legitimate)", async () => {
    const builder = updateBuilder();
    fromMock.mockReturnValue(builder);
    await expect(setCreatorDefaultBrand("account-1", null)).resolves.toBeUndefined();
    expect(fromMock).toHaveBeenCalledWith("creator_accounts");
    expect(builder.update).toHaveBeenCalledWith({ default_brand_id: null });
  });

  test("proceeds for a real persisted UUID", async () => {
    const builder = updateBuilder();
    fromMock.mockReturnValue(builder);
    await expect(setCreatorDefaultBrand("account-1", UUID)).resolves.toBeUndefined();
    expect(builder.update).toHaveBeenCalledWith({ default_brand_id: UUID });
  });
});
