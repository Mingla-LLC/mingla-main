// MINGLA-INVARIANT: I-ADDON-EDITOR-STATES | issue #3281 | The Host Add-ons editor shows loading, a retryable load error, an empty state, the list, an offline lock on Save and the section 7 copy for every refusal, and a PT409 save reloads the latest list.
/**
 * issue #3281 S3 — the REAL AddOnsEditorSheet, rendered, with its data hooks,
 * network state, photo picker and the sheet primitives at the boundary.
 *
 * Fails on revert: send only the edited add-on, skip the refetch on PT409,
 * let Save run offline, or drop the photo upload paths from the save -> red.
 */

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Query = {
  isPending: boolean;
  isError: boolean;
  data: unknown;
  error: { code: string } | null;
  refetch: jest.Mock;
};
const state: { query: Query; offline: boolean } = {
  query: { isPending: true, isError: false, data: undefined, error: null, refetch: jest.fn() },
  offline: false,
};
const mutateAsync = jest.fn(async (_input: unknown): Promise<unknown> => undefined);
const pickAddOnPhoto = jest.fn(async (): Promise<unknown> => null);
const uploadAddOnPhoto = jest.fn(async (_input: unknown): Promise<unknown> => undefined);

jest.mock("../../../hooks/useOfferingAddOns", () => ({
  useOfferingAddOns: () => state.query,
  useSaveOfferingAddOns: () => ({ mutateAsync, isPending: false }),
}));
jest.mock("../../../lib/netinfoSafe", () => ({
  useNetInfoSafe: () => ({ isConnected: !state.offline }),
}));
jest.mock("../../../services/offeringAddOnsService", () => {
  class OfferingAddOnsError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    OfferingAddOnsError,
    addOnPhotoPublicUrl: (path: string) => `https://cdn.test/${path}`,
    uploadAddOnPhoto: (input: unknown) => uploadAddOnPhoto(input),
  };
});
jest.mock("../addOnPhoto", () => ({ pickAddOnPhoto: () => pickAddOnPhoto() }));
jest.mock("../../ui/Sheet", () => ({
  Sheet: (props: { visible: boolean; children?: React.ReactNode }) =>
    props.visible ? React.createElement("MockSheet", props, props.children) : null,
}));
jest.mock("../../ui/SheetScrollLayout", () => ({
  SheetScrollLayout: (props: { children?: React.ReactNode; footer?: React.ReactNode }) =>
    React.createElement("MockLayout", null, props.children, props.footer),
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) => React.createElement("MockButton", props),
}));
jest.mock("../../ui/Switch", () => ({
  Switch: (props: Record<string, unknown>) => React.createElement("MockSwitch", props),
}));

// eslint-disable-next-line import/first
import { AddOnsEditorSheet } from "../AddOnsEditorSheet";
// eslint-disable-next-line import/first
import { parseOfferingAddOns } from "../addOnsEditorModel";
// eslint-disable-next-line import/first
import { OfferingAddOnsError } from "../../../services/offeringAddOnsService";

type Node = { type: unknown; props: Record<string, unknown>; children: Array<Node | string> };
type Tree = { root: { findAll: (p: (n: Node) => boolean) => Node[] }; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const EVENT = "32813000-0000-4000-8300-000000000004";
const PAID = "32813000-0000-4000-8300-000000000012";
const FRIDAY = "32813000-0000-4000-8300-000000000013";
const payload = (addOns: unknown[] = []): ReturnType<typeof parseOfferingAddOns> =>
  parseOfferingAddOns({
    eventId: EVENT,
    eventType: "event",
    revision: 4,
    multiLinkEnabled: false,
    freeParentEnabled: false,
    currency: "USD",
    dates: [],
    targets: [
      { kind: "ticket_type", ticketTypeId: PAID, name: "Paid entry", isFree: false, priceCents: 1000, validOccurrenceKeys: null },
      { kind: "ticket_type", ticketTypeId: FRIDAY, name: "Friday", isFree: false, priceCents: 1500, validOccurrenceKeys: null },
    ],
    addOns,
  });
const DINNER = {
  id: "a1", name: "Dinner", description: null, priceCents: 2500, isUnlimited: false, quantityTotal: 40,
  maxPerTicket: 2, validOccurrenceKeys: null, photoPath: null, photoThumbPath: null, showOnPublicPage: true,
  sortOrder: 0, soldCount: 0, soldOccurrenceKeys: [], targets: [{ kind: "ticket_type", ticketTypeId: PAID }],
};

const ready = (data: unknown): void => {
  state.query = { isPending: false, isError: false, data, error: null, refetch: jest.fn() };
};
const mount = async (): Promise<Tree> => {
  let tree!: Tree;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <AddOnsEditorSheet visible onClose={() => undefined} eventId={EVENT} offering="event" />,
    );
  });
  return tree;
};
const text = (tree: Tree, needle: string): boolean =>
  tree.root.findAll((n) => n.children.some((c) => typeof c === "string" && c.includes(needle))).length > 0;
