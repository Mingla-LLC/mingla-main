// #4273 wave B — Send by, the labelled pre-fill, preview tabs and the review.
import React from "react";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer");
const { act } = TestRenderer;

jest.mock("../../ui/Sheet", () => {
  const ReactModule = require("react");
  return { Sheet: (props: Record<string, unknown>) => ReactModule.createElement("sheet", props, props.children) };
});

import { ChannelTabs } from "../ChannelTabs";
import { ComposerPreviewTabs } from "../ComposerPreviewTabs";
import { ComposerReviewSheet } from "../ComposerReviewSheet";
import { PushComposeCard } from "../PushComposeCard";
import { audienceSourceDetail, prefillPushFromEmail } from "../../../features/marketing/blastSendModel";
import { useAutoFilledText, type AutoFilledText } from "../../../features/marketing/useAutoFilledText";
import { Text } from "react-native";

const treeText = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(treeText).join(" ");
  if (value && typeof value === "object" && "children" in value) {
    return treeText((value as { children?: unknown }).children);
  }
  return "";
};
const mount = (element: React.ReactElement): any => {
  let renderer: any;
  act(() => { renderer = TestRenderer.create(element); });
  return renderer;
};
const chip = (renderer: any, label: string) =>
  renderer.root.findAll(
    (node: any) => String(node.props.accessibilityLabel ?? "").startsWith(label) && node.props.onPress,
  )[0];

