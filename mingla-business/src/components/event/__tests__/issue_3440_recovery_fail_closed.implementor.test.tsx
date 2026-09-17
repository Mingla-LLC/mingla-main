/** #3440 rework (F1/F2) author proofs: real recovery hook + real shared reply owner.
 * Complements the independent tester suites; only transport and native primitives
 * are mocked. Discovered by the stock mingla-business Jest run.
 *
 * I-1 fails if the stored reply's owner check is removed: after a reload wipes the
 *     page's memory, account A's reply must not restore for an anonymous visitor.
 *     It also fails if a signed-in account restores from tab storage (#3416 D2/D5).
 * I-2 fails if a successful accepted write does not clear the page's stale record:
 *     fail-closed must not swallow the guest's NEWER reply on a same-tab remount.
 * I-3 fails if an unconfirmed restore exposes a pass, or if the rendered pass is the
 *     stored copy instead of the one the service returned (#3416 D1/D4/D5).
 * I-4 fails if a denial that lands after the guest left is dropped (#3416 D3).
 * I-5 fails if a service answer for another entity or event is not a denial (#3416 D4).
 * I-6 fails if an answer that cannot be bound shows the stored pass, or if the
 *     retry does not ask the service again (#3416 D1/D4).
 */
import React from "react";
import { Platform, View } from "react-native";
import { RsvpDecisionBox, useRsvpOfferingState, type RsvpOfferingState, type RsvpOfferingBodyProps } from "@mingla/offering-rendering/RsvpOfferingBody";
import { createThemePalette } from "@mingla/offering-rendering/themePalette";
import { resolveTheme } from "@mingla/offering-rendering/themeResolver";
import { useRsvpGuestRecovery } from "../useRsvpGuestRecovery";
import { RSVP_RECOVERY_DENIED, RSVP_RECOVERY_OFFLINE } from "../useRsvpGuestRecovery";

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
const ownerlessSnapshot = () => ({ version: 1, eventId: "night-a", rsvpId: "same-id", guestStatus: "going", guestApproval: "approved", savedAtMs: NOW,
  details: { eventName: "Night A", dateLine: "Saturday", venueLine: "Test Venue", guestName: "Original visitor", status: "going", plusGuests: [], confirmationToken: null,
    credentials: [{ entityType: "primary", entityId: "same-id", displayName: "Original visitor", qrCode: "old-private-qr", pdfFetchRef: "old-pdf" }],
    anonymousRecovery: [{ entityType: "primary", entityId: "same-id", recoveryToken: "old-secret", recoveryUrl: null }] } });

let current: RsvpOfferingState;
let recoveryOut: ReturnType<typeof useRsvpGuestRecovery>;
/** #3416 D4: the pass service's answer, bound to the exact entity and event. */
const served = (overrides: Record<string, unknown> = {}) => ({ entityType: "primary", entityId: "same-id", displayName: "Served guest", qrCode: "served-qr", pdfFetchRef: "served-pdf", eventId: "night-a", ...overrides });
const deferred = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const submit = jest.fn();
const trees: Tree[] = [];
function Harness({ identity = null }: { identity?: string | null }) {
  const recovery = useRsvpGuestRecovery("night-a", identity, true);
  recoveryOut = recovery;
  return <ReplyHarness identity={identity} recovery={recovery} />;
}
function ReplyHarness({ identity, recovery }: { identity: string | null; recovery: ReturnType<typeof useRsvpGuestRecovery> }) {
  const config = { capacity: 80, goingCount: 1, allowPlusOnes: false, plusOnesMax: 0, waitlistEnabled: true, manualApproval: false };
  current = useRsvpOfferingState({ event: { id: "night-a", name: "night-a", dateLine: "Saturday", description: "", format: "in-person", venueName: "Test Venue", address: "Test Street", hideAddressUntilTicket: false, currency: "USD", tickets: [] } as unknown as RsvpOfferingBodyProps["event"],
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
const acceptGoing = async () => {
  await act(async () => { current.onGoingTap(); });
  await act(async () => { await (current.confirmDialog as React.ReactElement<{ children: React.ReactElement<any> }>).props.children.props.onConfirm(); });
};
/** A full page reload: same tab storage, but a new JS runtime (new window object). */
const reload = () => { Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: storage } }); };

