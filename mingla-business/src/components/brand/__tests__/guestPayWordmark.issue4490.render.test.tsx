/**
 * #4490 — the guest pay pages (/pay/<token>, /pay/till/<code>,
 * /pay/door/<code>) show the Mingla logo image instead of the word typed out.
 *
 *  W1 native: the bundled wordmark image, labelled "Mingla", role image, fixed height.
 *  W2 web: a plain <img> of /brand/mingla-wordmark.png with alt "Mingla" (no
 *     image asset in the web bundle).
 *  W3 each of the three pages renders the shared component and no text wordmark
 *     (the door page is also rendered for real in issue_4420_door_guest_status).
 *
 * Fails on revert: a page back on <Text>Mingla</Text> fails W3; the component
 * without its label fails W1/W2.
 *
 * Run: cd mingla-business && npx jest --config jest.issue1484.render.cjs --maxWorkers=2 guestPayWordmark.issue4490
 */
import fs from "fs";
import path from "path";
import React from "react";
import { Image, StyleSheet } from "react-native";

interface Node { type: unknown; props: Record<string, unknown> }
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => { root: { findAll: (p: (n: Node) => boolean) => Node[] }; unmount: () => void };
  act: (fn: () => void) => void;
};

import { GuestPayWordmark } from "../GuestPayWordmark";
import { GUEST_PAY_WORDMARK } from "../GuestPayWordmark";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GuestPayWordmark: WebWordmark } = require("../GuestPayWordmark.web") as { GuestPayWordmark: () => React.ReactElement };

const render = (el: React.ReactElement) => {
  let t: ReturnType<typeof TestRenderer.create> | null = null;
  TestRenderer.act(() => { t = TestRenderer.create(el); });
  return t as unknown as ReturnType<typeof TestRenderer.create>;
};

describe("#4490 the guest pay pages' Mingla logo", () => {
  test("W1 native: the wordmark image, labelled Mingla, role image, 30 high", () => {
    const t = render(<GuestPayWordmark />);
    const img = t.root.findAll((n) => n.type === Image)[0];
    expect(img).toBeDefined();
    expect(img.props.accessibilityLabel).toBe("Mingla");
    expect(img.props.accessibilityRole).toBe("image");
    expect(StyleSheet.flatten(img.props.style as never)).toMatchObject({ height: 30, width: GUEST_PAY_WORDMARK.width });
    t.unmount();
  });

  test("W2 web: an <img> of /brand/mingla-wordmark.png with alt Mingla", () => {
    const t = render(<WebWordmark />);
    const img = t.root.findAll((n) => n.type === "img")[0];
    expect(img.props.src).toBe("/brand/mingla-wordmark.png");
    expect(img.props.alt).toBe("Mingla");
    // The web copy keeps the native sizes (one logo, two renderers).
    expect(img.props.style).toMatchObject({ width: GUEST_PAY_WORDMARK.width, height: GUEST_PAY_WORDMARK.height });
    expect(img.props.src).toBe(GUEST_PAY_WORDMARK.webSrc);
    expect(fs.existsSync(path.join(__dirname, "../../../../public/brand/mingla-wordmark.png"))).toBe(true);
    t.unmount();
  });

  test.each(["app/pay/[token].tsx", "app/pay/till/[code].tsx", "app/pay/door/[code].tsx"])(
    "W3 %s renders the shared logo and no text wordmark",
    (rel) => {
      const src = fs.readFileSync(path.join(__dirname, "../../../..", rel), "utf8");
      expect(src).toMatch(/import \{ GuestPayWordmark \} from "[./]+\/src\/components\/brand\/GuestPayWordmark";/);
      expect(src).toContain("<GuestPayWordmark />");
      expect(src).not.toMatch(/>\s*Mingla\s*</);
      expect(src).not.toContain("wordmarkText");
    },
  );
});
