/** PR #3416 / #3440 — INDEPENDENT retest of head 034b86abe (second tester).
 *
 * Mounts the REAL `useRsvpGuestRecovery` owner and the REAL shared
 * `useRsvpOfferingState` reply owner as siblings, exactly as
 * PublicEventPage -> FoundationRsvpPreview wires them. Only transport
 * (pass-service verify, submit) and native primitives are stubbed.
 *
 * Two groups:
 *  - GUARD-*  : properties the rework claims; expected GREEN.
 *  - DEFECT-* : properties a privacy-sensitive pass surface needs that this head
 *               does NOT meet; each is expected RED at 034b86abe and is the
 *               evidence for a finding in the retest report.
 */
import React from "react";
import { Platform, View } from "react-native";
import {
  RsvpDecisionBox,
  useRsvpOfferingState,
  type RsvpOfferingBodyProps,
  type RsvpOfferingState,
} from "@mingla/offering-rendering/RsvpOfferingBody";
import { createThemePalette } from "@mingla/offering-rendering/themePalette";
import { resolveTheme } from "@mingla/offering-rendering/themeResolver";
import { useRsvpGuestRecovery, RSVP_RECOVERY_DENIED, RSVP_RECOVERY_OFFLINE } from "../useRsvpGuestRecovery";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockVerify = jest.fn();
jest.mock("../../../services/rsvpPassRecoveryService", () => ({
  fetchPublicRsvpPassMetadata: (...args: unknown[]) => mockVerify(...args),
}));
jest.mock("react-native", () => {
  const base = jest.requireActual("../../../../__manual_mocks__/react-native.js");
  const curve = (x: number) => x;
  return {
    ...base,
    Easing: { inOut: () => curve, out: () => curve, in: () => curve, ease: curve, linear: curve },
    AccessibilityInfo: { announceForAccessibility: jest.fn(), setAccessibilityFocus: jest.fn() },
  };
});
jest.mock("react-native-svg", () => ({ __esModule: true, default: () => null, Circle: () => null, Path: () => null, Rect: () => null, G: () => null }), { virtual: true });
jest.mock("react-native-qrcode-svg", () => ({ __esModule: true, default: () => null }), { virtual: true });

type Tree = { update: (node: React.ReactElement) => void; unmount: () => void };
const { create, act } = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Tree;
  act: (callback: () => void | Promise<void>) => Promise<void>;
};

const NOW = Date.parse("2026-09-15T07:00:00Z");
const EVENT_A = "night-a";
const EVENT_B = "night-b";
const keyFor = (eventId: string) => `mingla.rsvp.guest.v1:${eventId}`;
const IDENTITY = "mingla.rsvp.identity.v1";
const theme = resolveTheme(null, null);
const palette = createThemePalette(theme);

/** One browser tab's sessionStorage (fresh per tab; copied on "duplicate tab"). */
type FakeStorage = {
  values: Map<string, string>;
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
  key: (index: number) => string | null;
  readonly length: number;
};
const makeStorage = (seed?: Map<string, string>): FakeStorage => {
  const values = new Map(seed ?? []);
  return {
    values,
    getItem: jest.fn((key: string) => values.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: jest.fn((key: string) => { values.delete(key); }),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
};
/** A tab == a JS runtime (new `window` object) + its own sessionStorage. */
const openTab = (storage: FakeStorage): void => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: storage } });
};
/** Full reload in the same tab: same storage, new JS runtime. */
const reload = (storage: FakeStorage): void => openTab(storage);

