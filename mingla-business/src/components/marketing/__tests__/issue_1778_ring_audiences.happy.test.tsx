import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ visible, children }: { visible: boolean; children: unknown }) =>
    visible ? children : null,
}));
jest.mock("../../ui/Skeleton", () => ({ Skeleton: () => null }));
jest.mock("lucide-react-native", () => {
  const icon = () => null;
  return {
    BookOpen: icon,
    Check: icon,
    Network: icon,
    Radio: icon,
    ShoppingBag: icon,
    UsersRound: icon,
  };
});

const ordersEq = jest.fn(async () => ({
  data: [
    {
      event_id: "event-1",
      events: { id: "event-1", title: "Launch", brand_id: "brand-1" },
    },
  ],
  error: null,
}));
const audiencesEq = jest.fn(async () => ({
  data: [
    {
      id: "followers-audience",
      query_definition: { kind: "brand_followers", brand_id: "brand-1" },
    },
  ],
  error: null,
}));
const from = jest.fn((table: string) => ({
  select: () =>
    table === "orders"
      ? { in: () => ({ eq: ordersEq }) }
      : { eq: audiencesEq },
}));
jest.mock("../../../services/supabase", () => ({ supabase: { from } }));
jest.mock("../../../services/marketing/marketingCampaignService", () => ({
  getOrCreateMarketingBookAudience: jest.fn(async () => ({
    audienceId: "book-audience",
    activeBookTotal: 12,
  })),
}));
jest.mock("../../../services/marketing/manualGroupService", () => ({
  listManualGroups: jest.fn(async () => [{
    groupId: "group-1",
    name: "VIP regulars",
    memberCount: 7,
  }]),
}));

import { AudiencePickerSheet } from "../AudiencePickerSheet";
import { ComposerReviewSheet } from "../ComposerReviewSheet";
import { parseAudienceParam } from "../../../hooks/marketing/parseAudienceParam";
import { buildComposeAudienceHref } from "../../../utils/composeAudienceHref";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => any;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};

const renderedText = (node: any): string => {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(renderedText).join(" ");
  return node && typeof node === "object"
    ? renderedText(node.children ?? [])
    : "";
};

describe("#1778 Business Circle audience contract", () => {
  test("deep links use privacy-safe route tokens", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    const followersParam = buildComposeAudienceHref("followers", id).split(
      "audience=",
    )[1];
    const extendedParam = buildComposeAudienceHref("extended", id).split(
      "audience=",
    )[1];
    expect(parseAudienceParam(followersParam)).toEqual({
      kind: "followers",
      id,
    });
    expect(parseAudienceParam(extendedParam)).toEqual({
      kind: "extended",
      id,
    });
    expect(parseAudienceParam(`brand_followers:${id}`)).toBeNull();
  });

  test("renders the accepted hierarchy without exposing contact details", async () => {
    let tree: any;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <AudiencePickerSheet
          visible
          actorId="actor-1"
          brandId="brand-1"
          brandName="Mingla Test"
          selectedAudienceId="followers-audience"
          onClose={jest.fn()}
          onSelect={jest.fn()}
          bookBlastEnabled
          manualGroupsEnabled
          circleAudienceEnabled
          circleReach={{
            followers: { count: 42, state: "ready", enabled: true },
            extended: {
              count: 31,
              state: "unavailable",
              enabled: false,
              reason:
                "Not available until people can control extended brand reach in Mingla.",
            },
          }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const output = renderedText(tree.toJSON()).replace(/\s+/g, " ");
    expect(output).toContain("Choose who gets this");
    expect(output).toMatch(/Your brand.*Your Book.*Mingla reach.*Followers/);
    expect(output).toMatch(/Followers.*Names only.*42 people/);
    expect(output).toMatch(/Extended.*Consent controlled.*Not available until people can control extended brand reach/);
    expect(output).toMatch(/Groups.*VIP regulars.*Automatic.*All buyers of Mingla Test/);
    expect(output).toContain(
      "Mingla keeps follower contact details hidden. You see names and reach totals only.",
    );
    expect(output).not.toMatch(/[+][0-9]{8,}|@example[.]test/);

    const extended = tree.root.findAll(
      (node: any) =>
        typeof node.props.accessibilityLabel === "string" &&
        node.props.accessibilityLabel.startsWith("Pick audience Extended circle."),
    )[0];
    expect(extended.props.accessibilityState).toEqual({
      selected: false,
      disabled: true,
    });
  });

  test("keeps empty and failed follower rows visible, disabled, and recoverable", async () => {
    const retry = jest.fn();
    let tree: any;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <AudiencePickerSheet
          visible
          actorId="actor-1"
          brandId="brand-1"
          brandName="Mingla Test"
          selectedAudienceId={null}
          onClose={jest.fn()}
          onSelect={jest.fn()}
          bookBlastEnabled
          circleAudienceEnabled
          onRetryCircleReach={retry}
          circleReach={{
            followers: {
              count: null,
              state: "unavailable",
              enabled: true,
              reason: "Followers are taking a minute. Try again.",
            },
            extended: {
              count: null,
              state: "unavailable",
              enabled: false,
              reason:
                "Not available until people can control extended brand reach in Mingla.",
            },
          }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const output = renderedText(tree.toJSON()).replace(/\s+/g, " ");
    expect(output).toContain("Followers are taking a minute. Try again.");
    const retryButton = tree.root.findAll(
      (node: any) => node.props.accessibilityLabel === "Retry follower reach",
    )[0];
    expect(retryButton).toBeDefined();
    TestRenderer.act(() => retryButton.props.onPress());
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("review shows the four accepted aggregate metrics", () => {
    let tree: any;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <ComposerReviewSheet
          visible
          audienceName="Followers"
          recipientCount={37}
          subject="Hello"
          scheduledLabel="Now"
          isSendNow
          submitting={false}
          onBack={jest.fn()}
          onClose={jest.fn()}
          onConfirm={jest.fn()}
          selectedCount={42}
          suppressedCount={3}
          unavailableCount={2}
          estimatedCostLabel="Provider cost not metered"
          quoteExpiresAt="2026-09-02T21:05:00.000Z"
          audienceReason="They follow your brand · Names only"
          disabledReason={null}
        />,
      );
    });
    const output = renderedText(tree.toJSON()).replace(/\s+/g, " ");
    expect(output).toContain("Ready to send");
    expect(output).toContain("They follow your brand · Names only");
    expect(output).toMatch(/SELECTED POOL.*42/);
    expect(output).toMatch(/REACHABLE NOW.*37/);
    expect(output).toMatch(/SKIPPED.*5/);
    expect(output).toMatch(/ESTIMATED COST.*Provider cost not metered/);
    expect(output).toContain(
      "The price and reach below are locked to this preview. Nothing sends until you tap Send now.",
    );
    expect(output).toContain(
      "Suppressed and unavailable people are skipped automatically. You are charged only for reachable recipients.",
    );
    expect(output).toContain(
      "Preview refreshed just now · Valid for 5 minutes",
    );
  });
});
