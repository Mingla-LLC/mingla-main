/** #3440 independent retest: real recovery/reply owners under partial storage failure.
 * Required stock Business Jest discovery; only transport/native primitives mocked.
 * No browser/device or server-authorisation claim is made by this mounted harness.
 */
import React from "react";
import { Platform, View } from "react-native";
import { RsvpDecisionBox, useRsvpOfferingState, type RsvpOfferingState, type RsvpOfferingBodyProps } from "@mingla/offering-rendering/RsvpOfferingBody";
import { createThemePalette } from "@mingla/offering-rendering/themePalette";
import { resolveTheme } from "@mingla/offering-rendering/themeResolver";
import { useRsvpGuestRecovery } from "../useRsvpGuestRecovery";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockVerify = jest.fn();
jest.mock("../../../services/rsvpPassRecoveryService", () => ({ fetchPublicRsvpPassMetadata: (...args: unknown[]) => mockVerify(...args) }));
jest.mock("react-native", () => {
  const base = jest.requireActual("../../../../__manual_mocks__/react-native.js");
  const curve = (x: number) => x;
  return { ...base, Easing: { inOut: () => curve, out: () => curve, in: () => curve, ease: curve, linear: curve }, AccessibilityInfo: { announceForAccessibility: jest.fn(), setAccessibilityFocus: jest.fn() } };
});
jest.mock("react-native-svg", () => ({ __esModule: true, default: () => null, Circle: () => null, Path: () => null, Rect: () => null, G: () => null }), { virtual: true });
jest.mock("react-native-qrcode-svg", () => ({ __esModule: true, default: () => null }), { virtual: true });
type Tree = { update: (node: React.ReactElement) => void; unmount: () => void };
const { create, act } = require("react-test-renderer") as { create: (node: React.ReactElement) => Tree; act: (callback: () => void | Promise<void>) => Promise<void> };
const NOW = Date.parse("2026-09-15T07:00:00Z");
const KEY = "mingla.rsvp.guest.v1:night-a";
const IDENTITY = "mingla.rsvp.identity.v1";
const theme = resolveTheme(null, null);
const palette = createThemePalette(theme);
const values = new Map<string, string>();
const storage = {
  getItem: jest.fn((key: string) => values.get(key) ?? null),
  setItem: jest.fn((key: string, value: string) => { values.set(key, value); }),
  removeItem: jest.fn((key: string) => { values.delete(key); }),
  key: (index: number) => [...values.keys()][index] ?? null,
  get length() { return values.size; },
};
const oldSnapshot = () => ({ version: 1, eventId: "night-a", rsvpId: "same-id", guestStatus: "going", guestApproval: "approved", savedAtMs: NOW,
  details: { eventName: "Night A", dateLine: "Saturday", venueLine: "Test Venue", guestName: "Original visitor", status: "going", plusGuests: [], confirmationToken: null,
    credentials: [{ entityType: "primary", entityId: "same-id", displayName: "Original visitor", qrCode: "old-private-qr", pdfFetchRef: "old-pdf" }],
    anonymousRecovery: [{ entityType: "primary", entityId: "same-id", recoveryToken: "old-secret", recoveryUrl: null }] } });