const credential = (id: string, qr: string) => ({ entityType: "primary" as const, entityId: id, displayName: "Guest", qrCode: qr, pdfFetchRef: id });
const snapshot = (overrides: Record<string, unknown> = {}, details: Record<string, unknown> = {}) => ({
  version: 1, eventId: EVENT_A, rsvpId: "rsvp-a", guestStatus: "going", guestApproval: "approved", savedAtMs: NOW - 60_000,
  details: {
    eventName: "Night A", dateLine: "Saturday", venueLine: "Test Venue", guestName: "Guest", status: "going", plusGuests: [], confirmationToken: null,
    credentials: [credential("rsvp-a", "stored-qr-a")],
    anonymousRecovery: [{ entityType: "primary", entityId: "rsvp-a", recoveryToken: "token-a", recoveryUrl: null }],
    ...details,
  },
  ...overrides,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};

let current: RsvpOfferingState;
let recoveryOut: ReturnType<typeof useRsvpGuestRecovery>;
const submit = jest.fn();
const trees: Tree[] = [];
type HarnessProps = { identity?: string | null; eventId?: string; contributionState?: "idle" | "paid" };
function Harness({ identity = null, eventId = EVENT_A, contributionState }: HarnessProps) {
  // PublicEventPage: useRsvpGuestRecovery(event.id, user?.id ?? null, isRsvp)
  const recovery = useRsvpGuestRecovery(eventId, identity, true);
  recoveryOut = recovery;
  return <Reply eventId={eventId} identity={identity} recovery={recovery} contributionState={contributionState} />;
}
function Reply({ identity, eventId, recovery, contributionState }: { identity: string | null; eventId: string; recovery: ReturnType<typeof useRsvpGuestRecovery>; contributionState?: "idle" | "paid" }) {
  const config = { capacity: 80, goingCount: 1, allowPlusOnes: false, plusOnesMax: 0, waitlistEnabled: true, manualApproval: false };
  current = useRsvpOfferingState({
    event: { id: eventId, name: eventId, dateLine: "Saturday", description: "", format: "in-person", venueName: "Test Venue", address: "Test Street", hideAddressUntilTicket: false, currency: "USD", tickets: [] } as unknown as RsvpOfferingBodyProps["event"],
    brand: null, palette, theme, config, isLoggedIn: identity !== null, replyIdentity: identity,
    initialGuestName: "Visitor", initialGuestEmail: "visitor@example.test", initialGuestPhone: "+15551234567",
    restoredRsvp: recovery.restoredRsvp, recoveryNotice: recovery.recoveryNotice, onRsvpResolved: recovery.onResolved, onSubmit: submit,
    onChipIn: jest.fn(), contributionState,
  });
  return <View><RsvpDecisionBox palette={palette} theme={theme} config={config} state={current} />{current.successPopup}</View>;
}
const mount = async (props: HarnessProps = {}) => {
  let tree!: Tree;
  await act(async () => { tree = create(<Harness {...props} />); });
  trees.push(tree);
  return tree;
};
const update = async (tree: Tree, props: HarnessProps) => { await act(async () => { tree.update(<Harness {...props} />); }); };
const unmount = async (tree: Tree) => { await act(async () => { tree.unmount(); }); trees.splice(trees.indexOf(tree), 1); };
const popup = () => (current.successPopup as React.ReactElement<{ children: React.ReactElement<any> }>).props.children.props as { visible: boolean; details: { credentials: { qrCode: string | null }[] } | null };
const shownQr = (): string | null => {
  const p = popup();
  return p.visible && p.details !== null ? (p.details.credentials[0]?.qrCode ?? null) : null;
};
const openPass = async () => { await act(async () => { current.passAction?.onPress(); }); };
const acceptGoing = async (qr: string, recoveryToken: string | null = null) => {
  submit.mockResolvedValueOnce({
    status: "going", approvalStatus: "approved", rsvpId: `rsvp-${qr}`, confirmationToken: null,
    credentials: [credential(`rsvp-${qr}`, qr)],
    anonymousRecovery: recoveryToken === null ? [] : [{ entityType: "primary", entityId: `rsvp-${qr}`, recoveryToken, recoveryUrl: null }],
  });
  await act(async () => { current.onGoingTap(); });
  await act(async () => { await (current.confirmDialog as React.ReactElement<{ children: React.ReactElement<any> }>).props.children.props.onConfirm(); });
};
/** True when any RSVP payload in `storage` would hand `qr` to someone. */
const anyStoredQr = (storage: FakeStorage, qr: string) => [...storage.values.values()].some((v) => v.includes(qr));

let tab: FakeStorage;
beforeEach(() => {
  jest.replaceProperty(Platform, "OS", "web");
  jest.spyOn(Date, "now").mockReturnValue(NOW);
  jest.clearAllMocks();
  tab = makeStorage();
  openTab(tab);
  mockVerify.mockReset().mockResolvedValue({ entityType: "primary", entityId: "rsvp-a", displayName: "Guest", qrCode: "stored-qr-a", pdfFetchRef: "rsvp-a" });
  submit.mockReset();
});
afterEach(async () => {
  for (const tree of [...trees]) await unmount(tree);
  jest.restoreAllMocks();
});

// ───────────────────────── identity transitions ─────────────────────────

test("GUARD-1 same tab: A accepts, logs out, B logs in — A's QR never reaches anonymous or B (mounted and after reload)", async () => {
  const tree = await mount({ identity: "account-a" });
  await acceptGoing("qr-account-a");
  expect(shownQr()).toBe("qr-account-a");
  expect(anyStoredQr(tab, "qr-account-a")).toBe(true);

  await update(tree, { identity: null });
  expect(current.passAction).toBeNull();
  expect(shownQr()).toBeNull();
  expect(current.guestStatus).toBeNull();

  await update(tree, { identity: "account-b" });
  expect(current.passAction).toBeNull();
  expect(shownQr()).toBeNull();
  expect(anyStoredQr(tab, "qr-account-a")).toBe(false);

  await unmount(tree);
  reload(tab);
  await mount({ identity: "account-b" });
  expect(current.passAction).toBeNull();
  expect(current.guestStatus).toBeNull();
});

test("GUARD-2 A→logout→B with every removal failing: A's bytes stay on disk but never render for anonymous or B, even after reload", async () => {
  const tree = await mount({ identity: "account-a" });
  await acceptGoing("qr-account-a");
  tab.removeItem.mockImplementation(() => { throw new Error("removal blocked"); });
  await update(tree, { identity: null });
  expect(shownQr()).toBeNull();
  await update(tree, { identity: "account-b" });
  expect(current.passAction).toBeNull();
  await unmount(tree);
  expect(anyStoredQr(tab, "qr-account-a")).toBe(true); // the purge really failed

  await mount({ identity: "account-b" }); // same runtime remount
  expect(current.passAction).toBeNull();
  await unmount(trees[0]);
  reload(tab); // new runtime: page memory of the failed purge is gone
  await mount({ identity: "account-b" });
  expect(current.passAction).toBeNull();
  await unmount(trees[0]);
  // Even if an attacker/extension rewrites the marker to B, the owner stamp blocks it.
  tab.values.set(IDENTITY, JSON.stringify("account-b"));
  reload(tab);
  await mount({ identity: "account-b" });
  expect(current.passAction).toBeNull();
  expect(mockVerify).not.toHaveBeenCalled();
});

test("GUARD-3 anonymous → signed in → anonymous: neither identity's pass crosses over, mounted or after reload", async () => {
  const tree = await mount({ identity: null });
  await acceptGoing("qr-anon", "anon-token");
  expect(shownQr()).toBe("qr-anon");

  await update(tree, { identity: "account-a" });
  expect(shownQr()).toBeNull();
  expect(current.passAction).toBeNull();
  await acceptGoing("qr-account-a");
  expect(shownQr()).toBe("qr-account-a");

  await update(tree, { identity: null });
  expect(shownQr()).toBeNull();
  expect(current.passAction).toBeNull();
  expect(anyStoredQr(tab, "qr-account-a")).toBe(false);

  await unmount(tree);
  reload(tab);
  await mount({ identity: null });
  expect(current.passAction).toBeNull();
  await unmount(trees[0]);
  reload(tab);
  await mount({ identity: "account-a" });
  expect(current.passAction).toBeNull();
});

// ───────────────────────── storage failure modes ─────────────────────────

test("GUARD-4 QuotaExceededError on the snapshot write: accepted reply stays in memory; remount restores nothing older", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  const tree = await mount();
  const quota = Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError", code: 22 });
  tab.setItem.mockImplementation((key: string, value: string) => { if (key.startsWith("mingla.rsvp.guest")) throw quota; tab.values.set(key, value); });
  await acceptGoing("qr-newer", "newer-token");
  expect(current.guestStatus).toBe("going");
  expect(shownQr()).toBe("qr-newer");
  await unmount(tree);
  await mount();
  expect(current.passAction).toBeNull();
  expect(current.guestStatus).toBeNull();
});

