/**
 * #3682 wave 2 (A) — a follower who is not in Your Book is an account-only
 * invite recipient. The server keeps `selectedCount` Book-only (older Host
 * clients parse it strictly) and adds `accountRecipientCount`; the client plan
 * total must include both, or every wizard shows "Skip invites" for a
 * followers-only plan and publishes it unconfirmed (nothing sends).
 */
const rpc = jest.fn();
jest.mock("../supabase", () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));
jest.mock("../../diagnostics/reportNonFatal", () => ({ reportNonFatal: jest.fn() }));
jest.mock("../marketing/manualGroupService", () => ({ listManualGroups: jest.fn() }));
jest.mock("../peopleService", () => ({ listBrandPeople: jest.fn() }));

import { getWizardInvitePlan, WizardInvitePlanError } from "../offeringInvitePlanService";

const base = {
  eventId: "36829300-0000-4000-8000-000000000001",
  eventType: "event",
  selectionRevision: 3,
  selectedCount: 1,
  brandPersonIds: ["36829300-0000-4000-8000-000000000002"],
  selectionHash: "c".repeat(64),
  state: "draft",
  publishedSelectionRevision: null,
  updatedAt: null,
};

describe("#3682 wave 2 — wizard plan totals include account-only followers", () => {
  beforeEach(() => rpc.mockReset());

  it("adds account recipients to the plan total and keeps the Book count", async () => {
    rpc.mockResolvedValue({ data: { ...base, accountRecipientCount: 4 }, error: null });
    const plan = await getWizardInvitePlan(base.eventId);
    expect(plan.selectedCount).toBe(5);
    expect(plan.bookSelectedCount).toBe(1);
    expect(plan.accountRecipientCount).toBe(4);
    expect(plan.brandPersonIds).toEqual(base.brandPersonIds);
  });

  it("a followers-only plan is not empty", async () => {
    rpc.mockResolvedValue({
      data: { ...base, selectedCount: 0, brandPersonIds: [], accountRecipientCount: 2 },
      error: null,
    });
    const plan = await getWizardInvitePlan(base.eventId);
    expect(plan.selectedCount).toBe(2);
    expect(plan.bookSelectedCount).toBe(0);
  });

  it("replays a receipt written before the field existed", async () => {
    rpc.mockResolvedValue({ data: { ...base }, error: null });
    const plan = await getWizardInvitePlan(base.eventId);
    expect(plan.selectedCount).toBe(1);
    expect(plan.accountRecipientCount).toBe(0);
  });

  it("rejects a total over the 500 cap or a malformed count", async () => {
    rpc.mockResolvedValue({ data: { ...base, accountRecipientCount: 500 }, error: null });
    await expect(getWizardInvitePlan(base.eventId)).rejects.toBeInstanceOf(WizardInvitePlanError);
    rpc.mockResolvedValue({ data: { ...base, accountRecipientCount: -1 }, error: null });
    await expect(getWizardInvitePlan(base.eventId)).rejects.toBeInstanceOf(WizardInvitePlanError);
  });
});
