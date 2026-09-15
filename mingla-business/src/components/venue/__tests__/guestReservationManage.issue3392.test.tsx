/**
 * #3392 — free venue bookings get a manage/cancel path, and the manage page
 * works and is legible. #3391 — a host arming Cancel on a PAID booking is told
 * the guest is not refunded automatically.
 *
 * Mounts under the stock config with a bare react-test-renderer harness:
 *   - the REAL GuestVenueReservation (the #2734 harness shape) completing a free
 *     web booking, then opening its "Manage or cancel" link;
 *   - the REAL `app/reserve/[brandId]/manage.tsx` against a stubbed service:
 *     it opens a booking with NO refund, cancels it, shows the cancelled state
 *     without a second Cancel, and paints every text on the dark canvas;
 *   - the REAL ReservationDetailSheet arming Cancel on paid and free bookings.
 */

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { StyleSheet } from "react-native";

import { createThemePalette, resolveTheme } from "@mingla/offering-rendering";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// ── browser globals the web-only paths read ─────────────────────────────────
const mockAssign = jest.fn((_href: string) => undefined);
const mockReplaceState = jest.fn();
const browser = {
  location: { assign: mockAssign, hash: "", pathname: "/reserve/brand-3392/manage" },
  history: { replaceState: mockReplaceState },
};
(globalThis as { window?: unknown }).window = browser;

// ── GuestVenueReservation stubs (mirrors the #2734 harness) ──────────────────
const mockCreateReservation = jest.fn((_input: unknown) =>
  Promise.resolve({
    kind: "free_completed" as const,
    reservationId: "reservation-3392",
    reservedForUtc: "2026-09-20T19:30:00.000Z",
    partySize: 2,
    brandId: "brand-3392",
    guestCancelToken: "token-3392",
  } as Record<string, unknown>),
);
const mockFetchManage = jest.fn();
const mockCancel = jest.fn();

jest.mock("../../../analytics/webAnalytics", () => ({
  __esModule: true,
  captureWeb: () => undefined,
  getStoredClickAttribution: () => ({ clickId: null }),
}));
jest.mock("../../../hooks/usePublicVenueAvailability", () => ({
  __esModule: true,
  usePublicVenueAvailability: () => ({
    data: [
      {
        slotStartUtc: "2026-09-20T19:30:00.000Z",
        slotLocalLabel: "7:30 PM",
        remaining: 2,
        isFull: false,
      },
    ],
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: () => undefined,
  }),
}));
jest.mock("../../../services/venueGuestReservationService", () => ({
  __esModule: true,
  createGuestVenueReservation: (input: unknown) => mockCreateReservation(input),
  fetchGuestReservationManage: (input: unknown) => mockFetchManage(input),
  cancelGuestVenueReservation: (input: unknown) => mockCancel(input),
}));
jest.mock("../../../services/venueOrganicCaptureService", () => ({
  __esModule: true,
  captureVenueOrganicEvent: async () => undefined,
  getVenueOrganicJourneyToken: () => null,
}));
jest.mock("../../../services/venueOrganicCapturePolicy", () => ({
  __esModule: true,
  runBuyerVenueOrganicCapture: () => undefined,
}));
jest.mock("../../../utils/phone", () => ({
  __esModule: true,
  composeE164: () => "+19195550180",
}));
jest.mock("@mingla/phone-input", () => ({
  __esModule: true,
  PhoneInput: (props: Record<string, unknown>) => {
    const ReactActual = require("react") as typeof React;
    return ReactActual.createElement("PhoneInput", props);
  },
  getCountryByCode: () => ({ dialCode: "+1" }),
  getDefaultCountryCode: () => "US",
}));

