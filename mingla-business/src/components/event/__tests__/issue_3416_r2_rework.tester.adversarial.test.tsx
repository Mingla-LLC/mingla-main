/** PR #3416 / #3440 — INDEPENDENT retest ROUND 2 of head fdcb1f307 (D1–D5 rework).
 *
 * Same wiring as issue_3416_recovery_retest (the REAL `useRsvpGuestRecovery`
 * owner beside the REAL shared `useRsvpOfferingState`, as PublicEventPage ->
 * FoundationRsvpPreview wires them), now also passing `onRecoveryRetry`.
 * Only transport (pass-service verify, submit) and native primitives are stubbed.
 *
 *  - R2-*      : adversarial timing / binding / retry properties of the rework; expected GREEN.
 *  - FINDING-* : a property the page should meet that this head does not; RED is the evidence.
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

type Tree = { update: (node: React.ReactElement) => void; unmount: () => void; root: { findAll: (p: (n: { props: Record<string, unknown> }) => boolean) => unknown[] } };
const { create, act } = require("react-test-renderer") as {
  create: (node: React.ReactElement, options?: { createNodeMock?: () => unknown }) => Tree;
  act: (callback: () => void | Promise<void>) => Promise<void>;
};

const NOW = Date.parse("2026-09-15T07:00:00Z");
const EVENT_A = "night-a";
const EVENT_B = "night-b";
const keyFor = (eventId: string) => `mingla.rsvp.guest.v1:${eventId}`;
const IDENTITY = "mingla.rsvp.identity.v1";
const theme = resolveTheme(null, null);
const palette = createThemePalette(theme);

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
const openTab = (storage: FakeStorage): void => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: storage } });
};

const credential = (id: string, qr: string) => ({ entityType: "primary" as const, entityId: id, displayName: "Stored Name", qrCode: qr, pdfFetchRef: id });
const snapshot = (overrides: Record<string, unknown> = {}, details: Record<string, unknown> = {}) => ({
  version: 1, eventId: EVENT_A, rsvpId: "rsvp-a", guestStatus: "going", guestApproval: "approved", savedAtMs: NOW - 60_000,
  details: {
    eventName: "Night A", dateLine: "Saturday", venueLine: "Test Venue", guestName: "Stored Name", status: "going", plusGuests: [], confirmationToken: null,
    credentials: [credential("rsvp-a", "stored-qr-a")],
    anonymousRecovery: [{ entityType: "primary", entityId: "rsvp-a", recoveryToken: "token-a", recoveryUrl: null }],
    ...details,
  },
  ...overrides,
});
/** What rsvp-pass-fetch (metadata) + rsvpPassRecoveryService return at fdcb1f307, bound to entity + event. */
const served = (overrides: Record<string, unknown> = {}) => ({
  entityType: "primary", entityId: "rsvp-a", displayName: "Served Name", qrCode: "served-qr-a", pdfFetchRef: "rsvp-a", eventId: EVENT_A, ...overrides,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const networkError = () => ({ name: "FunctionsFetchError", context: new TypeError("Failed to fetch") });

let current: RsvpOfferingState;
let recoveryOut: ReturnType<typeof useRsvpGuestRecovery>;
const submit = jest.fn();
const onDownload = jest.fn();
const trees: Tree[] = [];
type HarnessProps = { identity?: string | null; eventId?: string; contributionState?: "idle" | "paid" };
function Harness({ identity = null, eventId = EVENT_A, contributionState }: HarnessProps) {
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
    restoredRsvp: recovery.restoredRsvp, recoveryNotice: recovery.recoveryNotice, onRsvpResolved: recovery.onResolved,
    onRecoveryRetry: recovery.retryRecovery, onSubmit: submit, onDownloadPass: onDownload,
    onChipIn: jest.fn(), contributionState,
  } as RsvpOfferingBodyProps);
  return <View><RsvpDecisionBox palette={palette} theme={theme} config={config} state={current} />{current.successPopup}{current.confirmDialog}</View>;
}
const focus = jest.fn();
const mount = async (props: HarnessProps = {}) => {
  let tree!: Tree;
  await act(async () => { tree = create(<Harness {...props} />, { createNodeMock: () => ({ focus, setAttribute: jest.fn() }) }); });
  trees.push(tree);
  return tree;
};
const update = async (tree: Tree, props: HarnessProps) => { await act(async () => { tree.update(<Harness {...props} />); }); };
const unmount = async (tree: Tree) => { await act(async () => { tree.unmount(); }); trees.splice(trees.indexOf(tree), 1); };
type PopupProps = { visible: boolean; details: { guestName: string; credentials: { entityId: string; qrCode: string | null; pdfFetchRef: string }[]; anonymousRecovery: unknown[] } | null; onClose: () => void; onDownloadPass?: (c: unknown, r: unknown) => Promise<void> };
const popup = () => (current.successPopup as React.ReactElement<{ children: React.ReactElement<PopupProps> }>).props.children.props;
const shownQr = (): string | null => {
  const p = popup();
  return p.visible && p.details !== null ? (p.details.credentials[0]?.qrCode ?? null) : null;
};
const openPass = async () => { await act(async () => { current.passAction?.onPress(); }); };
/** Every QR the page could show right now: the open popup, or the pass behind "View your pass". */
const reachableQr = async (): Promise<string | null> => {
  if (shownQr() !== null) return shownQr();
  if (current.passAction === null) return null;
  await openPass();
  return shownQr();
};
/** Any rendered host prop that carries a stored credential string. */
const renderedAnywhere = (tree: Tree, needle: string) =>
  tree.root.findAll((n) => Object.values(n.props ?? {}).some((v) => typeof v === "string" && v.includes(needle))).length > 0;
