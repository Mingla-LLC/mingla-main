jest.mock("../../supabase", () => ({
  supabase: { rpc: jest.fn() },
}));

import { supabase } from "../../supabase";
import {
  createManualGroup,
  deleteManualGroup,
  listManualGroups,
  manualGroupDraftNameError,
  ManualGroupError,
  resultingManualMemberCount,
  stableManualMutationRequest,
} from "../manualGroupService";

const rpc = supabase.rpc as jest.Mock;

describe("#2395 Manual group service happy path", () => {
  beforeEach(() => rpc.mockReset());

  test("strictly decodes organizational counts without contact data", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        groups: [{
          groupId: "11111111-1111-4111-8111-111111111111",
          name: "VIP regulars",
          kind: "manual",
          memberCount: 12,
          pendingReviewCount: 2,
          membershipVersion: 4,
          lastUsedAt: null,
          createdAt: "2026-08-21T00:00:00.000Z",
          updatedAt: "2026-08-21T00:00:00.000Z",
        }],
      },
      error: null,
    });
    await expect(listManualGroups("22222222-2222-4222-8222-222222222222"))
      .resolves.toEqual([expect.objectContaining({ name: "VIP regulars", memberCount: 12, pendingReviewCount: 2 })]);
    expect(rpc).toHaveBeenCalledWith("biz_list_people_manual_groups_v1", {
      p_brand_id: "22222222-2222-4222-8222-222222222222",
    });
  });

  test("create sends only opaque canonical IDs, batch IDs and a request ID", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        group: { groupId: "11111111-1111-4111-8111-111111111111", name: "Press", kind: "manual", memberCount: 1, pendingReviewCount: 0, membershipVersion: 1, lastUsedAt: null, createdAt: "2026-08-21T00:00:00.000Z", updatedAt: "2026-08-21T00:00:00.000Z" },
        addedCount: 1, alreadyMemberCount: 0, pendingReviewCount: 0, rejectedCount: 0, suppressedMemberCount: 0,
      }, error: null,
    });
    await createManualGroup({ brandId: "brand", name: "Press", personIds: ["person"], importBatchIds: ["batch"], clientRequestId: "request" });
    expect(rpc).toHaveBeenCalledWith("biz_create_manual_group_v1", {
      p_brand_id: "brand", p_name: "Press", p_person_ids: ["person"],
      p_import_batch_ids: ["batch"], p_client_request_id: "request",
    });
  });

  test("typed server failures preserve the safe code and retry posture", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "manual_group_name_conflict" } });
    await expect(createManualGroup({ brandId: "brand", name: "Press", personIds: [], importBatchIds: [], clientRequestId: "request" }))
      .rejects.toEqual(expect.objectContaining<Partial<ManualGroupError>>({ code: "manual_group_name_conflict", retryable: true }));
  });

  test("an unchanged mutation intent reuses its request ID and material changes rotate it", () => {
    const ids = ["request-1", "request-2"];
    const createId = jest.fn(() => ids.shift() as string);
    const first = stableManualMutationRequest(null, "same-input", createId);
    const retry = stableManualMutationRequest(first, "same-input", createId);
    const changed = stableManualMutationRequest(retry, "changed-input", createId);
    expect(retry).toBe(first);
    expect(changed.id).toBe("request-2");
    expect(createId).toHaveBeenCalledTimes(2);
  });

  test("name and review helpers reject an existing normalized name and dedupe canonical people", () => {
    expect(manualGroupDraftNameError("  VIP   Regulars ", ["VIP regulars"])).toBe("A Manual group already uses this name.");
    expect(resultingManualMemberCount(["one", "two"], ["two", "three"], ["three", "four", "four"])).toBe(4);
  });

  test("delete-block is a typed persistent result with the exact campaign count", async () => {
    rpc.mockResolvedValueOnce({ data: { code: "manual_group_delete_blocked", blockingCampaignCount: 2 }, error: null });
    await expect(deleteManualGroup({ brandId: "brand", groupId: "group", clientRequestId: "request" }))
      .resolves.toEqual({ code: "manual_group_delete_blocked", blockingCampaignCount: 2 });
  });
});