const mockHost = (name: string) => (props: Record<string, unknown>) => {
  const ReactActual = require("react") as typeof React;
  return ReactActual.createElement(name, props, props.children as React.ReactNode);
};
jest.mock("../../ui/Button", () => ({ __esModule: true, Button: mockHost("Button") }));
jest.mock("../../ui/Input", () => ({ __esModule: true, Input: mockHost("Input") }));
jest.mock("../../ui/Icon", () => ({ __esModule: true, Icon: () => null }));
jest.mock("../../ui/Sheet", () => ({ __esModule: true, Sheet: mockHost("Sheet") }));
jest.mock("../../ui/SafeScreen", () => ({ __esModule: true, SafeScreen: mockHost("SafeScreen") }));

import { canvas } from "../../../constants/designSystem";
import type { Reservation } from "../../../types/venueReservation";
import {
  guestManageErrorCode,
  guestManageHeadline,
  guestManageMoneyLine,
  guestReservationManagePath,
  type GuestManageReservation,
} from "../../../utils/guestReservationManage";
import GuestReservationManageRoute from "../../../../app/reserve/[brandId]/manage";
import { GuestVenueReservation } from "../GuestVenueReservation";
import { ReservationDetailSheet } from "../ReservationDetailSheet";
import {
  PAID_CANCEL_REFUND_NOTE,
  paidCancelNeedsRefundNote,
} from "../reservationPaidCancelNote";

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Tree {
  root: TestInstance;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

async function mount(element: React.ReactElement): Promise<Tree> {
  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(element);
  });
  return tree;
}
const flush = async (): Promise<void> => {
  await TestRenderer.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

function byProp(root: TestInstance, prop: string, value: unknown): TestInstance {
  const node = root.findAll((n) => n.props[prop] === value && typeof n.type === "string")[0];
  if (node === undefined) throw new Error(`missing ${prop}=${String(value)}`);
  return node;
}
function textOf(node: TestInstance): string {
  const walk = (v: unknown): string =>
    typeof v === "string" || typeof v === "number"
      ? String(v)
      : Array.isArray(v)
      ? v.map(walk).join("")
      : "";
  return walk(node.props.children);
}
function allText(root: TestInstance): string[] {
  return root.findAll((n) => n.type === "Text").map(textOf);
}
async function invoke(node: TestInstance, prop: string, value?: unknown): Promise<void> {
  const fn = node.props[prop];
  if (typeof fn !== "function") throw new Error(`missing ${prop}`);
  await TestRenderer.act(async () => {
    (fn as (v?: unknown) => void)(value);
    await Promise.resolve();
    await Promise.resolve();
  });
}

const FREE_CONFIRMED: GuestManageReservation = {
  status: "confirmed",
  paymentStatus: "none",
  reservedForUtc: "2026-09-20T19:30:00.000Z",
  partySize: 2,
  venueName: "Rooftop Kitchen",
  canCancel: true,
};

beforeEach(() => {
  mockAssign.mockClear();
  mockReplaceState.mockClear();
  mockCreateReservation.mockClear();
  mockFetchManage.mockReset();
  mockCancel.mockReset();
  browser.location.hash = "";
});

// ── pure contracts ───────────────────────────────────────────────────────────

describe("#3392 — manage link contract", () => {
  test("the link keeps the credential in the fragment, never the query", () => {
    const path = guestReservationManagePath({
      brandId: "brand 1",
      reservationId: "res/1",
      token: "a&b=c",
    });
    expect(path).toBe(
      "/reserve/brand%201/manage#reservationId=res%2F1&token=a%26b%3Dc",
    );
    expect(path.split("#")[0]).not.toContain("token");
  });

  test("headline and money line tell a cancelled free booking apart from a live one", () => {
    expect(guestManageHeadline(FREE_CONFIRMED)).toBe("Your table is reserved");
    expect(guestManageMoneyLine(FREE_CONFIRMED, null)).toBeNull();
    const cancelled = { ...FREE_CONFIRMED, status: "cancelled_by_guest" as const, canCancel: false };
    expect(guestManageHeadline(cancelled)).toBe("You cancelled this reservation");
    expect(guestManageMoneyLine(cancelled, null)).toBe("No payment was taken for this booking.");
    expect(
      guestManageMoneyLine({ ...cancelled, paymentStatus: "paid" }, { buyer_state: "processed" }),
    ).toBe("Your refund has been processed.");
  });

  test("error codes are read from the function response body", async () => {
    await expect(
      guestManageErrorCode({ context: { text: async () => '{"error":"cancel_not_allowed"}' } }),
    ).resolves.toBe("cancel_not_allowed");
    await expect(guestManageErrorCode(new Error("offline"))).resolves.toBeNull();
  });
});

// ── free booking success card ────────────────────────────────────────────────

describe("#3392 — a free web booking offers Manage or cancel", () => {
  test("completing a free booking shows the button, which opens the private manage link", async () => {
    const palette = createThemePalette(resolveTheme({ color: "#2563eb" }, { color: "#16a34a" }));
    const tree = await mount(
      <GuestVenueReservation
        venueId="venue-3392"
        brandId="brand-3392"
        currency="USD"
        analyticsSurface="buyer_web"
        palette={palette}
      />,
    );
    await invoke(byProp(tree.root, "accessibilityLabel", "Select 7:30 PM"), "onPress");
    await invoke(byProp(tree.root, "accessibilityLabel", "Name, required"), "onChangeText", "Ada Lovelace");
    await invoke(byProp(tree.root, "accessibilityLabel", "Email, required"), "onChangeText", "ada@example.com");
    await invoke(byProp(tree.root, "label", "Confirm reservation"), "onPress");
    await flush();

    expect(allText(tree.root)).toContain("Your table is reserved");
    const manage = byProp(tree.root, "testID", "guest-reservation-manage");
    await invoke(manage, "onPress");
    expect(mockAssign).toHaveBeenCalledWith(
      guestReservationManagePath({
        brandId: "brand-3392",
        reservationId: "reservation-3392",
        token: "token-3392",
      }),
    );
    await TestRenderer.act(async () => tree.unmount());
  });
});

// ── manage page ──────────────────────────────────────────────────────────────

describe("#3392 — the manage page opens, cancels and reads on the dark canvas", () => {
  test("a free booking with no refund opens, cancels once, then shows cancelled with no second Cancel", async () => {
    browser.location.hash = "#reservationId=reservation-3392&token=token-3392";
    mockFetchManage
      .mockImplementationOnce(() => Promise.resolve({ reservation: FREE_CONFIRMED, refund: null }))
      .mockImplementationOnce(() =>
        Promise.resolve({
          reservation: { ...FREE_CONFIRMED, status: "cancelled_by_guest", canCancel: false },
          refund: null,
        })
      );
    mockCancel.mockImplementation(() => Promise.resolve({ refund: null }));

    const tree = await mount(<GuestReservationManageRoute />);
    await flush();
    expect(mockReplaceState).toHaveBeenCalled();
    expect(mockFetchManage).toHaveBeenCalledWith({
      reservationId: "reservation-3392",
      guestToken: "token-3392",
    });
    expect(textOf(byProp(tree.root, "testID", "guest-manage-headline"))).toBe("Your table is reserved");
    expect(allText(tree.root)).toContain("Rooftop Kitchen");

    const cancel = byProp(tree.root, "testID", "guest-manage-cancel");
    expect(cancel.props.label).toBe("Cancel reservation");
    await invoke(cancel, "onPress");
    expect(mockCancel).not.toHaveBeenCalled();
    expect(byProp(tree.root, "testID", "guest-manage-cancel").props.label).toBe("Tap again to cancel");
    await invoke(byProp(tree.root, "testID", "guest-manage-cancel"), "onPress");
    await flush();

    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(textOf(byProp(tree.root, "testID", "guest-manage-headline"))).toBe(
      "You cancelled this reservation",
    );
    expect(textOf(byProp(tree.root, "testID", "guest-manage-money"))).toBe(
      "No payment was taken for this booking.",
    );
    expect(tree.root.findAll((n) => n.props.testID === "guest-manage-cancel")).toHaveLength(0);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("every text sets a colour and the frame paints the dark canvas", async () => {
    browser.location.hash = "#reservationId=reservation-3392&token=token-3392";
    mockFetchManage.mockImplementation(() =>
      Promise.resolve({ reservation: FREE_CONFIRMED, refund: null })
    );
    const tree = await mount(<GuestReservationManageRoute />);
    await flush();
    const frame = tree.root.findAll((n) => n.type === "SafeScreen")[0];
    expect(StyleSheet.flatten(frame.props.style as object)).toMatchObject({
      backgroundColor: canvas.discover,
    });
    const texts = tree.root.findAll((n) => n.type === "Text");
    expect(texts.length).toBeGreaterThan(2);
    for (const node of texts) {
      const style = StyleSheet.flatten(node.props.style as object) as { color?: string };
      expect(typeof style.color).toBe("string");
    }
    await TestRenderer.act(async () => tree.unmount());
  });

  test("a refused cancel is explained and the page re-reads the booking", async () => {
    browser.location.hash = "#reservationId=reservation-3392&token=token-3392";
    mockFetchManage.mockImplementation(() =>
      Promise.resolve({ reservation: FREE_CONFIRMED, refund: null })
    );
    mockCancel.mockImplementation(() =>
      Promise.reject({ context: { text: async () => '{"error":"cancel_not_allowed"}' } })
    );
    const tree = await mount(<GuestReservationManageRoute />);
    await flush();
    await invoke(byProp(tree.root, "testID", "guest-manage-cancel"), "onPress");
    await invoke(byProp(tree.root, "testID", "guest-manage-cancel"), "onPress");
    await flush();
    expect(textOf(byProp(tree.root, "testID", "guest-manage-cancel-error"))).toMatch(
      /can no longer be cancelled/,
    );
    expect(mockFetchManage.mock.calls.length).toBeGreaterThanOrEqual(2);
    await TestRenderer.act(async () => tree.unmount());
  });
});

// ── #3391 host note ──────────────────────────────────────────────────────────

describe("#3391 — arming Cancel on a paid booking says the guest isn't refunded", () => {
  const baseReservation = {
    id: "reservation-host",
    brandId: "brand-3392",
    placePoolId: null,
    tableId: null,
    reservedFor: "2026-09-20T19:30:00.000Z",
    partySize: 4,
    status: "confirmed",
    source: "website",
    createdVia: "consumer",
    guestName: "Ada",
    guestPhoneE164: null,
    guestEmail: null,
    consumerUserId: null,
    occasion: null,
    guestNotes: null,
    tags: [],
    feeCents: 2500,
    paymentStatus: "paid",
    refund: null,
  } as unknown as Reservation;

  test("the rule: only an armed cancel on a paid, unrefunded booking", () => {
    expect(paidCancelNeedsRefundNote(baseReservation, "cancel")).toBe(true);
    expect(paidCancelNeedsRefundNote(baseReservation, null)).toBe(false);
    expect(paidCancelNeedsRefundNote(baseReservation, "no_show")).toBe(false);
    expect(paidCancelNeedsRefundNote({ ...baseReservation, paymentStatus: "none" }, "cancel")).toBe(false);
  });

  test.each([
    ["paid", true],
    ["none", false],
  ])("payment %s → note shown after arming Cancel: %s", async (paymentStatus, shown) => {
    const tree = await mount(
      <ReservationDetailSheet
        visible
        onClose={() => undefined}
        reservation={{ ...baseReservation, paymentStatus } as Reservation}
        tableName={null}
        timeZone="America/New_York"
        onAction={() => undefined}
        acting={false}
      />,
    );
    expect(tree.root.findAll((n) => n.props.testID === "reservation-paid-cancel-note")).toHaveLength(0);
    await invoke(byProp(tree.root, "testID", "reservation-action-cancel"), "onPress");
    const notes = tree.root.findAll(
      (n) => n.props.testID === "reservation-paid-cancel-note" && typeof n.type === "string",
    );
    expect(notes.length > 0).toBe(shown);
    if (shown) expect(textOf(notes[0])).toBe(PAID_CANCEL_REFUND_NOTE);
    await TestRenderer.act(async () => tree.unmount());
  });
});