test("GUARD-5 QuotaExceededError on the identity-marker write: nothing restores, a fresh reply still works", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  tab.setItem.mockImplementation((key: string, value: string) => { if (key === IDENTITY) throw Object.assign(new Error("quota"), { name: "QuotaExceededError" }); tab.values.set(key, value); });
  await mount();
  expect(current.passAction).toBeNull();
  expect(mockVerify).not.toHaveBeenCalled();
  await acceptGoing("qr-fresh", "fresh-token");
  expect(shownQr()).toBe("qr-fresh");
});

test("GUARD-6 Safari-private / blocked storage: the sessionStorage getter itself throws — no crash, no restore, reply usable", async () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: Object.defineProperty({}, "sessionStorage", { get() { throw Object.assign(new Error("The operation is insecure."), { name: "SecurityError" }); } }),
  });
  const tree = await mount();
  expect(current.guestStatus).toBeNull();
  await acceptGoing("qr-private", "private-token");
  expect(shownQr()).toBe("qr-private");
  await unmount(tree);
  await mount();
  expect(current.passAction).toBeNull();
  expect(mockVerify).not.toHaveBeenCalled();
});

test("GUARD-7 every storage method throws on every call: no crash across mount, accept, identity change, remount", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  const boom = () => { throw Object.assign(new Error("denied"), { name: "SecurityError" }); };
  tab.getItem.mockImplementation(boom); tab.setItem.mockImplementation(boom); tab.removeItem.mockImplementation(boom);
  Object.defineProperty(tab, "key", { value: boom });
  const tree = await mount();
  expect(current.passAction).toBeNull();
  await acceptGoing("qr-mem", "mem-token");
  expect(shownQr()).toBe("qr-mem");
  await update(tree, { identity: "account-a" });
  expect(shownQr()).toBeNull();
  await unmount(tree);
  await mount();
  expect(current.passAction).toBeNull();
});

