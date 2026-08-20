import { describe, expect, jest, test, beforeEach } from "@jest/globals";

const rpcMock = jest.fn<
  (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: null }>
>();
const invokeMock = jest.fn<
  (
    name: string,
    options: { body: { brand_id: string } },
  ) => Promise<{ data: { hasActiveRegistration: boolean }; error: null }>
>();
const maybeSingleMock = jest.fn<
  () => Promise<{ data: { brand_id: string }; error: null }>
>();
const inMock = jest.fn(() => ({ maybeSingle: maybeSingleMock }));
const eqMock = jest.fn(() => ({ in: inMock }));
const selectMock = jest.fn(() => ({ eq: eqMock }));
const fromMock = jest.fn(() => ({ select: selectMock }));

jest.mock("../supabase", () => ({
  supabase: {
    rpc: rpcMock,
    functions: { invoke: invokeMock },
    from: fromMock,
  },
}));

import {
  setBrandPricingDefaults,
  setEventPricingSwitches,
} from "../pricingSwitchesService";

beforeEach(() => {
  rpcMock.mockReset();
  invokeMock.mockReset();
  maybeSingleMock.mockReset();
  inMock.mockClear();
  eqMock.mockClear();
  selectMock.mockClear();
  fromMock.mockClear();
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
    invokeMock.mockResolvedValue({ data: { hasActiveRegistration: true }, error: null });
    rpcMock.mockResolvedValue({
      data: { defaults: { pass_tax: true, pass_mingla_fee: false, pass_service_fee: true } },
      error: null,
    });
    const result = await setBrandPricingDefaults("brand-1", { passTax: true });
    expect(rpcMock).toHaveBeenCalledWith("business_patch_brand_pricing_defaults", {
      p_brand_id: "brand-1",
      p_patch: { default_pass_tax: true },
    });
    expect(invokeMock).toHaveBeenCalledWith("brand-tax-registrations-list", {
      body: { brand_id: "brand-1" },
    });
    expect(result).toEqual({ passTax: true, passMinglaFee: false, passServiceFee: true });
  });

  test("tax pass-through refreshes authoritative registration before the event command", async () => {
    maybeSingleMock.mockResolvedValue({ data: { brand_id: "brand-1" }, error: null });
    invokeMock.mockResolvedValue({ data: { hasActiveRegistration: true }, error: null });
    rpcMock.mockResolvedValue({
      data: {
        updated_at: "2027-01-01T00:01:00.000Z",
        overrides: { pass_tax: true, pass_mingla_fee: null, pass_service_fee: null },
        resolved: { pass_tax: true, pass_mingla_fee: false, pass_service_fee: false },
      },
      error: null,
    });

    await setEventPricingSwitches("event-1", { passTax: true });

    expect(fromMock).toHaveBeenCalledWith("events");
    expect(inMock).toHaveBeenCalledWith("event_type", ["event", "experience"]);
    expect(invokeMock).toHaveBeenCalledWith("brand-tax-registrations-list", {
      body: { brand_id: "brand-1" },
    });
    expect(rpcMock).toHaveBeenCalledWith("business_patch_pricing_switches", {
      p_event_id: "event-1",
      p_patch: { pass_tax: true },
    });
  });

  test("tax pass-through fails closed when the provider attestation cannot be refreshed", async () => {
    invokeMock.mockResolvedValue({ data: { hasActiveRegistration: false }, error: null });
    await expect(setBrandPricingDefaults("brand-1", { passTax: true })).rejects.toThrow(
      "tax_registration_required",
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
