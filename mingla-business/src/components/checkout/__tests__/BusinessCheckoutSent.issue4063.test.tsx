/** Issue #4063 T5-11 — Business native hands an unowned ticket to the buyer. */
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockCapture = jest.fn();
jest.mock("../../../services/postHogService", () => ({
  postHogService: { capture: (...args: unknown[]) => mockCapture(...args) },
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));

import { BusinessCheckoutSent } from "../BusinessCheckoutSent";

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  children: Array<Node | string>;
  findAll: (predicate: (node: Node) => boolean) => Node[];
}
interface Tree { root: Node; unmount: () => void }
const renderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};
const text = (node: Node): string =>
  node.children.map((child) => typeof child === "string" ? child : text(child)).join(" ");

beforeEach(() => {
  mockCapture.mockReset();
});

describe("BusinessCheckoutSent", () => {
  test("names the recipient, records the detached purchase and Done returns", async () => {
    const onDone = jest.fn();
    let tree!: Tree;
    await renderer.act(async () => {
      tree = renderer.create(
        <BusinessCheckoutSent buyerName="Tolu Ade" onDone={onDone} surface="event" />,
      );
    });
    expect(text(tree.root)).toContain("Ticket sent to Tolu.");
    expect(text(tree.root)).toContain("We emailed and texted Tolu a link to the ticket.");
    const done = tree.root.findAll(
      (node) => node.type === "Pressable" && node.props.accessibilityLabel === "Done",
    )[0];
    expect(done).toBeDefined();
    await renderer.act(async () => {
      (done.props.onPress as () => void)();
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith(
      "biz_checkout_for_someone_else_completed",
      { attached_to_caller: false, offering_type: "event" },
    );
    await renderer.act(async () => tree.unmount());
  });

  test("uses the locked generic fallback when no recipient name is available", async () => {
    let tree!: Tree;
    await renderer.act(async () => {
      tree = renderer.create(
        <BusinessCheckoutSent buyerName="  " onDone={() => undefined} surface="trip" />,
      );
    });
    expect(text(tree.root)).toContain("Ticket sent.");
    expect(text(tree.root)).toContain("We emailed and texted a link to the ticket.");
    await renderer.act(async () => tree.unmount());
  });
});