const acceptGoing = async (qr: string, recoveryToken: string | null = null) => {
  submit.mockResolvedValueOnce({
    status: "going", approvalStatus: "approved", rsvpId: `rsvp-${qr}`, confirmationToken: null,
    credentials: [credential(`rsvp-${qr}`, qr)],
    anonymousRecovery: recoveryToken === null ? [] : [{ entityType: "primary", entityId: `rsvp-${qr}`, recoveryToken, recoveryUrl: null }],
  });
  await act(async () => { current.onGoingTap(); });
  await act(async () => { await (current.confirmDialog as React.ReactElement<{ children: React.ReactElement<any> }>).props.children.props.onConfirm(); });
};

let tab: FakeStorage;
beforeEach(() => {
  jest.replaceProperty(Platform, "OS", "web");
  jest.spyOn(Date, "now").mockReturnValue(NOW);
  jest.clearAllMocks();
  tab = makeStorage();
  openTab(tab);
  mockVerify.mockReset().mockReturnValue(new Promise(() => undefined));
  submit.mockReset();
  onDownload.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  for (const tree of [...trees]) await unmount(tree);
  jest.restoreAllMocks();
});

// ───────────────────────── D1: nothing before a confirmed answer ─────────────────────────

test("R2-01 pending verify: 'You're going' only — no View your pass, no Try again, no popup, stored QR in no rendered prop", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  const tree = await mount();
  expect(current.guestStatus).toBe("going");
  expect(current.passAction).toBeNull();
  expect(current.recoveryAction).toBeNull();
  expect(recoveryOut.restoredRsvp?.details).toBeNull();
  expect(popup().details).toBeNull();
  expect(renderedAnywhere(tree, "stored-qr-a")).toBe(false);
  expect(renderedAnywhere(tree, "token-a")).toBe(false);
});

test("R2-02 fast double tap on Going + a second confirm tap while submitting (restore pending): one submit, and only the NEW server QR ever shows", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  const check = deferred<unknown>();
  mockVerify.mockReturnValueOnce(check.promise);
  await mount();
  const seen: (string | null)[] = [];
  await act(async () => { current.onGoingTap(); current.onGoingTap(); });
  seen.push(await reachableQr());
  const reply = deferred<unknown>();
  submit.mockReturnValueOnce(reply.promise);
  const confirmNow = () => (current.confirmDialog as React.ReactElement<{ children: React.ReactElement<any> }>).props.children.props.onConfirm as () => Promise<void>;
  let firstTap!: Promise<void>;
  await act(async () => { firstTap = confirmNow()(); });
  seen.push(await reachableQr());
  await act(async () => { void confirmNow()(); }); // second tap reaches the re-rendered (submitting) handler
  // The stale restore check now answers 200 for the OLD pass while the new reply is in flight.
  await act(async () => { check.resolve(served({ qrCode: "old-pass-qr" })); });
  seen.push(shownQr());
  await act(async () => { reply.resolve({ status: "going", approvalStatus: "approved", rsvpId: "rsvp-a", confirmationToken: null, credentials: [credential("rsvp-a", "fresh-server-qr")], anonymousRecovery: [] }); await firstTap; });
  seen.push(shownQr());
  expect(submit).toHaveBeenCalledTimes(1);
  expect(seen.filter((q) => q !== null && q !== "fresh-server-qr")).toEqual([]);
  expect(seen.at(-1)).toBe("fresh-server-qr");
});