describe("#4273 Send by", () => {
  it("keeps the wording and shows every method as a tick", () => {
    const text = treeText(mount(<ChannelTabs selected={new Set(["email"])} onToggle={jest.fn()} />).toJSON());
    expect(text).toContain("SEND BY");
    expect(text).toContain("✓ Email");
    expect(text).toContain("SMS");
    expect(text).toContain("Push · free");
  });

  it("the last method ticked cannot be unticked", () => {
    const onToggle = jest.fn();
    const renderer = mount(<ChannelTabs selected={new Set(["sms"])} onToggle={onToggle} />);
    const sms = chip(renderer, "Send by SMS");
    expect(sms.props.accessibilityLabel).toContain("At least one method stays on");
    expect(sms.props.accessibilityState).toEqual({ checked: true, disabled: true });
    act(() => sms.props.onPress());
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("Push picked with a buyer list is off and disabled, with today's limit message", () => {
    const onToggle = jest.fn();
    const renderer = mount(
      <ChannelTabs
        selected={new Set(["email", "push"])}
        onToggle={onToggle}
        unavailable={{ push: "pick Your Book, Followers or a saved group" }}
      />,
    );
    const push = chip(renderer, "Send by Push");
    expect(push.props.accessibilityState).toEqual({ checked: false, disabled: true });
    expect(treeText(renderer.toJSON())).toContain("Push: pick Your Book, Followers or a saved group");
    // Email is then the only one on, so it stays on.
    expect(chip(renderer, "Send by Email").props.accessibilityState.disabled).toBe(true);
  });
});

describe("#4273 a method taken away is said out loud", () => {
  it("shows the sentence, not only the chip note", () => {
    const sentence = "Push can't reach a buyer list, so this will go by Email instead.";
    const renderer = mount(
      <ChannelTabs selected={new Set(["email"])} onToggle={jest.fn()} fallbackSentence={sentence} />,
    );
    expect(treeText(renderer.toJSON())).toContain(sentence);
  });
});

describe("#4273 cards and previews", () => {
  it("the push card says where its text came from, and the subject is the title", () => {
    const renderer = mount(
      <PushComposeCard
        body="Doors at 9."
        onChangeBody={jest.fn()}
        brandName="Harmattan"
        reason="follower"
        title="Highlife Live"
        autoFillLabel="Filled in from your email · edit anytime"
      />,
    );
    const text = treeText(renderer.toJSON());
    expect(text).toContain("Filled in from your email · edit anytime");
    expect(text).toContain("Highlife Live");
    expect(text).toContain("PUSH MESSAGE");
    expect(text).toContain("Free and unlimited");
  });

  it("the preview has a tab per ticked method, and no tabs for one", () => {
    const onSelect = jest.fn();
    const renderer = mount(
      <ComposerPreviewTabs channels={["email", "sms", "push"]} active="sms" onSelect={onSelect} pane={<Text>pane</Text>} />,
    );
    const tabs = renderer.root.findAll((node: any) => node.props.accessibilityRole === "tab" && node.props.onPress);
    expect(tabs.map((tab: any) => tab.props.accessibilityLabel)).toEqual(["Preview Email", "Preview SMS", "Preview Push"]);
    expect(tabs[1].props.accessibilityState).toEqual({ selected: true });
    act(() => tabs[2].props.onPress());
    expect(onSelect).toHaveBeenCalledWith("push");
    const single = mount(
      <ComposerPreviewTabs channels={["email"]} active="email" onSelect={onSelect} pane={<Text>pane</Text>} />,
    );
    expect(single.root.findAll((node: any) => node.props.accessibilityRole === "tab")).toHaveLength(0);
  });
});

describe("#4273 pre-fill follows the email until edited", () => {
  let setEmail: (value: string) => void;
  let message: AutoFilledText;
  function Harness(): React.ReactElement {
    const [email, setEmailState] = React.useState("<p>Doors at 9.</p>");
    setEmail = setEmailState;
    message = useAutoFilledText(prefillPushFromEmail({ bodyHtml: email, brandName: "H" }));
    return <Text>{message.text}</Text>;
  }

  it("is labelled while it follows, then a later email change cannot overwrite the host", () => {
    mount(<Harness />);
    expect(message.text).toBe("Doors at 9.");
    expect(message.label).toBe("Filled in from your email · edit anytime");
    act(() => setEmail("<p>Doors at 10.</p>"));
    expect(message.text).toBe("Doors at 10.");
    act(() => message.edit("My own words"));
    expect(message.label).toBe("Edited by you");
    act(() => setEmail("<p>Doors at 11.</p>"));
    expect(message.text).toBe("My own words");
    // Clearing it is an edit too: the email does not rush back in.
    act(() => message.edit(""));
    act(() => setEmail("<p>Doors at 12.</p>"));
    expect(message.text).toBe("");
    expect(message.label).toBe("Edited by you");
  });

  it("has no label while there is nothing to fill in", () => {
    let empty: AutoFilledText | null = null;
    function Blank(): React.ReactElement {
      empty = useAutoFilledText("");
      return <Text>x</Text>;
    }
    mount(<Blank />);
    expect(empty).not.toBeNull();
    expect((empty as unknown as AutoFilledText).label).toBeNull();
  });
});

describe("#4273 review", () => {
  const base = {
    visible: true,
    subject: "Highlife",
    scheduledLabel: "Send immediately",
    isSendNow: true,
    submitting: false,
    onBack: jest.fn(),
    onClose: jest.fn(),
    onConfirm: jest.fn(),
    channelKind: "email" as const,
  };

  it("lists each group, one count per tile, and every method with its allowance", () => {
    const renderer = mount(
      <ComposerReviewSheet
        {...base}
        audienceName="Your Book + Followers"
        recipientCount={3}
        selectedCount={3}
        suppressedCount={0}
        unavailableCount={0}
        estimatedCostLabel="Free"
        quoteExpiresAt="2026-11-05T12:05:00.000Z"
        audienceGroups={[
          { key: "book", name: "Your Book", detail: audienceSourceDetail({ key: "book", count: 3, alsoInBookCount: 0 }) },
          { key: "followers", name: "Followers", detail: audienceSourceDetail({ key: "followers", count: 1, alsoInBookCount: 1 }) },
        ]}
        sendingBy={[
          { key: "email", label: "Email", reachLabel: "3 reachable", costLabel: "Free", allowanceLabel: "997 of 1000 emails left this month" },
          { key: "push", label: "Push", reachLabel: "3 reachable", costLabel: "Free", allowanceLabel: "Unlimited" },
        ]}
        extraPushPreview="Live band from 8pm."
      />,
    );
    const text = treeText(renderer.toJSON());
    expect(text).toContain("Your Book · 3 people  |  Followers · 1 person, also in Your Book");
    expect(text).toContain("SELECTED POOL");
    expect(text).toContain("SENDING BY");
    expect(text).not.toContain("ALSO SENDING BY");
    expect(text).toContain("997 of 1000 emails left this month");
    expect(text).toContain("Unlimited");
    expect(text).toContain("One campaign: it counts once toward your weekly blasts.");
    expect(text).toContain("Valid for 5 minutes");
    expect(text).toContain("PUSH MESSAGE");
    expect(text).toContain("Live band from 8pm.");
  });

  it("keeps the weekly warning and SMS timing unchanged", () => {
    const renderer = mount(
      <ComposerReviewSheet
        {...base}
        audienceName="Your Book"
        recipientCount={3}
        weekBlastWarning
        smsInfoNote
        nextWindowLabel="Nov 6, 8:00 AM"
        sendingBy={[{ key: "sms", label: "SMS", reachLabel: "3 reachable", costLabel: "USD 0.10 estimated" }]}
      />,
    );
    const text = treeText(renderer.toJSON());
    expect(text).toContain("You've sent 3 blasts in the last 7 days.");
    expect(text).toContain("Send anyway");
    expect(text).toContain("Not now");
    expect(text).toContain("How SMS timing works");
    expect(text).not.toContain("One campaign:");
  });

  it("a plain buyer-list send with no quote shows no method list", () => {
    const renderer = mount(<ComposerReviewSheet {...base} audienceName="All buyers" recipientCount={8} />);
    expect(treeText(renderer.toJSON())).not.toContain("SENDING BY");
  });
});
