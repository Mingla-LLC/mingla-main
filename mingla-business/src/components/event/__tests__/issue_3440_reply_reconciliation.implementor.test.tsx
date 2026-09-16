/** #3440 author controls: real recovery + reply owners, mocked transport only.
 * Discovered by the required stock Business Jest workflow on every PR.
 */
import React from "react";
import { Platform, View } from "react-native";
import {
  RsvpDecisionBox, RsvpOfferingFloatingBar, useRsvpOfferingState,
  type RsvpOfferingBodyProps, type RsvpOfferingState, type RsvpSubmitResult,
} from "@mingla/offering-rendering/RsvpOfferingBody";
import { createThemePalette } from "@mingla/offering-rendering/themePalette";
import { resolveTheme } from "@mingla/offering-rendering/themeResolver";
import type { RsvpGuestSnapshot } from "@mingla/offering-rendering/rsvpGuestSnapshot";
import { useRsvpGuestRecovery } from "../useRsvpGuestRecovery";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockMetadata = jest.fn();
const mockAnnounce = jest.fn();
const mockNativeFocus = jest.fn();
jest.mock("../../../services/rsvpPassRecoveryService", () => ({
  fetchPublicRsvpPassMetadata: (...args: unknown[]) => mockMetadata(...args),
}));
jest.mock("react-native", () => {
  const base = jest.requireActual("../../../../__manual_mocks__/react-native.js");
  const curve = (value: number) => value;
  return { ...base, Easing: { inOut: () => curve, out: () => curve, in: () => curve, ease: curve, linear: curve },
    findNodeHandle: () => 17,
    AccessibilityInfo: { announceForAccessibility: (...args: unknown[]) => mockAnnounce(...args), setAccessibilityFocus: (...args: unknown[]) => mockNativeFocus(...args) } };
});
jest.mock("react-native-svg", () => ({ __esModule: true, default: () => null, Circle: () => null, Path: () => null, Rect: () => null, G: () => null }), { virtual: true });
jest.mock("react-native-qrcode-svg", () => ({ __esModule: true, default: () => null }), { virtual: true });
type Node = { type: unknown; props: Record<string, any>; children: Array<Node | string>; findAll: (predicate: (node: Node) => boolean) => Node[] };
type Renderer = { root: Node; update: (node: React.ReactElement) => void; unmount: () => void };
const TestRenderer = require("react-test-renderer") as { create: (node: React.ReactElement, options: any) => Renderer; act: (callback: () => void | Promise<void>) => Promise<void> };
const { act } = TestRenderer;
const theme = resolveTheme(null, null);
const palette = createThemePalette(theme);
const NOW = Date.parse("2026-09-15T07:00:00Z");
const key = (id = "night-a") => `mingla.rsvp.guest.v1:${id}`;
const denied = "This saved pass is no longer available. Check your RSVP with the host.";
const offline = "We couldn't check your RSVP right now. Your saved reply is still here. Refresh to try again.";
const snapshot = (id = "night-a"): RsvpGuestSnapshot => ({
  version: 1, eventId: id, rsvpId: "same-id", guestStatus: "going", guestApproval: "approved", savedAtMs: NOW - 10,
  details: { eventName: id, dateLine: "Saturday", venueLine: "Lantern Room", guestName: "Ada", status: "going", plusGuests: [], confirmationToken: null,
    credentials: [{ entityType: "primary", entityId: "same-id", displayName: "Ada", qrCode: "old-qr", pdfFetchRef: "old-pdf" }],
    anonymousRecovery: [{ entityType: "primary", entityId: "same-id", recoveryToken: "old-token", recoveryUrl: null }] },
});
const accepted = (): RsvpSubmitResult => ({ status: "going", approvalStatus: "approved", rsvpId: "same-id", confirmationToken: null,
  credentials: [{ entityType: "primary", entityId: "same-id", displayName: "Ada", qrCode: "new-qr", pdfFetchRef: "new-pdf" }], anonymousRecovery: [] });
const pending = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const storage = new Map<string, string>();
const store = { getItem: jest.fn((name: string) => storage.get(name) ?? null), setItem: jest.fn((name: string, value: string) => void storage.set(name, value)),
  removeItem: jest.fn((name: string) => void storage.delete(name)), key: (index: number) => Array.from(storage.keys())[index] ?? null, get length() { return storage.size; } };