test("R2-03 remount mid-verify: the FIRST mount's late bound 200 never renders a QR on the second (still pending) mount", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  const first = deferred<unknown>();
  const second = deferred<unknown>();
  mockVerify.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const t1 = await mount();
  await unmount(t1);
  await mount();
  expect(mockVerify).toHaveBeenCalledTimes(2);
  await act(async () => { first.resolve(served()); });
  expect(current.guestStatus).toBe("going");
  expect(await reachableQr()).toBeNull();
  await act(async () => { second.reject(networkError()); });
  expect(await reachableQr()).toBeNull();
  expect(recoveryOut.recoveryNotice).toBe(RSVP_RECOVERY_OFFLINE);
  expect(current.recoveryAction).not.toBeNull();
});

test("R2-04 in-place navigation A→B while A's verify is pending: A's bound 200 lands on B — B (with its own pending restore) shows no pass", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  tab.values.set(keyFor(EVENT_B), JSON.stringify(snapshot({ eventId: EVENT_B, rsvpId: "rsvp-b" }, {
    credentials: [credential("rsvp-b", "stored-qr-b")],
    anonymousRecovery: [{ entityType: "primary", entityId: "rsvp-b", recoveryToken: "token-b", recoveryUrl: null }],
  })));
  const aCheck = deferred<unknown>();
  const bCheck = deferred<unknown>();
  mockVerify.mockReturnValueOnce(aCheck.promise).mockReturnValueOnce(bCheck.promise);
  const tree = await mount({ eventId: EVENT_A });
  await update(tree, { eventId: EVENT_B });
  expect(mockVerify).toHaveBeenLastCalledWith("primary", "rsvp-b", "token-b");
  await act(async () => { aCheck.resolve(served()); });
  expect(await reachableQr()).toBeNull();
  // B's service answers with the pass of event A (entity rewritten under B's key): a denial, not a pass.
  await act(async () => { bCheck.resolve(served({ entityId: "rsvp-b", qrCode: "qr-issued-for-a" })); });
  expect(await reachableQr()).toBeNull();
  expect(recoveryOut.recoveryNotice).toBe(RSVP_RECOVERY_DENIED);
});

test("R2-05 A→B→A while the first A verify is pending: the first answer cannot confirm the second A generation", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  const firstA = deferred<unknown>();
  const secondA = deferred<unknown>();
  mockVerify.mockReturnValueOnce(firstA.promise).mockReturnValueOnce(secondA.promise);
  const tree = await mount({ eventId: EVENT_A });
  await update(tree, { eventId: EVENT_B });
  await update(tree, { eventId: EVENT_A });
  expect(mockVerify).toHaveBeenCalledTimes(2);
  await act(async () => { firstA.resolve(served({ qrCode: "first-generation-qr" })); });
  expect(await reachableQr()).toBeNull();
  await act(async () => { secondA.resolve(served()); });
  expect(await reachableQr()).toBe("served-qr-a");
});

test("R2-06 identity change mid-verify (anonymous → signed-in A): the anonymous 200 lands — A sees no reply and no pass, before or after", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  const check = deferred<unknown>();
  mockVerify.mockReturnValueOnce(check.promise);
  const tree = await mount({ identity: null });
  await update(tree, { identity: "account-a" });
  expect(current.guestStatus).toBeNull();
  await act(async () => { check.resolve(served()); });
  expect(current.guestStatus).toBeNull();
  expect(await reachableQr()).toBeNull();
  await unmount(tree);
  await mount({ identity: "account-a" });
  expect(await reachableQr()).toBeNull();
});