// ───────────────────────── tampered / copied payloads ─────────────────────────

test("GUARD-8 a payload copied verbatim under another event's key is refused", async () => {
  tab.values.set(keyFor(EVENT_B), JSON.stringify(snapshot())); // eventId still night-a
  await mount({ eventId: EVENT_B });
  expect(current.passAction).toBeNull();
  expect(current.guestStatus).toBeNull();
  expect(mockVerify).not.toHaveBeenCalled();
});

test.each([
  ["future savedAtMs", snapshot({ savedAtMs: NOW + 1 })],
  ["expired (>24h)", snapshot({ savedAtMs: NOW - 24 * 60 * 60 * 1000 - 1 })],
  ["wrong version", snapshot({ version: 2 })],
  ["foreign owner stamp", { ...snapshot(), owner: JSON.stringify("someone-else") }],
  ["non-string QR", snapshot({}, { credentials: [{ ...credential("rsvp-a", "x"), qrCode: 42 }] })],
  ["array root", [snapshot()]],
])("GUARD-9 tampered payload is refused: %s", async (_label, payload) => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(payload));
  await mount();
  expect(current.passAction).toBeNull();
  expect(current.guestStatus).toBeNull();
});

// ───────────────────────── verification outcomes ─────────────────────────

test.each([403, 404, 409])("GUARD-10 verify %i: restored pass is dropped, denial notice shown, remount does not restore", async (status) => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  mockVerify.mockRejectedValue({ context: { status } });
  const tree = await mount();
  expect(current.passAction).toBeNull();
  expect(recoveryOut.recoveryNotice).toBe(RSVP_RECOVERY_DENIED);
  expect(tab.values.has(keyFor(EVENT_A))).toBe(false);
  await unmount(tree);
  await mount();
  expect(current.passAction).toBeNull();
});

