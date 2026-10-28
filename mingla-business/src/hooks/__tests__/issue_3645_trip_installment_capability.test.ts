type RpcResult = { data: unknown; error: { message: string } | null };
const mockRpc = jest.fn<Promise<RpcResult>, [string, Record<string, unknown>]>()
  .mockResolvedValue({ data: true, error: null });

jest.mock("../../services/supabase", () => ({
  supabase: { rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args) },
}));

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true }),
}));

jest.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => options,
}));

import { useTripInstallmentCapability } from "../useTripInstallmentCapability";
import { fetchTripInstallmentCapability } from "../../services/tripInstallmentCapabilityService";

describe("#3645 server-authoritative installment capability", () => {
  beforeEach(() => mockRpc.mockReset());

  it("accepts only explicit true from the canonical RPC", async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(fetchTripInstallmentCapability("brand-3645")).resolves.toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      "biz_trip_installments_supported_for_brand",
      { p_brand_id: "brand-3645" },
    );
    mockRpc.mockResolvedValueOnce({ data: "true", error: null });
    await expect(fetchTripInstallmentCapability("brand-3645")).resolves.toBe(false);
  });

  it("authoring fails closed when the RPC errors", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "rolling deploy" } });
    const options = useTripInstallmentCapability("brand-3645") as unknown as {
      queryFn: () => Promise<boolean>;
      enabled: boolean;
    };
    expect(options.enabled).toBe(true);
    await expect(options.queryFn()).resolves.toBe(false);
  });
});
