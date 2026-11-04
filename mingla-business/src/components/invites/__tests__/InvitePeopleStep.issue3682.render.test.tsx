import React from "react";

// #3682 closeout — the Friends of followers row in the creation Invite step
// must not be a dead tap while the extended audience is switched off. It is
// greyed out with the same explanation the Blast audience picker shows, from
// the same get_brand_circle_reach availability.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer");
const { act } = TestRenderer;

// #3682 wave 2 — the Followers row reads the real follower count.
jest.mock("../../../hooks/useBrandFollowerCount", () => ({
  useBrandFollowerCount: () => ({ data: 4, isError: false }),
}));
jest.mock("../../../hooks/useOfferingInvitePlan", () => ({
  useOfferingInvitePlan: jest.fn(),
  useOfferingInvitePlanSummary: jest.fn(),
}));
jest.mock("../../../features/invites/wizardInviteAnalytics", () => ({
  captureWizardInvite: jest.fn(),
}));
jest.mock("../../../services/offeringInvitePlanService", () => ({
  WizardInvitePlanError: class WizardInvitePlanError extends Error {},
  createWizardInviteRequestId: () => "00000000-0000-4000-8000-000000000000",
  formatWizardInviteMoney: (minor: number, currency: string) => `${currency} ${minor / 100}`,
}));
jest.mock("../../ui/ConfirmDialog", () => {
  const ReactModule = require("react");
  return { ConfirmDialog: (props: Record<string, unknown>) => ReactModule.createElement("confirm-dialog", props) };
});
jest.mock("../../ui/Button", () => {
  const ReactModule = require("react");
  return { Button: (props: Record<string, unknown>) => ReactModule.createElement("button", props) };
});
jest.mock("../../ui/Sheet", () => {
  const ReactModule = require("react");
  return { Sheet: (props: Record<string, unknown>) => ReactModule.createElement("sheet", props) };
});
jest.mock("../../../wrappers/SmartScrollView", () => {
  const ReactModule = require("react");
  return { ScrollView: (props: Record<string, unknown>) => ReactModule.createElement("scroll-view", props) };
});

import {
  FRIENDS_OF_FOLLOWERS_UNAVAILABLE,
  followersRowDetail,
  friendsOfFollowersRowAvailability,
  InviteSelectionSummary,
  InviteSourcePicker,
  type CircleRowAvailability,
} from "../InvitePeopleStep";
import type { BrandCircleReachSummary } from "../../../services/brandCircleReachSummaryService";

const summary = (extendedReason: "controls_not_live" | null): BrandCircleReachSummary => ({
  state: extendedReason === null ? "ready" : "partial",
  counts: { followers: 1, extended: extendedReason === null ? 2 : null, total: 1 },
  availability: {
    followers: { state: "ready", reason: null, refreshedAt: "2026-11-03T00:00:00Z", expiresAt: "2026-11-03T01:00:00Z" },
    extended: extendedReason === null
      ? { state: "ready", reason: null, refreshedAt: "2026-11-03T00:00:00Z", expiresAt: "2026-11-03T01:00:00Z" }
      : { state: "unavailable", reason: extendedReason, refreshedAt: null, expiresAt: null },
  },
});

const treeText = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(treeText).join(" ");
  if (value && typeof value === "object" && "children" in value) {
    return treeText((value as { children?: unknown }).children);
  }
  return "";
};

function renderPicker(friends: CircleRowAvailability | undefined, onFriends = jest.fn()) {
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(
      <InviteSourcePicker
        bookCount={3}
        groups={[]}
        friendsOfFollowers={friends}
        selectedCount={0}
        followersDetail={followersRowDetail(4)}
        disabled={false}
        onSelectEveryone={jest.fn()}
        onSelectFollowers={jest.fn()}
        onSelectFriendsOfFollowers={onFriends}
        onSelectGroup={jest.fn()}
        onChoosePeople={jest.fn()}
      />,
    );
  });
  const selectButtons = renderer.root.findAllByType("button")
    .filter((node: any) => node.props.label === "Select");
  // Order: Followers, Friends of followers.
  return { renderer, followers: selectButtons[0], friends: selectButtons[1], onFriends };
}

describe("#3682 Friends of followers row follows the extended-audience switch", () => {
  it("is disabled with the Blast picker explanation while the switches are off", () => {
    const state = friendsOfFollowersRowAvailability({
      pending: false, error: false, summary: summary("controls_not_live"),
    });
    expect(state).toEqual({ available: false, detail: FRIENDS_OF_FOLLOWERS_UNAVAILABLE });
    expect(FRIENDS_OF_FOLLOWERS_UNAVAILABLE).toBe(
      "Not available until people can control extended brand reach in Mingla.",
    );
    const { renderer, friends, followers } = renderPicker(state);
    expect(friends.props.disabled).toBe(true);
    expect(followers.props.disabled).toBe(false);
    expect(treeText(renderer.toJSON())).toContain(FRIENDS_OF_FOLLOWERS_UNAVAILABLE);
  });

  it("stays disabled while availability is loading or failed (never a dead tap)", () => {
    expect(friendsOfFollowersRowAvailability({ pending: true, error: false, summary: undefined }).available).toBe(false);
    expect(friendsOfFollowersRowAvailability({ pending: false, error: true, summary: undefined }).available).toBe(false);
    const { friends } = renderPicker(undefined);
    expect(friends.props.disabled).toBe(true);
  });

  it("is selectable once the extended audience is live", () => {
    const state = friendsOfFollowersRowAvailability({
      pending: false, error: false, summary: summary(null),
    });
    expect(state.available).toBe(true);
    const onFriends = jest.fn();
    const { friends } = renderPicker(state, onFriends);
    expect(friends.props.disabled).toBe(false);
    act(() => friends.props.onPress());
    expect(onFriends).toHaveBeenCalledTimes(1);
  });
});

describe("#3682 wave 2 — any follower can be invited, not only Your Book", () => {
  it("the Followers row counts every follower and never says Your Book only", () => {
    expect(followersRowDetail(4)).toBe("All 4 followers");
    expect(followersRowDetail(1)).toBe("All 1 follower");
    expect(followersRowDetail(0)).toBe("No followers yet");
    expect(followersRowDetail(undefined)).toBe("Checking count…");
    const { renderer, followers } = renderPicker(undefined);
    const text = treeText(renderer.toJSON());
    expect(text).toContain("All 4 followers");
    expect(text).not.toContain("already in Your Book");
    expect(followers.props.disabled).toBe(false);
  });

  it("the selection summary says how many followers are reached privately", () => {
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(
        <InviteSelectionSummary selectedCount={5} accountCount={3} people={[]}
          saving={false} dirty={false} onClear={jest.fn()} />,
      );
    });
    const text = treeText(renderer.toJSON());
    expect(text).toContain("5 selected");
    expect(text).toContain("Includes 3 followers reached through Mingla. Their contact details stay private.");
  });
});
