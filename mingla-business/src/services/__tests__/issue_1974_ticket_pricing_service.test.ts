import { describe, expect, jest, test, beforeEach } from "@jest/globals";

const rpcMock = jest.fn<
  (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: null }>
>();

jest.mock("../supabase", () => ({
  supabase: { rpc: rpcMock },
}));

import {
  setBrandPricingDefaults,
  setEventPricingSwitches,
} from "../pricingSwitchesService";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("#1974 shared Business pricing services", () => {
  test("event pricing patch preserves omitted keys and can write inherit", async () => {
    rpcMock.mockResolvedValue({
      data: {
        updated_at: "2027-01-01T00:01:00.000Z",
        overrides: { pass_tax: null, pass_mingla_fee: false, pass_service_fee: true },
        resolved: { pass_tax: true, pass_mingla_fee: false, pass_service_fee: true },
      },
      error: null,
    });
    const result = await setEventPricingSwitches("event-1", { passTax: null });
    expect(rpcMock).toHaveBeenCalledWith("business_patch_pricing_switches", {
      p_event_id: "event-1",
      p_patch: { pass_tax: null },
    });
    expect(result.overrides.passTax).toBeNull();
    expect(result.updatedAt).toBe("2027-01-01T00:01:00.000Z");
  });

  test("brand default patch is sparse and returns concrete readback", async () => {
    rpcMock.mockResolvedValue({
      data: { defaults: { pass_tax: true, pass_mingla_fee: false, pass_service_fee: true } },
      error: null,
    });
    const result = await setBrandPricingDefaults("brand-1", { passTax: true });
    expect(rpcMock).toHaveBeenCalledWith("business_patch_brand_pricing_defaults", {
      p_brand_id: "brand-1",
      p_patch: { default_pass_tax: true },
    });
    expect(result).toEqual({ passTax: true, passMinglaFee: false, passServiceFee: true });
  });
});