const button = (tree: Tree, label: string): Node => {
  const found = tree.root.findAll((n) => n.type === "MockButton" && n.props.label === label);
  expect(found.length).toBeGreaterThan(0);
  return found[0];
};
const byId = (tree: Tree, id: string): Node => {
  const found = tree.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === "function" || n.props.testID === id && typeof n.props.onChangeText === "function");
  expect(found.length).toBeGreaterThan(0);
  return found[0];
};
const press = async (node: Node): Promise<void> => {
  await TestRenderer.act(async () => {
    await (node.props.onPress as () => unknown)();
  });
};
const typeInto = async (tree: Tree, id: string, value: string): Promise<void> => {
  await TestRenderer.act(() => {
    (byId(tree, id).props.onChangeText as (v: string) => void)(value);
  });
};

beforeEach(() => {
  state.offline = false;
  mutateAsync.mockReset();
  pickAddOnPhoto.mockReset();
  uploadAddOnPhoto.mockReset();
});

describe("the Add-ons editor", () => {
  test("loading, then a load error that retries", async () => {
    state.query = { isPending: true, isError: false, data: undefined, error: null, refetch: jest.fn() };
    const loading = await mount();
    expect(text(loading, "Loading add-ons…")).toBe(true);
    loading.unmount();
    const refetch = jest.fn();
    state.query = { isPending: false, isError: true, data: undefined, error: { code: "unknown" }, refetch };
    const failed = await mount();
    expect(text(failed, "Add-ons didn't load, so they can't be changed right now. Saving the rest still works.")).toBe(true);
    await press(button(failed, "Retry"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  test("empty, then a new add-on saved as the whole list in minor units", async () => {
    ready(payload());
    mutateAsync.mockResolvedValue(payload([DINNER]));
    const tree = await mount();
    expect(text(tree, "No add-ons yet. Add one for things like dinner, a tote or a transfer.")).toBe(true);
    await press(button(tree, "Add-on"));
    expect(button(tree, "Save").props.disabled).toBe(true);
    await typeInto(tree, "add-on-name", "Dinner");
    await typeInto(tree, "add-on-price", "25.50");
    await press(byId(tree, `add-on-target-tt:${PAID}`));
    expect(button(tree, "Save").props.disabled).toBe(false);
    await press(button(tree, "Save"));
    expect(mutateAsync).toHaveBeenCalledWith({
      expectedRevision: 4,
      addOns: [expect.objectContaining({
        name: "Dinner", priceCents: 2550, isUnlimited: true, quantityTotal: null, maxPerTicket: 1,
        targets: [{ kind: "ticket_type", ticketTypeId: PAID }], showOnPublicPage: true,
      })],
    });
    // Back on the list.
    expect(text(tree, "New add-on")).toBe(false);
  });

  test("one ticket while multi-link is off: a second pick replaces the first", async () => {
    ready(payload());
    const tree = await mount();
    await press(button(tree, "Add-on"));
    await press(byId(tree, `add-on-target-tt:${PAID}`));
    await press(byId(tree, `add-on-target-tt:${FRIDAY}`));
    const checked = tree.root.findAll(
      (n) => typeof n.props.testID === "string" && (n.props.testID as string).startsWith("add-on-target-") &&
        (n.props.accessibilityState as { checked?: boolean } | undefined)?.checked === true,
    );
    expect([...new Set(checked.map((n) => n.props.testID))]).toEqual([`add-on-target-tt:${FRIDAY}`]);
  });

  test("editing keeps the other add-ons in the save; a PT409 shows the copy and reloads", async () => {
    const tote = { ...DINNER, id: "a2", name: "Tote", priceCents: 0, isUnlimited: true, quantityTotal: null };
    ready(payload([DINNER, tote]));
    mutateAsync.mockRejectedValue(new OfferingAddOnsError("add_ons_changed_elsewhere"));
    const tree = await mount();
    await press(byId(tree, "add-on-row-a2"));
    await typeInto(tree, "add-on-name", "Tote bag");
    await press(button(tree, "Save"));
    const sent = mutateAsync.mock.calls[0][0] as { addOns: { id?: string; name: string }[] };
    expect(sent.addOns.map((a) => [a.id, a.name])).toEqual([["a1", "Dinner"], ["a2", "Tote bag"]]);
    expect(text(tree, "Someone else changed these add-ons. We've loaded the latest; check and save again.")).toBe(true);
    expect(state.query.refetch).toHaveBeenCalledTimes(1);
  });

  test("offline: the note shows and nothing can be saved", async () => {
    ready(payload([DINNER]));
    state.offline = true;
    const tree = await mount();
    expect(text(tree, "You're offline. Changes aren't saved yet.")).toBe(true);
    expect(button(tree, "Add-on").props.disabled).toBe(true);
    await press(byId(tree, "add-on-row-a1"));
    expect(button(tree, "Save").props.disabled).toBe(true);
    await press(button(tree, "Save"));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  test("a photo is made on the device, uploaded, and its paths ride the save", async () => {
    ready(payload([DINNER]));
    mutateAsync.mockResolvedValue(payload([DINNER]));
    pickAddOnPhoto.mockResolvedValue({ full: new Uint8Array([1]), thumb: new Uint8Array([2]), previewUri: "file:///t.jpg" });
    uploadAddOnPhoto.mockResolvedValue({
      photoPath: `add-ons/${EVENT}/p.jpg`,
      photoThumbPath: `add-ons/${EVENT}/p_thumb.jpg`,
    });
    const tree = await mount();
    await press(byId(tree, "add-on-row-a1"));
    await press(byId(tree, "add-on-photo"));
    expect(uploadAddOnPhoto).toHaveBeenCalledWith(expect.objectContaining({ eventId: EVENT }));
    await press(button(tree, "Save"));
    const sent = mutateAsync.mock.calls[0][0] as { addOns: Record<string, unknown>[] };
    expect(sent.addOns[0]).toMatchObject({
      photoPath: `add-ons/${EVENT}/p.jpg`,
      photoThumbPath: `add-ons/${EVENT}/p_thumb.jpg`,
    });
  });

  test("a failed upload says so and keeps the form", async () => {
    ready(payload([DINNER]));
    pickAddOnPhoto.mockResolvedValue({ full: new Uint8Array([1]), thumb: new Uint8Array([2]), previewUri: "file:///t.jpg" });
    uploadAddOnPhoto.mockRejectedValue(new Error("network"));
    const tree = await mount();
    await press(byId(tree, "add-on-row-a1"));
    await press(byId(tree, "add-on-photo"));
    expect(text(tree, "Upload failed. Tap to try again.")).toBe(true);
    expect(text(tree, "Edit add-on")).toBe(true);
  });

  test("every pressable has an accessibility label", async () => {
    ready(payload([DINNER]));
    const tree = await mount();
    await press(byId(tree, "add-on-row-a1"));
    const pressables = tree.root.findAll(
      (n) => typeof n.props.onPress === "function" && typeof n.type !== "string",
    );
    for (const node of pressables) {
      expect(typeof node.props.accessibilityLabel).toBe("string");
    }
  });
});