const deferred = () => {
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((_resolve, fail) => { reject = fail; });
  return { promise, reject };
};
let current: RsvpOfferingState;
const submit = jest.fn();
const trees: Tree[] = [];
function Harness({ identity = null, eventId = "night-a" }: { identity?: string | null; eventId?: string }) {
  const recovery = useRsvpGuestRecovery(eventId, identity, true);
  // Match PublicEventPage -> FoundationRsvpPreview: recovery is the parent
  // owner, and the shared reply hook lives in a separately mounted child.
  return <ReplyHarness eventId={eventId} identity={identity} recovery={recovery} />;
}
function ReplyHarness({ identity, eventId, recovery }: { identity: string | null; eventId: string; recovery: ReturnType<typeof useRsvpGuestRecovery> }) {
  const config = { capacity: 80, goingCount: 1, allowPlusOnes: false, plusOnesMax: 0, waitlistEnabled: true, manualApproval: false };
  current = useRsvpOfferingState({ event: { id: eventId, name: eventId, dateLine: "Saturday", description: "", format: "in-person", venueName: "Test Venue", address: "Test Street", hideAddressUntilTicket: false, currency: "USD", tickets: [] } as unknown as RsvpOfferingBodyProps["event"],
    brand: null, palette, theme, config, isLoggedIn: identity !== null, replyIdentity: identity,
    initialGuestName: "New visitor", initialGuestEmail: "visitor@example.test", initialGuestPhone: "+15551234567",
    restoredRsvp: recovery.restoredRsvp, recoveryNotice: recovery.recoveryNotice, onRsvpResolved: recovery.onResolved, onSubmit: submit });
  return <View><RsvpDecisionBox palette={palette} theme={theme} config={config} state={current} />{current.successPopup}</View>;
}
const mount = async (identity: string | null = null) => {
  let tree!: Tree;
  await act(async () => { tree = create(<Harness identity={identity} />); });
  trees.push(tree);
  return tree;
};
const unmount = async (tree: Tree) => { await act(async () => { tree.unmount(); }); trees.splice(trees.indexOf(tree), 1); };
const popup = () => (current.successPopup as React.ReactElement<{ children: React.ReactElement<any> }>).props.children.props;
const acceptNew = async () => {
  await act(async () => { current.onGoingTap(); });
  await act(async () => { await (current.confirmDialog as React.ReactElement<{ children: React.ReactElement<any> }>).props.children.props.onConfirm(); });
};
beforeEach(() => {
  jest.replaceProperty(Platform, "OS", "web");
  jest.spyOn(Date, "now").mockReturnValue(NOW);
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: storage } });
  values.clear(); jest.clearAllMocks();
  storage.getItem.mockImplementation((key) => values.get(key) ?? null);
  storage.setItem.mockImplementation((key, value) => { values.set(key, value); });
  storage.removeItem.mockImplementation((key) => { values.delete(key); });
  mockVerify.mockReset().mockResolvedValue({});
  submit.mockReset().mockResolvedValue({ status: "going", approvalStatus: "approved", rsvpId: "same-id", confirmationToken: null,
    credentials: [{ entityType: "primary", entityId: "same-id", displayName: "New visitor", qrCode: "new-private-qr", pdfFetchRef: "new-pdf" }], anonymousRecovery: [] });
});
afterEach(async () => { for (const tree of [...trees]) await unmount(tree); jest.restoreAllMocks(); });

test.each([403, 404, 409])("failed snapshot write: accepted same-ID revision survives delayed %i while persisted bytes remain unchanged", async (status) => {
  const check = deferred(); mockVerify.mockReturnValue(check.promise);
  const original = JSON.stringify(oldSnapshot()); values.set(KEY, original);
  await mount();
  storage.setItem.mockImplementation((key, value) => { if (key === KEY) throw new Error("quota exceeded"); values.set(key, value); });
  submit.mockResolvedValueOnce({ status: "not_going", approvalStatus: "approved", rsvpId: "same-id", confirmationToken: null, credentials: [], anonymousRecovery: [] });
  await act(async () => { current.onNotGoing(); });
  await acceptNew();
  expect(popup().details.credentials[0].qrCode).toBe("new-private-qr");
  expect(values.get(KEY)).toBe(original);
  await act(async () => { check.reject({ context: { status } }); });
  expect(current.guestStatus).toBe("going");
  expect(popup().visible).toBe(true);
  expect(popup().details.credentials[0].qrCode).toBe("new-private-qr");
  expect(current.validationHint).toBeNull();
  expect(values.get(KEY)).toBe(original);
});

