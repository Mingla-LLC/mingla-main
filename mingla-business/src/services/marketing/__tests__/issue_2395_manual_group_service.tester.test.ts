jest.mock("../../supabase", () => ({
  supabase: { rpc: jest.fn() },
}));

import { supabase } from "../../supabase";
import {
  removeManualGroupPeople,
  renameManualGroup,
} from "../manualGroupService";

const rpc = supabase.rpc as jest.Mock;

describe("#2395 tester adversarial service decoding", () => {
  beforeEach(() => rpc.mockReset());

  test.each([
    ["remove", () => removeManualGroupPeople({
      brandId: "brand",
      groupId: "group",
      personIds: ["person"],
      clientRequestId: "request",
    })],
    ["rename", () => renameManualGroup({
      brandId: "brand",
      groupId: "group",
      name: "VIP",
      clientRequestId: "request",
    })],
  ])("%s rejects a malformed success payload instead of showing false success", async (_label, call) => {
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    await expect(call()).rejects.toEqual(expect.objectContaining({
      code: "manual_group_invalid_response",
    }));
  });
});
