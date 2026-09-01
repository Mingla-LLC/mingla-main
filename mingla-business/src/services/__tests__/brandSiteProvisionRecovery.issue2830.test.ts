import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  loadProvisionOperation,
  resolveProvisionOperation,
} from "../brandSitesService";

const OPERATION_ID = "00000000-0000-4000-8000-000000000003";
const provisioningSite = {
  id: "00000000-0000-4000-8000-000000000001",
  brand_id: "00000000-0000-4000-8000-000000000002",
  renderer_key: "restaurant-website-v1" as const,
  renderer_version: 1,
  status: "provisioning" as const,
  active_publication_id: null,
  last_successful_publication_id: null,
  provisioning_error_code: null,
  created_at: "2026-08-30T12:00:00Z",
  updated_at: "2026-08-30T12:00:00Z",
  brand_site_hosts: [],
  latest_provision_operation: {
    operation_id: OPERATION_ID,
    status: "executing" as const,
    error_code: null,
    authorized_at: "2026-08-30T12:00:00Z",
    updated_at: "2026-08-30T12:00:01Z",
    result_summary: null,
  },
};

describe("#2830 authoritative provisioning recovery", () => {
  afterEach(() => jest.restoreAllMocks());

  it("recovers the Core receipt when the local cache is empty", () => {
    expect(resolveProvisionOperation(null, provisioningSite)).toEqual({
      operationId: OPERATION_ID,
      startedAt: Date.parse("2026-08-30T12:00:00Z"),
    });
  });

  it("recovers the Core receipt when local storage is blocked", async () => {
    jest.spyOn(AsyncStorage, "getItem").mockRejectedValue(new Error("blocked"));
    const cached = await loadProvisionOperation(provisioningSite.brand_id);
    expect(cached).toBeNull();
    expect(resolveProvisionOperation(cached, provisioningSite)?.operationId)
      .toBe(OPERATION_ID);
  });
});