beforeEach(() => {
  jest.replaceProperty(Platform, "OS", "web");
  jest.spyOn(Date, "now").mockReturnValue(NOW);
  reload();
  values.clear(); jest.clearAllMocks();
  storage.getItem.mockImplementation((key) => values.get(key) ?? null);
  storage.setItem.mockImplementation((key, value) => { values.set(key, value); });
  storage.removeItem.mockImplementation((key) => { values.delete(key); });
  mockVerify.mockReset().mockResolvedValue({});
  submit.mockReset().mockResolvedValue({ status: "going", approvalStatus: "approved", rsvpId: "same-id", confirmationToken: null,
    credentials: [{ entityType: "primary", entityId: "same-id", displayName: "Account A", qrCode: "account-a-private-qr", pdfFetchRef: "account-a-pdf" }], anonymousRecovery: [] });
});
afterEach(async () => { for (const tree of [...trees]) await unmount(tree); jest.restoreAllMocks(); });

test("I-1 after a reload, account A's stored reply never restores for A's signed-in page nor for an anonymous visitor", async () => {
  // A's reply is written while the identity marker cannot be stored.
  storage.setItem.mockImplementation((key, value) => { if (key === IDENTITY) throw new Error("marker blocked"); values.set(key, value); });
  const accountA = await mount("account-a");
  await acceptGoing();
  expect(JSON.parse(values.get(KEY)!).details.credentials[0].qrCode).toBe("account-a-private-qr");
  expect(values.has(IDENTITY)).toBe(false);
  await unmount(accountA);
  storage.setItem.mockImplementation((key, value) => { values.set(key, value); });

  // #3416 D2: the signed-in owner gets the invite, never a tab-storage restore.
  reload();
  const returnedA = await mount("account-a");
  expect(current.guestStatus).toBeNull();
  expect(current.passAction).toBeNull();
  expect(mockVerify).not.toHaveBeenCalled();
  await unmount(returnedA);

  // The marker is gone again (the page's memory too): only the reply's own
  // owner record can say whose bytes these are.
  values.delete(IDENTITY);
  reload();
  await mount(null);
  expect(values.get(KEY)).toBeDefined();
  expect(current.guestStatus).toBeNull();
  expect(current.passAction).toBeNull();
  expect(popup().details).toBeNull();
});

test("I-2 a failed write blocks the superseded bytes, and a later successful accepted reply restores on remount", async () => {
  values.set(KEY, JSON.stringify(ownerlessSnapshot()));
  const tree = await mount();
  storage.setItem.mockImplementationOnce((key, value) => { if (key === KEY) throw new Error("quota exceeded"); values.set(key, value); });
  submit.mockResolvedValueOnce({ status: "not_going", approvalStatus: "approved", rsvpId: "same-id", confirmationToken: null, credentials: [], anonymousRecovery: [] });
  await act(async () => { current.onNotGoing(); });
  expect(current.guestStatus).toBe("not_going");
  submit.mockResolvedValueOnce({ status: "going", approvalStatus: "approved", rsvpId: "same-id", confirmationToken: null,
    credentials: [{ entityType: "primary", entityId: "same-id", displayName: "New visitor", qrCode: "newest-private-qr", pdfFetchRef: "new-pdf" }],
    anonymousRecovery: [{ entityType: "primary", entityId: "same-id", recoveryToken: "new-secret", recoveryUrl: null }] });
  await acceptGoing();
  expect(JSON.parse(values.get(KEY)!).details.credentials[0].qrCode).toBe("newest-private-qr");
  await unmount(tree);

  mockVerify.mockResolvedValue(served({ displayName: "New visitor", qrCode: "newest-private-qr", pdfFetchRef: "new-pdf" }));
  await mount();
  expect(current.guestStatus).toBe("going");
  // The newest bytes are the ones restored and checked.
  expect(mockVerify).toHaveBeenLastCalledWith("primary", "same-id", "new-secret");
  await act(async () => { current.passAction!.onPress(); });
  expect(popup().details.credentials[0].qrCode).toBe("newest-private-qr");
});

