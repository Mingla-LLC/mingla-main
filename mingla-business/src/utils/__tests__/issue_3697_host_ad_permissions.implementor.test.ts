import {
  canHostAdAction,
  canHostAdTopUp,
  canHostAdWithdraw,
  type HostAdAction,
} from "../hostAdPermission";

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
    // #4238 ads roles (20281118014238), updated on purpose: a brand admin now
    // funds, launches and pauses; end stays owner-only.
    expect(granted("brand_admin")).toEqual([
      "read",
      "plan",
      "fund",
      "launch",
      "pause",
    ]);
    expect(granted("brand_admin", { ads_end: true })).not.toContain("end");
    expect(granted("finance_manager", { ads_end: true })).not.toContain("end");
  });

  it("#4238 ads roles: top up is owner, admin and Finance; withdraw is owner and Finance", () => {
    const who = (role: Parameters<typeof canHostAdTopUp>[0]["role"], accepted = true) => ({
      topUp: canHostAdTopUp({ role, accepted }),
      withdraw: canHostAdWithdraw({ role, accepted }),
    });
    expect(who("brand_owner")).toEqual({ topUp: true, withdraw: true });
    expect(who("brand_admin")).toEqual({ topUp: true, withdraw: false });
    expect(who("finance_manager")).toEqual({ topUp: true, withdraw: true });
    expect(who("marketing_manager")).toEqual({ topUp: false, withdraw: false });
    expect(who("event_manager")).toEqual({ topUp: false, withdraw: false });
    expect(who("finance_manager", false)).toEqual({ topUp: false, withdraw: false });
    expect(who("brand_admin", false)).toEqual({ topUp: false, withdraw: false });
    expect(who(null)).toEqual({ topUp: false, withdraw: false });
  });
});