test.each([403, 404, 409])("failed removal after current %i cannot resurrect a denied private pass on same-tab remount", async (status) => {
  const check = deferred(); mockVerify.mockReturnValueOnce(check.promise);
  values.set(KEY, JSON.stringify(oldSnapshot()));
  const tree = await mount();
  // #3416 D1: an unconfirmed restored pass can no longer be opened; only the reply shows.
  expect(current.guestStatus).toBe("going"); expect(current.passAction).toBeNull();
  storage.removeItem.mockImplementation(() => { throw new Error("storage removal unavailable"); });
  await act(async () => { check.reject({ context: { status } }); });
  expect(current.passAction).toBeNull(); expect(popup().visible).toBe(false); expect(popup().details).toBeNull();
  await unmount(tree);
  // A new verification is deliberately unresolved: a locally denied credential
  // must not become visible again merely because deletion failed previously.
  mockVerify.mockReturnValue(new Promise(() => undefined));
  await mount();
  expect(current.passAction).toBeNull();
  expect(current.guestStatus).toBeNull();
});

test("failed identity-marker write followed by failed logout removal cannot expose A's credentials on anonymous remount", async () => {
  values.set("unrelated-cart", "keep");
  storage.setItem.mockImplementation((key, value) => { if (key === IDENTITY) throw new Error("identity marker write unavailable"); values.set(key, value); });
  const tree = await mount("account-a");
  expect(current.passAction).toBeNull(); // first failed read/write path fails closed
  await acceptNew();
  expect(popup().details.credentials[0].qrCode).toBe("new-private-qr");
  expect(JSON.parse(values.get(KEY)!).details.credentials[0].qrCode).toBe("new-private-qr");
  storage.setItem.mockImplementation((key, value) => { values.set(key, value); });
  // A remains mounted. Logout removal now fails; old bytes remain on disk.
  storage.removeItem.mockImplementation(() => { throw new Error("storage removal unavailable"); });
  await act(async () => { tree.update(<Harness identity={null} />); });
  expect(current.passAction).toBeNull();
  expect(values.has(IDENTITY)).toBe(false);
  await unmount(tree);
  await mount();
  expect(current.passAction).toBeNull();
  expect(current.guestStatus).toBeNull();
  expect(values.get("unrelated-cart")).toBe("keep");
});

test("failed write of an accepted Can't go reply cannot restore the superseded Going pass on same-tab remount", async () => {
  values.set(KEY, JSON.stringify(oldSnapshot()));
  const tree = await mount();
  storage.setItem.mockImplementation((key, value) => { if (key === KEY) throw new Error("quota exceeded"); values.set(key, value); });
  submit.mockResolvedValueOnce({ status: "not_going", approvalStatus: "approved", rsvpId: "same-id", confirmationToken: null, credentials: [], anonymousRecovery: [] });
  await act(async () => { current.onNotGoing(); });
  expect(current.guestStatus).toBe("not_going"); expect(current.passAction).toBeNull();
  await unmount(tree);
  mockVerify.mockReturnValue(new Promise(() => undefined));
  await mount();
  expect(current.passAction).toBeNull();
  expect(current.guestStatus).not.toBe("going");
});

test("getItem failure is fail-closed, but a fresh accepted RSVP remains usable in memory", async () => {
  values.set(KEY, JSON.stringify(oldSnapshot()));
  storage.getItem.mockImplementation(() => { throw new Error("storage read denied"); });
  await mount();
  expect(current.passAction).toBeNull(); expect(mockVerify).not.toHaveBeenCalled();
  await acceptNew(); expect(current.guestStatus).toBe("going"); expect(popup().details.credentials[0].qrCode).toBe("new-private-qr");
});

test("a late denied verifier from event A cannot remove A's stored reply after switching to B", async () => {
  const check = deferred(); mockVerify.mockReturnValue(check.promise);
  const original = JSON.stringify(oldSnapshot()); values.set(KEY, original);
  const tree = await mount();
  await act(async () => { tree.update(<Harness eventId="night-b" />); });
  await act(async () => { check.reject({ context: { status: 403 } }); });
  expect(current.guestStatus).toBeNull(); expect(current.validationHint).toBeNull(); expect(popup().visible).toBe(false);
  expect(values.get(KEY)).toBe(original);
});
