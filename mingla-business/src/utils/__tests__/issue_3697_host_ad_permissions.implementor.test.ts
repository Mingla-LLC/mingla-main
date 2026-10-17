import { canHostAdAction, type HostAdAction } from "../hostAdPermission";

const actions: HostAdAction[] = [
  "read",
  "plan",
  "fund",
  "launch",
  "pause",
  "end",
];

function granted(
  role: Parameters<typeof canHostAdAction>[0]["role"],
  permissionsOverride: Record<string, unknown> = {},
  accepted = true,
): HostAdAction[] {
  return actions.filter((action) =>
    canHostAdAction({ role, accepted, permissionsOverride }, action)
  );
}

describe("issue #3697 Host Ads action authority", () => {
  it("gives the owner every action", () => {
    expect(granted("brand_owner")).toEqual(actions);
  });

  it("keeps marketing planning separate from spend authority", () => {
    expect(granted("marketing_manager")).toEqual(["read", "plan"]);
    expect(granted("marketing_manager", { ads_spend: true })).toEqual([
      "read",
      "plan",
      "fund",
      "launch",
      "pause",
    ]);
  });

  it("lets finance fund without granting campaign control", () => {
    expect(granted("finance_manager")).toEqual(["read", "fund"]);
  });

  it("requires explicit overrides and an accepted membership", () => {
    expect(granted("event_manager", { ads_view: true })).toEqual(["read"]);
    expect(granted("event_manager", { ads_launch: true })).toEqual(["launch"]);
    expect(granted("event_manager", { ads_launch: "true" })).toEqual([]);
    expect(granted("marketing_manager", { ads_spend: true }, false)).toEqual(
      [],
    );
  });

  it("keeps direct end owner-only", () => {
    expect(granted("brand_admin")).toEqual(["read", "plan"]);
    expect(granted("finance_manager", { ads_end: true })).not.toContain("end");
  });
});