test("I-3 an ownerless anonymous reply restores its label only, and its pass only as the service confirms it", async () => {
  const check = deferred(); mockVerify.mockReturnValue(check.promise);
  values.set(KEY, JSON.stringify(ownerlessSnapshot()));
  await mount();
  expect(current.guestStatus).toBe("going");
  expect(current.passAction).toBeNull();
  expect(mockVerify).toHaveBeenCalledWith("primary", "same-id", "old-secret");
  await act(async () => { check.resolve(served()); });
  expect(current.passAction).not.toBeNull();
  await act(async () => { current.passAction!.onPress(); });
  // Never the stored copy ("old-private-qr").
  expect(popup().details.credentials).toEqual([{ entityType: "primary", entityId: "same-id", displayName: "Served guest", qrCode: "served-qr", pdfFetchRef: "served-pdf" }]);
});

test("I-4 a denial that lands after the guest left still blocks those bytes for this page, without touching storage", async () => {
  const check = deferred(); mockVerify.mockReturnValueOnce(check.promise);
  const raw = JSON.stringify(ownerlessSnapshot());
  values.set(KEY, raw);
  const tree = await mount();
  expect(current.guestStatus).toBe("going");
  await unmount(tree);
  await act(async () => { check.reject({ context: { status: 403 } }); });
  expect(values.get(KEY)).toBe(raw);
  mockVerify.mockReturnValue(new Promise(() => undefined));
  await mount();
  expect(current.guestStatus).toBeNull();
  expect(current.passAction).toBeNull();
});

test.each([
  ["another entity", { entityId: "someone-else" }],
  ["another event", { eventId: "night-b" }],
])("I-5 a service answer for %s is a denial: no pass, the bytes are dropped, the guest is told", async (_label, overrides) => {
  mockVerify.mockResolvedValue(served(overrides));
  values.set(KEY, JSON.stringify(ownerlessSnapshot()));
  await mount();
  expect(current.guestStatus).toBeNull();
  expect(current.passAction).toBeNull();
  expect(recoveryOut.recoveryNotice).toBe(RSVP_RECOVERY_DENIED);
  expect(values.has(KEY)).toBe(false);
});

test("I-6 an answer that cannot be bound to this event keeps the reply, never the stored pass, and the retry asks again", async () => {
  const { eventId: _unbound, ...withoutEvent } = served();
  mockVerify.mockResolvedValueOnce(withoutEvent);
  values.set(KEY, JSON.stringify(ownerlessSnapshot()));
  await mount();
  expect(current.guestStatus).toBe("going");
  expect(current.passAction).toBeNull();
  expect(recoveryOut.recoveryNotice).toBe(RSVP_RECOVERY_OFFLINE);
  expect(recoveryOut.retryRecovery).not.toBeNull();
  expect(values.has(KEY)).toBe(true);
  mockVerify.mockResolvedValueOnce(served());
  await act(async () => { recoveryOut.retryRecovery!(); });
  expect(mockVerify).toHaveBeenCalledTimes(2);
  expect(recoveryOut.recoveryNotice).toBeNull();
  expect(recoveryOut.retryRecovery).toBeNull();
  await act(async () => { current.passAction!.onPress(); });
  expect(popup().details.credentials[0].qrCode).toBe("served-qr");
});