const onSubmit = jest.fn();
const onDownload = jest.fn();
let state: RsvpOfferingState;
const focus = jest.fn();
const trees: Renderer[] = [];
type HarnessProps = { id?: string; identity?: string | null; empty?: boolean };
function Harness({ id = "night-a", identity = null, empty = false }: HarnessProps) {
  const recovery = useRsvpGuestRecovery(id, identity, true);
  const config = { capacity: 50, goingCount: 1, allowPlusOnes: true, plusOnesMax: 2, waitlistEnabled: true, manualApproval: false };
  state = useRsvpOfferingState({ event: { id, name: id, dateLine: "Saturday", description: "", format: "in-person", venueName: "Lantern Room", address: "Main Street", hideAddressUntilTicket: false, currency: "USD", tickets: [] } as unknown as RsvpOfferingBodyProps["event"],
    brand: null, palette, theme, config, isLoggedIn: identity !== null, replyIdentity: identity,
    initialGuestName: empty ? "" : identity ?? "Ada", initialGuestEmail: empty ? "" : `${identity ?? "ada"}@example.test`, initialGuestPhone: empty ? "" : "+15551234567",
    restoredRsvp: recovery.restoredRsvp, recoveryNotice: recovery.recoveryNotice, onRsvpResolved: recovery.onResolved, onSubmit, onDownloadPass: onDownload,
  });
  return <View><RsvpDecisionBox palette={palette} theme={theme} config={config} state={state} /><RsvpOfferingFloatingBar palette={palette} theme={theme} config={config} state={state} />{state.successPopup}</View>;
}
const mount = async (props: HarnessProps = {}) => {
  let tree!: Renderer;
  await act(async () => { tree = TestRenderer.create(<Harness {...props} />, { createNodeMock: () => ({ focus, setAttribute: jest.fn() }) }); });
  trees.push(tree);
  return tree;
};
const update = async (tree: Renderer, props: HarnessProps = {}) => { await act(async () => { tree.update(<Harness {...props} />); }); };
const nodes = (tree: Renderer, testID: string) => tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === testID);
const popup = () => (state.successPopup as React.ReactElement<{ children: React.ReactElement<any> }>).props.children.props;
const confirm = () => (state.confirmDialog as React.ReactElement<{ children: React.ReactElement<any> }>).props.children.props.onConfirm();
beforeEach(() => {
  jest.replaceProperty(Platform, "OS", "web");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: store } });
  jest.spyOn(Date, "now").mockReturnValue(NOW);
  storage.clear(); jest.clearAllMocks();
  mockMetadata.mockReset().mockResolvedValue({});
  onSubmit.mockReset().mockResolvedValue(accepted());
});
afterEach(async () => { for (const tree of trees.splice(0)) await act(async () => { tree.unmount(); }); jest.restoreAllMocks(); });

test("current denial removes the open private popup and returns focus once to a decision, with one recovery announcement", async () => {
  const check = pending<unknown>(); mockMetadata.mockReturnValue(check.promise); storage.set(key(), JSON.stringify(snapshot()));
  const tree = await mount();
  await act(async () => { state.passAction!.onPress(); });
  await act(async () => { check.reject({ context: { status: 403 } }); });
  expect(popup().visible).toBe(false); expect(popup().details).toBeNull(); expect(state.guestStatus).toBeNull();
  expect(state.validationHint).toBe(denied); expect(focus).toHaveBeenCalledTimes(1); expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  const hints = nodes(tree, "rsvp-decision-validation-hint");
  expect(hints.filter((node) => node.props.accessibilityRole === "alert")).toHaveLength(1);
  await update(tree); expect(focus).toHaveBeenCalledTimes(1);
});

test("offline feedback retains the pass, does not focus, and validation takes precedence", async () => {
  mockMetadata.mockRejectedValue(new Error("offline")); storage.set(key(), JSON.stringify(snapshot()));
  const tree = await mount({ empty: true });
  expect(state.validationHint).toBe(offline); expect(state.passAction).not.toBeNull(); expect(storage.has(key())).toBe(true); expect(focus).not.toHaveBeenCalled();
  await act(async () => { state.onGoingTap(); });
  expect(state.validationHint).toBe("Add your name, email and phone number above to RSVP.");
  await update(tree, { id: "night-b", empty: true }); expect(state.validationHint).toBeNull();
});