test("GUARD-11 slow verify, then navigate away (unmount) before it settles: no update after unmount, no storage mutation", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  const check = deferred<unknown>();
  mockVerify.mockReturnValue(check.promise);
  const tree = await mount();
  expect(current.guestStatus).toBe("going");
  await unmount(tree);
  // Spy only after mount: react-test-renderer's own deprecation notice is not a finding.
  const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
  await act(async () => { check.reject({ context: { status: 403 } }); });
  expect(errors).not.toHaveBeenCalled();
  expect(tab.values.has(keyFor(EVENT_A))).toBe(true);
});

test("GUARD-12 two independent tabs: tab 2 never sees tab 1's reply; a duplicated tab's logout purges only its own copy", async () => {
  const tab1 = tab;
  const t1 = await mount({ identity: null });
  await acceptGoing("qr-tab1", "tab1-token");
  expect(anyStoredQr(tab1, "qr-tab1")).toBe(true);

  // Tab 2: a new tab (Chromium ≥89 does not copy sessionStorage for noopener links).
  const tab2 = makeStorage();
  openTab(tab2);
  const t2 = await mount({ identity: null });
  expect(current.passAction).toBeNull();
  await unmount(t2);

  // Tab 3: "Duplicate tab" copies sessionStorage (identity marker included).
  const tab3 = makeStorage(tab1.values);
  openTab(tab3);
  mockVerify.mockResolvedValue({});
  const t3 = await mount({ identity: null });
  expect(current.guestStatus).toBe("going");
  // Tab 3 signs in as A (auth is localStorage-shared, so tab 1 follows below).
  await update(t3, { identity: "account-a" });
  expect(current.passAction).toBeNull();
  expect(anyStoredQr(tab3, "qr-tab1")).toBe(false);
  expect(anyStoredQr(tab1, "qr-tab1")).toBe(true); // other tab's storage untouched
  await unmount(t3);

  openTab(tab1);
  // Tab 1 is a different runtime in reality; it receives SIGNED_IN via the storage event.
  await update(t1, { identity: "account-a" });
  expect(current.passAction).toBeNull();
  expect(anyStoredQr(tab1, "qr-tab1")).toBe(false);
});

test("GUARD-13 spoofed ?contribution=paid (contributionState=paid) with no reply: no reply state, no pass, no write, no verify", async () => {
  await mount({ contributionState: "paid" });
  expect(current.guestStatus).toBeNull();
  expect(current.passAction).toBeNull();
  expect(shownQr()).toBeNull();
  expect(tab.setItem.mock.calls.filter(([k]: [string]) => k.startsWith("mingla.rsvp.guest"))).toHaveLength(0);
  expect(mockVerify).not.toHaveBeenCalled();
});

test("GUARD-14 spoofed ?contribution=paid over ANOTHER identity's stored reply still restores nothing", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify({ ...snapshot(), owner: JSON.stringify("account-a") }));
  tab.values.set(IDENTITY, JSON.stringify("account-a"));
  await mount({ identity: null, contributionState: "paid" });
  expect(current.passAction).toBeNull();
  expect(current.guestStatus).toBeNull();
});

