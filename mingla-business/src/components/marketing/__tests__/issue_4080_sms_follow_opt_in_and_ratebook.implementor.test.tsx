import React from "react";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../ui/Icon", () => ({ Icon: () => null }));

import { SmsComposeCard } from "../SmsComposeCard";
import { SmsPreviewPane } from "../SmsPreviewPane";
import { campaignPayloadIssues } from "../../../services/marketing/campaignPayloadContract";

const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => RenderedTree;
  act: (callback: () => void) => void;
};

interface RenderedNode {
  props: Record<string, unknown> & {
    onValueChange?: (value: boolean) => void;
  };
  findAll: (predicate: (node: RenderedNode) => boolean) => RenderedNode[];
}

interface RenderedTree {
  root: RenderedNode;
  toJSON: () => unknown;
}

const previewProps: React.ComponentProps<typeof SmsPreviewPane> = {
  body: "CTRL V2 ticket yet? Sat 24 Oct: https://host.usemingla.com/e/ctrl/ctrl-v2",
  brandName: "Ctrl",
  brandSlug: "ctrl",
  reachableSms: 59,
  currencyCode: "NGN",
};

describe("#4080 SMS Follow opt-in", () => {
  test("preview omits Follow by default and includes it only when selected", () => {
    let withoutFollow!: RenderedTree;
    let withFollow!: RenderedTree;
    TestRenderer.act(() => {
      withoutFollow = TestRenderer.create(<SmsPreviewPane {...previewProps} />);
      withFollow = TestRenderer.create(
        <SmsPreviewPane {...previewProps} includeFollowCta />,
      );
    });
    expect(JSON.stringify(withoutFollow.toJSON())).not.toContain("Follow Ctrl");
    expect(JSON.stringify(withoutFollow.toJSON())).toContain(
      "Reply STOP to opt out.",
    );
    expect(JSON.stringify(withFollow.toJSON())).toContain("Follow Ctrl");
  });

  test("composer control starts off and forwards an explicit opt-in", () => {
    const onChange = jest.fn();
    let tree!: RenderedTree;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <SmsComposeCard
          value="Tickets this Saturday"
          onChangeText={jest.fn()}
          reachableSms={59}
          currencyCode="NGN"
          onIncludeFollowCtaChange={onChange}
        />,
      );
    });
    const toggle = tree.root.findAll(
      (node) =>
        node.props.accessibilityLabel === "Add a Follow link to this text",
    )[0];
    expect(toggle?.props.value).toBe(false);
    TestRenderer.act(() => toggle?.props.onValueChange?.(true));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test("payload contract accepts booleans and rejects ambiguous stored values", () => {
    expect(campaignPayloadIssues({ kind: "sms", body: "Hi" })).toEqual([]);
    expect(
      campaignPayloadIssues({
        kind: "sms",
        body: "Hi",
        include_follow_cta: true,
      }),
    ).toEqual([]);
    expect(
      campaignPayloadIssues({
        kind: "sms",
        body: "Hi",
        include_follow_cta: "yes",
      }),
    ).toEqual(["SMS `include_follow_cta` must be true or false."]);
  });
});