test("a newly accepted same-ID pass and open popup survive the old revision's denial, including persistence", async () => {
  const check = pending<unknown>(); mockMetadata.mockReturnValue(check.promise); storage.set(key(), JSON.stringify(snapshot()));
  await mount();
  onSubmit.mockResolvedValueOnce({ ...accepted(), status: "not_going", credentials: [] });
  await act(async () => { state.onNotGoing(); });
  await act(async () => { state.onGoingTap(); });
  await act(async () => { confirm(); });
  expect(popup().details.credentials[0].qrCode).toBe("new-qr");
  const newest = storage.get(key());
  await act(async () => { check.reject({ context: { status: 409 } }); });
  expect(state.guestStatus).toBe("going"); expect(popup().visible).toBe(true); expect(popup().details.credentials[0].qrCode).toBe("new-qr");
  expect(storage.get(key())).toBe(newest); expect(state.validationHint).toBeNull(); expect(focus).not.toHaveBeenCalled();
});

test("event change fences a delayed accepted submit and retains the new event's invite", async () => {
  const submit = pending<RsvpSubmitResult>(); onSubmit.mockReturnValue(submit.promise);
  const tree = await mount(); await act(async () => { state.onMaybe(); });
  await update(tree, { id: "night-b" });
  await act(async () => { submit.resolve({ ...accepted(), status: "maybe" }); });
  expect(state.guestStatus).toBeNull(); expect(state.submitting).toBe(false); expect(storage.has(key())).toBe(false); expect(storage.has(key("night-b"))).toBe(false);
});

test("account A to B fences old rejection, resets contacts/confirmation, and supports a fresh B reply", async () => {
  const submit = pending<RsvpSubmitResult>(); onSubmit.mockReturnValue(submit.promise);
  const tree = await mount({ identity: "account-a" }); await act(async () => { state.onMaybe(); });
  await update(tree, { identity: "account-b" });
  await act(async () => { submit.reject(new Error("rsvp_full")); });
  expect(state.errorNode).toBeNull(); expect(state.submitting).toBe(false); expect(state.guestStatus).toBeNull();
  onSubmit.mockResolvedValue({ ...accepted(), status: "maybe" });
  await act(async () => { state.onMaybe(); });
  expect(onSubmit.mock.calls[1][0]).toMatchObject({ guestName: "account-b", guestEmail: "account-b@example.test" });
  expect(state.guestStatus).toBe("maybe");
});

test("unmounted submit has no persistence authority", async () => {
  const submit = pending<RsvpSubmitResult>(); onSubmit.mockReturnValue(submit.promise);
  const tree = await mount(); await act(async () => { state.onMaybe(); });
  await act(async () => { tree.unmount(); }); trees.splice(trees.indexOf(tree), 1);
  await act(async () => { submit.resolve(accepted()); }); expect(storage.has(key())).toBe(false);
});

test("same anonymous tab remount restores its own pass; account change purges every RSVP key but preserves other tab data", async () => {
  storage.set(key(), JSON.stringify(snapshot())); storage.set(key("night-b"), JSON.stringify(snapshot("night-b"))); storage.set("unrelated", "keep");
  const tree = await mount(); expect(state.passAction).not.toBeNull();
  await act(async () => { tree.unmount(); }); trees.splice(trees.indexOf(tree), 1);
  const returned = await mount(); expect(state.passAction).not.toBeNull();
  await update(returned, { identity: "account-b" });
  expect(state.passAction).toBeNull(); expect(storage.has(key())).toBe(false); expect(storage.has(key("night-b"))).toBe(false); expect(storage.get("unrelated")).toBe("keep");
});

test("returning A to B to A is a new generation: old A denial cannot delete the current restored A pass", async () => {
  const old = pending<unknown>(); mockMetadata.mockReturnValueOnce(old.promise).mockResolvedValue({}); storage.set(key(), JSON.stringify(snapshot()));
  const tree = await mount(); await update(tree, { id: "night-b" }); await update(tree);
  await act(async () => { old.reject({ context: { status: 404 } }); });
  expect(state.passAction).not.toBeNull(); expect(storage.has(key())).toBe(true); expect(state.validationHint).toBeNull();
});

