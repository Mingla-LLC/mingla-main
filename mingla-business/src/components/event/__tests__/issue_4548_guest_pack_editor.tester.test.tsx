/**
 * #4548 — tester render test: mounts the REAL GuestPackEditor with the REAL
 * working copy (guestPackSession), the REAL validation and the REAL save-first
 * gate; only the network service and native leaves are substituted.
 *
 * Distinct from the implementor suites (pure functions and source wiring): it
 * drives what the host taps and types, then asserts what the server is sent.
 *
 * FAILS-ON-REVERT: dropping the https check from checkGuestPackLink, removing
 * the 5-item cap in addGuestPackItem, making a failed save clear the fields, or
 * letting flushGuestPack answer ok on a failed save fails a case below.
 */
import React from "react";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

jest.mock("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles, absoluteFillObject: {} },
  Platform: { OS: "ios", select: (choices: any) => choices.ios ?? choices.default },
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  TextInput: "TextInput",
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
// Input is a leaf here: the props the editor passes are what is under test.
jest.mock("../../ui/Input", () => {
  const ReactInner = require("react");
  return { Input: (props: any) => ReactInner.createElement("TextInput", props) };
});
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: false }),
}));
const fetchEventGuestPack = jest.fn();
const saveEventGuestPack = jest.fn();
jest.mock("../../../services/guestPackService", () => ({
  fetchEventGuestPack: (...args: unknown[]) => fetchEventGuestPack(...args),
  saveEventGuestPack: (...args: unknown[]) => saveEventGuestPack(...args),
}));

import { GuestPackEditor } from "../GuestPackEditor";
import { flushGuestPack, hasPendingGuestPack } from "../../../utils/guestPackGate";
import {
  addGuestPackItem,
  GUEST_PACK_SAVE_FAILED_COPY,
  releaseGuestPackSession,
} from "../../../utils/guestPackSession";

type Node = { type: unknown; props: any; children: Array<Node | string>; findAll: (p: (n: Node) => boolean) => Node[] };
type Tree = { root: Node; unmount: () => void };
const renderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => Tree;
  act: (cb: () => void | Promise<void>) => Promise<void>;
};
const { act } = renderer;

const EVENT = "45480000-0000-4000-a000-000000000001";

const byLabel = (tree: Tree, label: string | RegExp): Node[] =>
  tree.root.findAll(
    (n) =>
      typeof n.type === "string" &&
      typeof n.props.accessibilityLabel === "string" &&
      (typeof label === "string" ? n.props.accessibilityLabel === label : label.test(n.props.accessibilityLabel)),
  );
const one = (tree: Tree, label: string | RegExp): Node => {
  const hits = byLabel(tree, label);
  if (hits.length !== 1) throw new Error(`expected one ${String(label)}, found ${hits.length}`);
  return hits[0];
};
const texts = (tree: Tree): string[] =>
  tree.root
    .findAll((n) => n.type === "Text")
    .map((n) => n.children.filter((c) => typeof c === "string").join(""));
const press = async (tree: Tree, label: string | RegExp): Promise<void> => {
  await act(async () => {
    await one(tree, label).props.onPress();
  });
};
const type = async (tree: Tree, label: string, value: string): Promise<void> => {
  await act(async () => {
    one(tree, label).props.onChangeText(value);
  });
};
const blur = async (tree: Tree, label: string): Promise<void> => {
  await act(async () => {
    one(tree, label).props.onBlur?.();
  });
};

