/**
 * #4490 07-L — "Use {Venue}'s cover" on the event AND experience cover steps.
 *
 * Mounts the real VenueCoverButton (react-test-renderer over the stock RN mock;
 * Button stubbed): the copy is requested for the row, and the result reaches
 * the step's own cover writer as an ordinary upload patch. The experience
 * step is checked to hand that patch to onCoverChange (the wizard's setCover,
 * the same writer its device upload uses) and to ask for the experience link.
 *
 * Fails-on-revert: removing the <VenueCoverButton> from ExperienceCoverStep
 * fails X-1; dropping onApply(...) in the button fails B-1.
 */
import { readFileSync } from "fs";
import path from "path";
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const copy = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const hookCalls: unknown[][] = [];
jest.mock("../../../hooks/useEventVenueCover", () => ({
  useEventVenueCover: (...args: unknown[]) => {
    hookCalls.push(args);
    return args[0] === null ? null : { venueId: "venue-1", venueName: "CLUB MERIDIAN" };
  },
}));
jest.mock("../../../services/eventCoverMediaService", () => ({
  copyVenueCoverToEvent: (...a: unknown[]) => copy(...a),
  venueCoverPatch: (c: { url: string; type: string; posterUrl: string }, name: string) => ({
    coverMediaUrl: c.url, coverMediaPosterUrl: c.posterUrl, coverMediaType: c.type, coverMediaProvider: "upload",
    coverMediaSourceUrl: null, coverMediaCredit: null, coverMediaCreditUrl: null, coverMediaAlt: `${name} cover`,
  }),
}));
jest.mock("../Button", () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { Pressable, Text } = require("react-native");
  const R = require("react");
  /* eslint-enable @typescript-eslint/no-require-imports */
  return {
    Button: (props: { label: string; testID?: string; onPress?: () => void }) =>
      R.createElement(Pressable, { testID: props.testID, onPress: props.onPress }, R.createElement(Text, null, props.label)),
  };
});

import { VenueCoverButton } from "../VenueCoverButton";

type HostNode = { props: Record<string, unknown> };
type Tree = { root: { findAll: (p: (n: HostNode) => boolean) => HostNode[] } };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (e: React.ReactElement) => Tree;
  act: (cb: () => Promise<void> | void) => Promise<void>;
};

const ROW = "0b6f2f3e-7a51-4e7b-9a1c-2d3e4f5a6b7c";

describe("#4490 07-L Use the venue's cover", () => {
  test("B-1 copies for this row and applies an upload patch", async () => {
    copy.mockResolvedValue({ url: "https://x/c.png", type: "image", posterUrl: "https://x/c.png" });
    const onApply = jest.fn();
    let tree: Tree | undefined;
    await TestRenderer.act(() => {
      tree = TestRenderer.create(<VenueCoverButton rowId={ROW} noun="experience" onApply={onApply} />);
    });
    const btn = tree!.root.findAll((n) => n.props.testID === "cover-step-use-venue-cover")[0];
    await TestRenderer.act(async () => {
      (btn.props.onPress as () => void)();
    });
    expect(copy).toHaveBeenCalledWith(ROW, "venue-1");
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ coverMediaUrl: "https://x/c.png", coverMediaProvider: "upload" }));
    expect(hookCalls.some((a) => a[0] === ROW && a[1] === "experience")).toBe(true);
    expect(tree!.root.findAll((n) => n.props.testID === "cover-step-venue-cover-applied").length).toBeGreaterThan(0);
  });

  test("B-2 a failed copy shows the plain error and applies nothing", async () => {
    copy.mockRejectedValue(new Error("event_not_at_venue"));
    const onApply = jest.fn();
    let tree: Tree | undefined;
    await TestRenderer.act(() => {
      tree = TestRenderer.create(<VenueCoverButton rowId={ROW} noun="event" onApply={onApply} />);
    });
    const btn = tree!.root.findAll((n) => n.props.testID === "cover-step-use-venue-cover")[0];
    await TestRenderer.act(async () => {
      (btn.props.onPress as () => void)();
    });
    expect(onApply).not.toHaveBeenCalled();
    expect(tree!.root.findAll((n) => n.props.testID === "cover-step-venue-cover-error").length).toBeGreaterThan(0);
  });

  test("B-3 a local draft id shows no button", async () => {
    let tree: Tree | undefined;
    await TestRenderer.act(() => {
      tree = TestRenderer.create(<VenueCoverButton rowId="d_abc" noun="event" onApply={jest.fn()} />);
    });
    expect(tree!.root.findAll((n) => n.props.testID === "cover-step-use-venue-cover").length).toBe(0);
  });

  test("X-1 the experience cover step mounts it and writes through onCoverChange", () => {
    const src = readFileSync(path.join(__dirname, "../../experience/ExperienceCoverStep.tsx"), "utf8");
    expect(src).toMatch(/<VenueCoverButton[\s\S]*?noun="experience"[\s\S]*?onApply=\{\(patch\) => onCoverChange\(/);
  });
});
