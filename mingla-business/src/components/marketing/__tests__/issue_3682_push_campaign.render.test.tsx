import React from "react";

// #3682 wave 2 (B) — Host composer: Push is a campaign channel, and one
// campaign can go out by push, email and SMS together. Same RN code on Host
// web and Host native.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer");
const { act } = TestRenderer;

jest.mock("../../ui/Sheet", () => {
  const ReactModule = require("react");
  return { Sheet: (props: Record<string, unknown>) => ReactModule.createElement("sheet", props, props.children) };
});

import { CampaignChannelSelector } from "../CampaignChannelSelector";
import { ChannelTabs } from "../ChannelTabs";
import { ComposerReviewSheet } from "../ComposerReviewSheet";
import { PushComposeCard, pushBodyIssue, pushReasonLine } from "../PushComposeCard";
import { campaignPayloadIssues } from "../../../services/marketing/campaignPayloadContract";

const treeText = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(treeText).join(" ");
  if (value && typeof value === "object" && "children" in value) {
    return treeText((value as { children?: unknown }).children);
  }
  return "";
};

describe("#3682 push campaign channel", () => {
  it("offers Push as a third channel tab", () => {
    let renderer: any;
    const onChange = jest.fn();
    act(() => { renderer = TestRenderer.create(<ChannelTabs active="email" onChange={onChange} />); });
    const tabs = renderer.root.findAll((node: any) => node.props.accessibilityRole === "tab" && node.props.onPress);
    const labels = tabs.map((node: any) => node.props.accessibilityLabel);
    expect(labels).toEqual(["Email channel", "SMS channel", "Push channel"]);
    act(() => tabs[2].props.onPress());
    expect(onChange).toHaveBeenCalledWith("push");
  });

  it("previews the push with the brand name and the true reason", () => {
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(
        <PushComposeCard body="Doors at 9." onChangeBody={jest.fn()} brandName="Harmattan Club" reason="follower" />,
      );
    });
    const text = treeText(renderer.toJSON());
    expect(text).toContain("Harmattan Club");
    expect(text).toContain("Doors at 9. You follow Harmattan Club.");
    expect(text).toContain("Free and unlimited");
    expect(pushReasonLine("extended", "X")).toBe("A friend of yours follows X.");
    expect(pushReasonLine("book", "X")).toBe("You're on X's guest list.");
    expect(pushBodyIssue("")).not.toBeNull();
    expect(pushBodyIssue("x".repeat(121))).not.toBeNull();
    expect(pushBodyIssue("ok")).toBeNull();
  });

  it("lets the host add the other channels to the same campaign", () => {
    const onToggle = jest.fn();
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(
        <CampaignChannelSelector lead="email" selected={new Set(["push"])} onToggle={onToggle} />,
      );
    });
    const chips = renderer.root.findAll((node: any) => node.props.accessibilityRole === "checkbox" && node.props.onPress);
    expect(chips.map((node: any) => node.props.accessibilityLabel)).toEqual([
      "Also send by SMS", "Also send by Push",
    ]);
    expect(chips[1].props.accessibilityState).toEqual({ checked: true, disabled: false });
    act(() => chips[0].props.onPress());
    expect(onToggle).toHaveBeenCalledWith("sms");
  });

  it("greys a channel out with the reason instead of a dead tap", () => {
    const onToggle = jest.fn();
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(
        <CampaignChannelSelector lead="email" selected={new Set()} onToggle={onToggle}
          unavailable={{ push: "pick Your Book, Followers or a saved group" }} />,
      );
    });
    const push = renderer.root.findAll((node: any) => node.props.accessibilityLabel === "Also send by Push" && node.props.onPress)[0];
    expect(push.props.disabled).toBe(true);
    act(() => push.props.onPress());
    expect(onToggle).not.toHaveBeenCalled();
    expect(treeText(renderer.toJSON())).toContain("Push: pick Your Book, Followers or a saved group");
  });

  it("the review shows each extra channel's reach, cost and allowance, counted once", () => {
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(
        <ComposerReviewSheet visible audienceName="Followers" recipientCount={4} subject="Hi"
          scheduledLabel="Now" isSendNow submitting={false} onBack={jest.fn()} onClose={jest.fn()}
          onConfirm={jest.fn()} channelKind="email"
          additionalChannels={[
            { key: "push", label: "Push", reachLabel: "3 reachable", costLabel: "Free" },
            { key: "sms", label: "SMS", reachLabel: "2 reachable", costLabel: "USD 0.04 estimated",
              allowanceLabel: "98 of 100 texts left this month" },
          ]} />,
      );
    });
    const text = treeText(renderer.toJSON());
    expect(text).toContain("ALSO SENDING BY");
    expect(text).toContain("3 reachable · Free");
    expect(text).toContain("98 of 100 texts left this month");
    expect(text).toContain("counts once toward your weekly blasts");
  });

  it("a push payload must carry a short message", () => {
    expect(campaignPayloadIssues({ kind: "push", body: "Doors at 9." })).toEqual([]);
    expect(campaignPayloadIssues({ kind: "push", body: "  " })).toHaveLength(1);
    expect(campaignPayloadIssues({ kind: "push", body: "x".repeat(241) })).toHaveLength(1);
  });
});