test("R2-07 identity flip anonymous → A → anonymous mid-verify: the original 200 does not render on the returned anonymous page", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  const check = deferred<unknown>();
  mockVerify.mockReturnValueOnce(check.promise);
  const tree = await mount({ identity: null });
  await update(tree, { identity: "account-a" });
  await update(tree, { identity: null });
  await act(async () => { check.resolve(served()); });
  expect(await reachableQr()).toBeNull();
});

// ───────────────────────── D1: retry never falls back to the stored QR ─────────────────────────

test("R2-08 network error → Try again (pending) → error → Try again → 200: never the stored QR; only the service QR after the 200", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  const attempts = [deferred<unknown>(), deferred<unknown>(), deferred<unknown>()];
  attempts.forEach((a) => mockVerify.mockReturnValueOnce(a.promise));
  await mount();
  const seen: (string | null)[] = [];
  await act(async () => { attempts[0].reject(networkError()); });
  expect(current.recoveryAction?.label).toBe("Try again");
  expect(recoveryOut.recoveryNotice).toBe("We couldn't confirm your pass — try again.");
  seen.push(await reachableQr());
  await act(async () => { current.recoveryAction!.onPress(); });
  expect(mockVerify).toHaveBeenCalledTimes(2);
  expect(current.recoveryAction).toBeNull(); // pending again: no retry, no pass
  seen.push(await reachableQr());
  await act(async () => { attempts[1].reject(networkError()); });
  seen.push(await reachableQr());
  await act(async () => { current.recoveryAction!.onPress(); });
  seen.push(await reachableQr());
  await act(async () => { attempts[2].resolve(served()); });
  seen.push(await reachableQr());
  expect(seen).toEqual([null, null, null, null, "served-qr-a"]);
  expect(tab.values.get(keyFor(EVENT_A))).toContain("stored-qr-a"); // storage kept, just never rendered
});

test("R2-09 double tap Try again with a stale handler: a superseded 200 never confirms, the latest network error wins", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  const attempts = [deferred<unknown>(), deferred<unknown>(), deferred<unknown>()];
  attempts.forEach((a) => mockVerify.mockReturnValueOnce(a.promise));
  await mount();
  await act(async () => { attempts[0].reject(networkError()); });
  const stale = current.recoveryAction!.onPress;
  await act(async () => { stale(); });
  await act(async () => { stale(); }); // the second tap lands before the button re-renders away
  expect(mockVerify).toHaveBeenCalledTimes(3);
  await act(async () => { attempts[1].resolve(served({ qrCode: "superseded-qr" })); });
  expect(await reachableQr()).toBeNull();
  await act(async () => { attempts[2].reject(networkError()); });
  expect(await reachableQr()).toBeNull();
  expect(current.recoveryAction).not.toBeNull();
});

test("R2-10 a stale Try again handler from event A does nothing on event B", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  mockVerify.mockRejectedValueOnce(networkError());
  const tree = await mount({ eventId: EVENT_A });
  const staleBody = current.recoveryAction!.onPress;
  const staleHook = recoveryOut.retryRecovery!;
  await update(tree, { eventId: EVENT_B });
  const calls = mockVerify.mock.calls.length;
  await act(async () => { staleBody(); staleHook(); });
  expect(mockVerify.mock.calls.length).toBe(calls);
  expect(current.guestStatus).toBeNull();
  expect(await reachableQr()).toBeNull();
});

test("R2-11 after an offline notice the guest re-replies (Maybe): the retry disappears and a stale retry cannot bring a pass back", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  mockVerify.mockRejectedValueOnce(networkError());
  await mount();
  const staleHook = recoveryOut.retryRecovery!;
  submit.mockResolvedValueOnce({ status: "maybe", approvalStatus: "approved", rsvpId: "rsvp-a", confirmationToken: null, credentials: [], anonymousRecovery: [] });
  await act(async () => { current.onMaybe(); });
  expect(current.guestStatus).toBe("maybe");
  expect(current.recoveryAction).toBeNull();
  expect(recoveryOut.retryRecovery).toBeNull();
  mockVerify.mockResolvedValueOnce(served());
  await act(async () => { staleHook(); });
  expect(current.guestStatus).toBe("maybe");
  expect(await reachableQr()).toBeNull();
});

// ───────────────────────── D4: the service answer is validated before render ─────────────────────────