test("denial of a closed popup never steals focus", async () => {
  const check = pending<unknown>(); mockMetadata.mockReturnValue(check.promise); storage.set(key(), JSON.stringify(snapshot()));
  await mount(); await act(async () => { check.reject({ context: { status: 404 } }); });
  expect(state.validationHint).toBe(denied); expect(focus).not.toHaveBeenCalled();
});

test.each(["ios", "android"] as const)("%s uses no browser recovery and resets the open accepted popup on account change", async (platform) => {
  jest.replaceProperty(Platform, "OS", platform);
  const tree = await mount({ identity: "account-a" });
  await act(async () => { state.onGoingTap(); }); await act(async () => { confirm(); });
  expect(popup().visible).toBe(true);
  await update(tree, { identity: "account-b" });
  expect(popup().visible).toBe(false); expect(popup().details).toBeNull(); expect(state.guestStatus).toBeNull();
  expect(store.getItem).not.toHaveBeenCalled(); expect(store.setItem).not.toHaveBeenCalled(); expect(mockNativeFocus).toHaveBeenCalledTimes(1);
});

test("blocked tab storage keeps the fresh accepted reply in memory", async () => {
  Object.defineProperty(window, "sessionStorage", { get: () => { throw new Error("blocked"); } });
  await mount(); await act(async () => { state.onGoingTap(); }); await act(async () => { confirm(); });
  expect(popup().details.credentials[0].qrCode).toBe("new-qr"); expect(state.passAction).not.toBeNull();
});

test("logout clears typed contacts, plus-one drafts and a pending confirmation before anonymous interaction", async () => {
  const tree = await mount({ identity: "account-a" });
  await act(async () => { nodes(tree, "orch-1150-rsvp-going")[0].props.onPress(); });
  expect((state.confirmDialog as React.ReactElement<{ children: React.ReactElement<any> }>).props.children.props.visible).toBe(true);
  await update(tree, { empty: true });
  expect((state.confirmDialog as React.ReactElement<{ children: React.ReactElement<any> }>).props.children.props.visible).toBe(false);
  expect(nodes(tree, "orch-1150-rsvp-name")[0].props.value).toBe("");
  expect(nodes(tree, "orch-1150-rsvp-email")[0].props.value).toBe("");
  expect(nodes(tree, "orch-1150-rsvp-phone")[0].props.value).toBe("");
  await act(async () => { nodes(tree, "orch-1157-rsvp-plus-plus")[0].props.onPress(); });
  expect(state.plusCount).toBe(1);
  await update(tree, { identity: "account-b" }); expect(state.plusCount).toBe(0);
  await act(async () => { state.onMaybe(); });
  expect(onSubmit.mock.calls[0][0]).toMatchObject({ guestName: "account-b", guests: [], plusCount: 0 });
});

test("a pending PDF presentation receives a predicate that loses authority when its open pass is invalidated", async () => {
  const check = pending<unknown>(); mockMetadata.mockReturnValue(check.promise); storage.set(key(), JSON.stringify(snapshot()));
  await mount(); await act(async () => { state.passAction!.onPress(); });
  await act(async () => { await popup().onDownloadPass(snapshot().details!.credentials[0], null); });
  const ownsPass = onDownload.mock.calls[0][2] as () => boolean;
  expect(ownsPass()).toBe(true);
  await act(async () => { check.reject({ context: { status: 403 } }); });
  expect(ownsPass()).toBe(false);
});

test("queued callbacks from a departed account cannot reopen its pass or strand the new account in Saving", async () => {
  storage.set(key(), JSON.stringify(snapshot()));
  const tree = await mount({ identity: "account-a" });
  const oldPass = state.passAction!.onPress;
  const oldReply = state.onMaybe;
  const oldConfirm = (state.confirmDialog as React.ReactElement<{ children: React.ReactElement<any> }>).props.children.props.onConfirm;
  await update(tree, { identity: "account-b" });
  await act(async () => { oldPass(); oldReply(); oldConfirm(); });
  expect(popup().visible).toBe(false); expect(state.submitting).toBe(false); expect(state.guestStatus).toBeNull(); expect(onSubmit).not.toHaveBeenCalled();
});