async function mount(eventId: string | null, onShowToast = jest.fn()): Promise<Tree> {
  let tree: Tree | undefined;
  await act(async () => {
    tree = renderer.create(<GuestPackEditor eventId={eventId} onShowToast={onShowToast} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return tree as Tree;
}

beforeEach(() => {
  fetchEventGuestPack.mockReset();
  saveEventGuestPack.mockReset();
  releaseGuestPackSession(EVENT);
});

describe("#4548 GuestPackEditor (tester, real editor and working copy)", () => {
  test("a draft that has not reached the server shows the still-saving state and loads nothing", async () => {
    const tree = await mount(null);
    expect(texts(tree)).toContain("Your draft is still saving. This opens in a moment.");
    expect(fetchEventGuestPack).not.toHaveBeenCalled();
    expect(byLabel(tree, "Add a link")).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  test("an empty pack never blocks: nothing pending, the gate answers yes without a call", async () => {
    fetchEventGuestPack.mockResolvedValue(null);
    const tree = await mount(EVENT);
    expect(hasPendingGuestPack(EVENT)).toBe(false);
    await expect(flushGuestPack(EVENT)).resolves.toEqual({ ok: true, saved: false });
    expect(saveEventGuestPack).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test("add, validate on blur (http refused, bare domain fixed), then save sends the exact payload", async () => {
    fetchEventGuestPack.mockResolvedValue(null);
    const tree = await mount(EVENT);
    await press(tree, "Guest pack, ticket holders only");
    await type(tree, "Note for guests", "  Ring 4B.\nSide door.  ");
    await press(tree, "Add a link");
    await type(tree, "Label for link 1", "Parking map");
    expect(one(tree, "Label for link 1").props.maxLength).toBe(40);
    await type(tree, "Link address for link 1", "http://maps.example.test/p");
    await blur(tree, "Link address for link 1");
    expect(one(tree, "Link address for link 1").props.error).toBe("Use a secure link (https)");
    await type(tree, "Link address for link 1", "javascript:alert(1)");
    await blur(tree, "Link address for link 1");
    expect(one(tree, "Link address for link 1").props.error).toBe(
      "Only web links work here. Use a link that starts with https://",
    );
    await type(tree, "Link address for link 1", "maps.example.test/p");
    await blur(tree, "Link address for link 1");
    expect(one(tree, "Link address for link 1").props.value).toBe("https://maps.example.test/p");
    expect(one(tree, "Link address for link 1").props.error ?? null).toBeNull();
    expect(texts(tree)).toContain("Added https:// for you.");
    expect(hasPendingGuestPack(EVENT)).toBe(true);

    saveEventGuestPack.mockResolvedValue({
      note: "Ring 4B.\nSide door.",
      items: [{ label: "Parking map", url: "https://maps.example.test/p" }],
      updatedAt: "2026-11-22T00:00:00Z",
    });
    await press(tree, "Save pack");
    expect(saveEventGuestPack).toHaveBeenCalledTimes(1);
    expect(saveEventGuestPack).toHaveBeenCalledWith(EVENT, {
      note: "Ring 4B.\nSide door.",
      items: [{ label: "Parking map", url: "https://maps.example.test/p" }],
    });
    expect(texts(tree)).toContain("Saved.");
    expect(hasPendingGuestPack(EVENT)).toBe(false);
    await act(async () => tree.unmount());
  });

  test("a missing label blocks the save inline and nothing is sent", async () => {
    fetchEventGuestPack.mockResolvedValue(null);
    const onShowToast = jest.fn();
    const tree = await mount(EVENT, onShowToast);
    await press(tree, "Guest pack, ticket holders only");
    await press(tree, "Add a link");
    await type(tree, "Link address for link 1", "https://example.test/a.pdf");
    const result = await flushGuestPack(EVENT);
    expect(result.ok).toBe(false);
    await act(async () => undefined);
    expect(saveEventGuestPack).not.toHaveBeenCalled();
    expect(one(tree, "Label for link 1").props.error).toBe("Add a label so guests know what this is.");
    expect(texts(tree)).toContain("Fix 1 link before saving.");
    await act(async () => tree.unmount());
  });

  test("a failed save keeps everything typed, toasts, and the gate keeps the host on the step", async () => {
    fetchEventGuestPack.mockResolvedValue(null);
    const onShowToast = jest.fn();
    const tree = await mount(EVENT, onShowToast);
    await press(tree, "Guest pack, ticket holders only");
    await type(tree, "Note for guests", "Door code 4548");
    saveEventGuestPack.mockRejectedValue(new Error("network down"));
    await press(tree, "Save pack");
    expect(onShowToast).toHaveBeenCalledWith(GUEST_PACK_SAVE_FAILED_COPY);
    expect(one(tree, "Note for guests").props.value).toBe("Door code 4548");
    const gate = await flushGuestPack(EVENT);
    expect(gate).toEqual({ ok: false, reason: "failed", message: GUEST_PACK_SAVE_FAILED_COPY });
    expect(hasPendingGuestPack(EVENT)).toBe(true);
    // Then the connection comes back: the same gate saves and lets the host on.
    saveEventGuestPack.mockResolvedValue({ note: "Door code 4548", items: [], updatedAt: null });
    await expect(flushGuestPack(EVENT)).resolves.toEqual({ ok: true, saved: true });
    await act(async () => tree.unmount());
  });

  test("the 5-link cap hides Add a link; order buttons reorder; remove asks first", async () => {
    fetchEventGuestPack.mockResolvedValue({
      note: null,
      items: ["A", "B", "C", "D"].map((l) => ({ label: l, url: `https://example.test/${l}` })),
      updatedAt: null,
    });
    const tree = await mount(EVENT);
    await press(tree, "Guest pack, ticket holders only");
    await press(tree, "Add a link");
    expect(byLabel(tree, "Add a link")).toHaveLength(0);
    expect(texts(tree).some((t) => t.startsWith("That's the limit: 5 links."))).toBe(true);
    // The working copy refuses a 6th link even if something calls it directly.
    expect(addGuestPackItem(EVENT)).toBeNull();

    expect(one(tree, "Move A up").props.disabled).toBe(true);
    await press(tree, "Move A down");
    expect(one(tree, "Label for link 1").props.value).toBe("B");
    expect(one(tree, "Label for link 2").props.value).toBe("A");

    await press(tree, "Remove B");
    expect(one(tree, "Label for link 1").props.value).toBe("B");
    expect(texts(tree)).toContain("Remove this link?");
    await press(tree, "Keep this link");
    expect(byLabel(tree, /^Label for link \d$/)).toHaveLength(5);
    await press(tree, "Remove B");
    await press(tree, "Remove this link");
    expect(byLabel(tree, /^Label for link \d$/)).toHaveLength(4);
    expect(one(tree, "Label for link 1").props.value).toBe("A");
    await act(async () => tree.unmount());
  });
});