const table: [string, unknown, "denied" | "unconfirmed"][] = [
  ["another entityType", served({ entityType: "guest" }), "denied"],
  ["another entityId", served({ entityId: "rsvp-z" }), "denied"],
  ["another eventId", served({ eventId: EVENT_B }), "denied"],
  ["eventId null", served({ eventId: null }), "denied"],
  ["entityId as a number", served({ entityId: 7 }), "denied"],
  ["no entityType", (({ entityType: _x, ...rest }) => rest)(served()), "unconfirmed"],
  ["no entityId", (({ entityId: _x, ...rest }) => rest)(served()), "unconfirmed"],
  ["no eventId (edge function not yet deployed)", (({ eventId: _x, ...rest }) => rest)(served()), "unconfirmed"],
  ["empty qrCode", served({ qrCode: "" }), "unconfirmed"],
  ["null qrCode", served({ qrCode: null }), "unconfirmed"],
  ["numeric qrCode", served({ qrCode: 123 }), "unconfirmed"],
  ["no qrCode", (({ qrCode: _x, ...rest }) => rest)(served()), "unconfirmed"],
  ["null answer", null, "unconfirmed"],
  ["string answer", "ok", "unconfirmed"],
  ["empty object", {}, "unconfirmed"],
];
test.each(table.map(([label, answer, outcome]) => [label, outcome, answer] as const))("R2-12 service answer with %s → %s, and never a QR", async (_label, outcome, answer) => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  mockVerify.mockResolvedValueOnce(answer);
  await mount();
  expect(await reachableQr()).toBeNull();
  if (outcome === "denied") {
    expect(recoveryOut.recoveryNotice).toBe(RSVP_RECOVERY_DENIED);
    expect(current.guestStatus).toBeNull();
    expect(tab.values.has(keyFor(EVENT_A))).toBe(false);
  } else {
    expect(recoveryOut.recoveryNotice).toBe(RSVP_RECOVERY_OFFLINE);
    expect(current.guestStatus).toBe("going");
    expect(current.recoveryAction).not.toBeNull();
    expect(tab.values.has(keyFor(EVENT_A))).toBe(true);
  }
});

// NIT (non-blocking): the real service mints the QR server-side and never answers blanks.
test("NIT-1 whitespace-only qrCode from the service is not rendered as a pass", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  mockVerify.mockResolvedValueOnce(served({ qrCode: "   " }));
  await mount();
  expect(await reachableQr()).toBeNull();
});

test("R2-14 (DEFECT-E, bound) tampered stored QR beside a valid token: the bound 200 renders the SERVICE QR and name, never the stored ones", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot({}, { credentials: [credential("rsvp-a", "tampered-qr")], guestName: "Tampered Name" })));
  mockVerify.mockResolvedValueOnce(served({ qrCode: "canonical-qr" }));
  await mount();
  await openPass();
  expect(shownQr()).toBe("canonical-qr");
  expect(popup().details!.guestName).toBe("Served Name");
});

test("R2-15 (DEFECT-F, bound) event A's entity bytes rewritten under B's key: the service truthfully names event A → denial on B", async () => {
  tab.values.set(keyFor(EVENT_B), JSON.stringify(snapshot({ eventId: EVENT_B })));
  mockVerify.mockResolvedValueOnce(served()); // eventId: night-a
  await mount({ eventId: EVENT_B });
  expect(await reachableQr()).toBeNull();
  expect(recoveryOut.recoveryNotice).toBe(RSVP_RECOVERY_DENIED);
  expect(tab.values.has(keyFor(EVENT_B))).toBe(false);
});

test("R2-16 stored plus-one credentials and other entities' recovery tokens are dropped from the confirmed pass", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot({}, {
    credentials: [credential("rsvp-a", "stored-qr-a"), { ...credential("guest-1", "stored-plus-one-qr"), entityType: "guest" }],
    anonymousRecovery: [
      { entityType: "primary", entityId: "rsvp-a", recoveryToken: "token-a", recoveryUrl: null },
      { entityType: "guest", entityId: "guest-1", recoveryToken: "plus-one-token", recoveryUrl: null },
    ],
  })));
  mockVerify.mockResolvedValueOnce(served());
  await mount();
  await openPass();
  const details = popup().details!;
  expect(details.credentials.map((c) => c.qrCode)).toEqual(["served-qr-a"]);
  expect(JSON.stringify(details.anonymousRecovery)).not.toContain("plus-one-token");
});