// ───────────────────────── DEFECTS (expected RED at 034b86abe) ─────────────────────────

test("DEFECT-A pending verification: a restored reply must not render its QR before the pass service confirms it (host-revoked pass)", async () => {
  // The host revoked this guest; the service WILL answer 409 — but slowly.
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  const check = deferred<unknown>();
  mockVerify.mockReturnValue(check.promise);
  await mount();
  await openPass();
  const qrWhilePending = shownQr();
  await act(async () => { check.reject({ context: { status: 409 } }); });
  expect(shownQr()).toBeNull(); // eventually closed…
  expect(qrWhilePending).toBeNull(); // …but it was scannable before the 409 arrived
});

test("DEFECT-B network error: a revoked pass stays openable indefinitely (offline keeps the QR)", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  mockVerify.mockRejectedValue({ context: new TypeError("Failed to fetch") });
  await mount();
  expect(recoveryOut.recoveryNotice).toBe(RSVP_RECOVERY_OFFLINE);
  await openPass();
  expect(shownQr()).toBeNull();
});

test("DEFECT-C signed-in reply is restored with NO verification at all (server returns no anonymousRecovery for signed-in guests)", async () => {
  // Exactly what public-submit-rsvp returns to a signed-in guest: anonymousRecovery: [].
  const tree = await mount({ identity: "account-a" });
  await acceptGoing("qr-account-a", null);
  await unmount(tree);
  reload(tab); // e.g. the chip-in Stripe return; the host then revokes A
  mockVerify.mockRejectedValue({ context: { status: 409 } });
  await mount({ identity: "account-a" });
  await openPass();
  // Either the reply is checked with the service, or it must not offer the QR.
  expect(mockVerify.mock.calls.length > 0 || shownQr() === null).toBe(true);
});

test("DEFECT-D a denial that lands after navigating away is discarded: the next visit re-offers the denied QR while re-verifying", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  const first = deferred<unknown>();
  mockVerify.mockReturnValueOnce(first.promise);
  const tree = await mount();
  await unmount(tree); // guest taps away before the 403 arrives
  await act(async () => { first.reject({ context: { status: 403 } }); });
  mockVerify.mockReturnValue(new Promise(() => undefined)); // slow again
  await mount();
  await openPass();
  expect(shownQr()).toBeNull();
});

test("DEFECT-E verification is not bound to the displayed QR: a tampered QR next to a valid recovery token renders after a 200", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot({}, { credentials: [credential("rsvp-a", "tampered-qr")] })));
  mockVerify.mockResolvedValue({ entityType: "primary", entityId: "rsvp-a", displayName: "Guest", qrCode: "canonical-qr", pdfFetchRef: "rsvp-a" });
  await mount();
  await act(async () => { await Promise.resolve(); });
  await openPass();
  expect(shownQr() === null || shownQr() === "canonical-qr").toBe(true);
});

test("DEFECT-F verification is not bound to the page's event: event A's entity rewritten to event B's key restores on B after a 200", async () => {
  tab.values.set(keyFor(EVENT_B), JSON.stringify(snapshot({ eventId: EVENT_B })));
  await mount({ eventId: EVENT_B });
  await act(async () => { await Promise.resolve(); });
  expect(current.passAction).toBeNull();
});

test("DEFECT-G an ownerless payload bypasses the owner stamp: another account's QR restores for B when the marker says B", async () => {
  const { details } = snapshot({}, { credentials: [credential("rsvp-a", "qr-of-account-a")], anonymousRecovery: [] });
  tab.values.set(keyFor(EVENT_A), JSON.stringify({ ...snapshot(), details })); // no `owner` field
  tab.values.set(IDENTITY, JSON.stringify("account-b"));
  await mount({ identity: "account-b" });
  await openPass();
  expect(shownQr()).toBeNull();
});
