/**
 * issue #4420 wave 2 (D-S7) — the "booked under another email" page's two
 * recovery actions.
 *
 *   W-1 with the server's view the page offers Sign in, "Email me the booking
 *       link again" and "Ask {Stay} to change the email", each labelled, and
 *       names the reference to quote; it shows no amount, date or address;
 *   W-2 the resend button is busy while it runs (no double send);
 *   W-3 without a resend (nothing to resend) or a host that takes messages,
 *       those buttons are absent rather than dead.
 *
 * Fails-on-revert: dropping a handler, the busy state, or showing the full
 * address fails here.
 */
import React from "react";
import { Text } from "react-native";
import { createThemePalette, resolveTheme } from "@mingla/offering-rendering";

jest.mock("../../ui/Icon", () => ({ Icon: () => null }));

import { StayOtherContactNotice } from "../StayOtherContactNotice";

type Node = { type: unknown; props: Record<string, unknown> };
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => { root: { findAll: (p: (n: Node) => boolean) => Node[] } };
  act: (fn: () => void) => void;
};

const palette = createThemePalette(resolveTheme(null, null));

const render = (props: Partial<React.ComponentProps<typeof StayOtherContactNotice>>) => {
  let tree!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      <StayOtherContactNotice
        palette={palette}
        maskedEmail="a•••@example.com"
        currentEmail="me@mingla.test"
        onSignInOther={() => undefined}
        stayName="The Glasshouse"
        reference="ST-4420000000000000000A"
        {...props}
      />,
    );
  });
  return tree;
};

const text = (tree: ReturnType<typeof render>): string =>
  tree.root
    .findAll((n) => n.type === Text)
    .map((n) => {
      const c = n.props.children;
      return Array.isArray(c) ? c.filter((x) => typeof x === "string").join("") : typeof c === "string" ? c : "";
    })
    .join(" | ");

const button = (tree: ReturnType<typeof render>, id: string): Node | undefined =>
  tree.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === "function")[0];

describe("issue #4420 — wrong-email recovery actions", () => {
  test("W-1 three labelled ways out, the reference, and no booking details", () => {
    const resend = jest.fn();
    const ask = jest.fn();
    const tree = render({ onResend: resend, onAskHost: ask });
    const r = button(tree, "issue-4420-stay-other-contact-resend");
    const a = button(tree, "issue-4420-stay-other-contact-ask-host");
    expect(button(tree, "issue-4420-stay-other-contact-sign-in")?.props.accessibilityLabel).toBe(
      "Sign in as a•••@example.com",
    );
    expect(r?.props.accessibilityLabel).toBe("Email the booking link again to a•••@example.com");
    expect(a?.props.accessibilityLabel).toBe("Ask The Glasshouse to change the email");
    TestRenderer.act(() => {
      (r?.props.onPress as () => void)();
      (a?.props.onPress as () => void)();
    });
    expect(resend).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledTimes(1);
    const all = text(tree);
    expect(all).toContain("ST-4420000000000000000A");
    expect(all).toContain("The Glasshouse booked this Stay for");
    expect(all).not.toMatch(/\$|€|£|ada\.owner|Check-in|nights?/);
  });

  test("W-2 the resend is busy while it runs", () => {
    const tree = render({ onResend: jest.fn(), resending: true });
    const r = button(tree, "issue-4420-stay-other-contact-resend");
    expect(r?.props.disabled).toBe(true);
    expect(text(tree)).toContain("Sending…");
  });

  test("W-3 no resend and no messages ⇒ no dead buttons", () => {
    const tree = render({ onResend: null, onAskHost: null });
    expect(button(tree, "issue-4420-stay-other-contact-resend")).toBeUndefined();
    expect(button(tree, "issue-4420-stay-other-contact-ask-host")).toBeUndefined();
    expect(text(tree)).not.toContain("ST-4420000000000000000A");
  });
});