// ───────────────────────── D3 ─────────────────────────

test("R2-17 D3 late denial after leaving blocks only the denied bytes, not a NEWER reply accepted on a later mount", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  const first = deferred<unknown>();
  mockVerify.mockReturnValueOnce(first.promise);
  const t1 = await mount();
  await unmount(t1);
  const t2 = await mount(); // restores the same bytes, pending forever
  (Date.now as jest.Mock).mockReturnValue(NOW + 5_000);
  await acceptGoing("newer-qr", "newer-token");
  await unmount(t2);
  await act(async () => { first.reject({ context: { status: 403 } }); }); // t1's denial of the OLD bytes lands now
  mockVerify.mockResolvedValueOnce(served({ entityId: "rsvp-newer-qr", pdfFetchRef: "rsvp-newer-qr", qrCode: "newer-qr" }));
  await mount();
  expect(mockVerify).toHaveBeenLastCalledWith("primary", "rsvp-newer-qr", "newer-token");
  expect(await reachableQr()).toBe("newer-qr");
});

// ───────────────────────── PDF authority (guard lost by the #3440 rewrite) ─────────────────────────

test("R2-18 closing a confirmed pass popup revokes an in-flight PDF's authority", async () => {
  tab.values.set(keyFor(EVENT_A), JSON.stringify(snapshot()));
  mockVerify.mockResolvedValueOnce(served());
  await mount();
  await openPass();
  await act(async () => { await popup().onDownloadPass!(popup().details!.credentials[0], null); });
  const ownsPass = onDownload.mock.calls[0][2] as () => boolean;
  expect(ownsPass()).toBe(true);
  await act(async () => { popup().onClose(); });
  expect(ownsPass()).toBe(false);
});

// ───────────────────────── focus return (guard orphaned by the #3440 rewrite) ─────────────────────────

test("R2-20 logout while the private pass popup is open (same event): popup closes and focus returns ONCE to the decision", async () => {
  const tree = await mount({ identity: "account-a" });
  await acceptGoing("qr-account-a", null);
  expect(shownQr()).toBe("qr-account-a");
  focus.mockClear();
  await update(tree, { identity: null });
  expect(shownQr()).toBeNull();
  expect(focus).toHaveBeenCalledTimes(1);
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  await update(tree, { identity: null });
  expect(focus).toHaveBeenCalledTimes(1);
});

// ───────────────────────── D2 limitation: signed-in chip-in return ─────────────────────────

test("R2-19 D2: a signed-in guest's own stamped reply is not restored after the chip-in return (invite shown, no verify)", async () => {
  const tree = await mount({ identity: "account-a" });
  await acceptGoing("qr-account-a", null);
  expect(tab.values.get(keyFor(EVENT_A))).toContain('"owner":"\\"account-a\\""');
  await unmount(tree);
  openTab(tab); // the Stripe return reload
  await mount({ identity: "account-a", contributionState: "paid" });
  expect(current.guestStatus).toBeNull();
  expect(await reachableQr()).toBeNull();
  expect(mockVerify).not.toHaveBeenCalled();
});

test("FINDING-1 signed-in chip-in return: the invite's live 'Going' re-submits an RSVP the guest already has", async () => {
  const tree = await mount({ identity: "account-a" });
  await acceptGoing("qr-account-a", null);
  await unmount(tree);
  openTab(tab);
  submit.mockClear();
  await mount({ identity: "account-a", contributionState: "paid" });
  submit.mockResolvedValueOnce({ status: "going", approvalStatus: "pending", rsvpId: "rsvp-qr-account-a", confirmationToken: null, credentials: [], anonymousRecovery: [] });
  await act(async () => { current.onGoingTap(); });
  const dialog = current.confirmDialog as React.ReactElement<{ children: React.ReactElement<{ visible?: boolean; onConfirm: () => Promise<void> }> }>;
  await act(async () => { await dialog.props.children.props.onConfirm(); });
  // A returning, already-going guest must not be able to re-submit from an empty invite.
  expect(submit).not.toHaveBeenCalled();
});
