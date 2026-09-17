/**
 * #3391 — a host cancelling a PAID venue booking refunds the guest in full.
 *
 * Mounts the REAL ReservationDetailSheet and drives the REAL
 * useTransitionReservation hook and cancelPaidVenueReservation service against
 * a stubbed supabase client:
 *
 *   H1  the note says exactly what the guest gets back, with the right glyph
 *       ($ / £ / ₦), and the #3406 stopgap copy is gone.
 *   H2  a SEATED paid booking is not refunded, and arming Cancel says so.
 *   H3  after the refund exists the sheet shows the refund chip in the booking's
 *       own currency glyph, and no cancel note.
 *   H4  a refused cancel explains itself in the sheet.
 *   H5  the hook sends a paid cancel to the refunding edge action AS THE VENUE
 *       (and never through the plain RPC), a free cancel to the RPC, and hands
 *       back the refund.
 *   H6  a refusal from the edge action surfaces its code.
 */

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockInvoke = jest.fn<
  (name: string, options: { body: Record<string, unknown> }) => Promise<{
    data: unknown;
    error: unknown;
  }>
>();
const mockRpc = jest.fn<
  (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: unknown;
  }>
>();

jest.mock("../../../services/supabase", () => ({
  __esModule: true,
  supabase: {
    functions: {
      invoke: (name: string, options: { body: Record<string, unknown> }) =>
        mockInvoke(name, options),
    },
    rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args),
  },
}));
jest.mock("../../../context/AuthContext", () => ({
  __esModule: true,
  useAuth: () => ({ isAuthReady: true }),
}));

const mockHost = (name: string) => (props: Record<string, unknown>) => {
  const ReactActual = require("react") as typeof React;
  return ReactActual.createElement(name, props, props.children as React.ReactNode);
};
jest.mock("../../ui/Sheet", () => ({ __esModule: true, Sheet: mockHost("Sheet") }));

import type {
  Reservation,
  SourceRefundSummary,
} from "../../../types/venueReservation";
import { ReservationDetailSheet } from "../ReservationDetailSheet";
import {
  paidCancelErrorMessage,
  paidCancelNote,
  SEATED_PAID_CANCEL_NOTE,
} from "../reservationPaidCancelNote";
import {
  useTransitionReservation,
  type ReservationTransitionResult,
  type ReservationTransitionVars,
} from "../../../hooks/useVenueReservations";
import {
  cancelPaidVenueReservation,
  VenueCancelRefundError,
} from "../../../services/sourceRefundService";

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
function hostNodes(root: TestInstance, testID: string): TestInstance[] {
  return root.findAll((n) => n.props.testID === testID && typeof n.type === "string");
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
function allText(root: TestInstance): string {
  return root
    .findAll((n) => n.type === "Text")
    .map(textOf)
    .join("\n");
}
async function press(root: TestInstance, testID: string): Promise<void> {
  const node = hostNodes(root, testID)[0];
  if (node === undefined) throw new Error(`missing ${testID}`);
  await TestRenderer.act(async () => {
    (node.props.onPress as () => void)();
    await Promise.resolve();
  });
}

function booking(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: "5e3b1c7a-9d2f-4a6b-8c1d-3391aa000001",
    brandId: "brand-3391",
    venueId: "venue-3391",
    placePoolId: null,
    tableId: null,
    reservedFor: "2027-07-10T19:30:00.000Z",
    partySize: 2,
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
    feeCents: 2500000,
    feeCurrency: "NGN",
    paymentStatus: "paid",
    createdAt: "2027-07-01T10:00:00.000Z",
    refund: null,
    ...overrides,
  };
}

function refundSummary(overrides: Partial<SourceRefundSummary> = {}): SourceRefundSummary {
  return {
    refundId: "7a1d2c3b-4e5f-4a6b-9c8d-3391bb000002",
    sourceType: "venue_reservation",
    subjectId: "5e3b1c7a-9d2f-4a6b-8c1d-3391aa000001",
    refundKind: "venue_staff_cancel",
    buyerState: "queued",
    feeState: "queued",
    financialState: "pending",
    amountCents: 2500000,
    currency: "NGN",
    requestedAt: "2027-07-06T10:00:00.000Z",
    updatedAt: "2027-07-06T10:00:00.000Z",
    processedAt: null,
    opsStatus: "none",
    canRetry: false,
    ...overrides,
  };
}

function sheet(reservation: Reservation, props: Partial<React.ComponentProps<typeof ReservationDetailSheet>> = {}) {
  return (
    <ReservationDetailSheet
      visible
      onClose={() => undefined}
      reservation={reservation}
      tableName={null}
      timeZone="Africa/Lagos"
      onAction={() => undefined}
      acting={false}
      {...props}
    />
  );
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockRpc.mockReset();
});

describe("#3391 — the host is told what the guest gets back", () => {
  test("H1 the note carries the refund amount with the right glyph", () => {
    expect(paidCancelNote(booking(), "cancel")).toEqual({
      kind: "refund",
      text: "This refunds ₦25,000.00 to the guest.",
    });
    expect(
      paidCancelNote(booking({ feeCents: 5000, feeCurrency: "USD" }), "cancel")?.text,
    ).toBe("This refunds $50.00 to the guest.");
    expect(
      paidCancelNote(booking({ feeCents: 5000, feeCurrency: "GBP" }), "cancel")?.text,
    ).toBe("This refunds £50.00 to the guest.");
    expect(paidCancelNote(booking(), null)).toBeNull();
    expect(paidCancelNote(booking(), "no_show")).toBeNull();
    expect(paidCancelNote(booking({ paymentStatus: "none" }), "cancel")).toBeNull();
    expect(paidCancelNote(booking({ refund: refundSummary() }), "cancel")).toBeNull();
  });

  test("H1 mounted: arming Cancel shows the refund, the stopgap is gone, confirming cancels", async () => {
    const onAction = jest.fn();
    const reservation = booking();
    const tree = await mount(sheet(reservation, { onAction }));
    expect(hostNodes(tree.root, "reservation-paid-cancel-note")).toHaveLength(0);

    await press(tree.root, "reservation-action-cancel");
    const notes = hostNodes(tree.root, "reservation-paid-cancel-note");
    expect(notes).toHaveLength(1);
    expect(textOf(notes[0])).toBe("This refunds ₦25,000.00 to the guest.");
    expect(allText(tree.root)).not.toMatch(/won't refund them automatically/);
    expect(allText(tree.root)).not.toMatch(/NGN/);
    expect(onAction).not.toHaveBeenCalled();

    await press(tree.root, "reservation-action-cancel");
    expect(onAction).toHaveBeenCalledWith(reservation, "cancel");
    await TestRenderer.act(async () => tree.unmount());
  });

  test("H2 a seated paid booking is not refunded, and the host is told why", async () => {
    const seated = booking({ status: "seated" });
    expect(paidCancelNote(seated, "cancel")).toEqual({
      kind: "seated_no_refund",
      text: SEATED_PAID_CANCEL_NOTE,
    });
    const tree = await mount(sheet(seated));
    await press(tree.root, "reservation-action-cancel");
    const notes = hostNodes(tree.root, "reservation-paid-cancel-note");
    expect(notes).toHaveLength(1);
    expect(textOf(notes[0])).toBe(SEATED_PAID_CANCEL_NOTE);
    expect(textOf(notes[0])).not.toMatch(/This refunds/);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("H3 once refunded the sheet shows the refund chip with the glyph, and no note", async () => {
    const tree = await mount(
      sheet(booking({ status: "cancelled_by_venue", refund: refundSummary() })),
    );
    const chip = tree.root.findAll(
      (n) => n.props.accessibilityRole === "text" && typeof n.type === "string",
    )[0];
    expect(chip?.props.accessibilityLabel).toBe("Refund Queued · ₦25,000.00");
    expect(hostNodes(tree.root, "reservation-paid-cancel-note")).toHaveLength(0);
    expect(allText(tree.root)).not.toMatch(/No refund has been requested/);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("H4 a refused cancel explains itself in the sheet", async () => {
    const message = paidCancelErrorMessage("payout_in_flight");
    expect(message).toMatch(/payout is being sent/);
    const tree = await mount(sheet(booking(), { actionError: message }));
    const error = hostNodes(tree.root, "reservation-action-error");
    expect(error).toHaveLength(1);
    expect(textOf(error[0])).toBe(message);
    expect(paidCancelErrorMessage(null)).toMatch(/never refunds twice/);
    await TestRenderer.act(async () => tree.unmount());
  });
});

describe("#3391 — the cancel reaches the refunding edge action", () => {
  async function runMutation(
    vars: ReservationTransitionVars,
  ): Promise<{ result?: ReservationTransitionResult; error?: unknown }> {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    let mutate!: ReturnType<typeof useTransitionReservation>["mutateAsync"];
    function Probe(): null {
      mutate = useTransitionReservation("brand-3391", "venue-3391").mutateAsync;
      return null;
    }
    const tree = await mount(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
    const outcome: { result?: ReservationTransitionResult; error?: unknown } = {};
    await TestRenderer.act(async () => {
      try {
        outcome.result = await mutate(vars);
      } catch (error) {
        outcome.error = error;
      }
    });
    await TestRenderer.act(async () => tree.unmount());
    client.clear();
    return outcome;
  }

  test("H5 a paid cancel goes to the edge action as the venue and returns the refund", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        status: "cancelled",
        cancelled: true,
        replayed: false,
        refund: {
          refund_id: "7a1d2c3b-4e5f-4a6b-9c8d-3391bb000002",
          source_type: "venue_reservation",
          subject_id: "5e3b1c7a-9d2f-4a6b-8c1d-3391aa000001",
          refund_kind: "venue_staff_cancel",
          buyer_state: "processed",
          fee_state: "processed",
          financial_state: "reconciled",
          amount_cents: 5000,
          currency: "USD",
          requested_at: "2027-07-06T10:00:00.000Z",
          updated_at: "2027-07-06T10:00:05.000Z",
          processed_at: "2027-07-06T10:00:05.000Z",
          ops_status: "none",
          can_retry: false,
        },
        runner: "ran",
      },
      error: null,
    });
    const { result, error } = await runMutation({
      reservationId: "5e3b1c7a-9d2f-4a6b-8c1d-3391aa000001",
      toStatus: "cancelled_by_venue",
      refundsGuest: true,
    });
    expect(error).toBeUndefined();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke.mock.calls[0][0]).toBe("venue-reservation-cancel");
    expect(mockInvoke.mock.calls[0][1].body).toEqual({
      reservationId: "5e3b1c7a-9d2f-4a6b-8c1d-3391aa000001",
      actor: "venue",
      reason: null,
    });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(result?.refund?.refundKind).toBe("venue_staff_cancel");
    expect(result?.refund?.buyerState).toBe("processed");
    expect(result?.refund?.amountCents).toBe(5000);
  });

  test("H5 a free cancel stays on the plain transition RPC", async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null });
    const { result } = await runMutation({
      reservationId: "5e3b1c7a-9d2f-4a6b-8c1d-3391aa000001",
      toStatus: "cancelled_by_venue",
      refundsGuest: false,
    });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockRpc).toHaveBeenCalledWith("biz_reservation_transition", {
      p_reservation_id: "5e3b1c7a-9d2f-4a6b-8c1d-3391aa000001",
      p_to_status: "cancelled_by_venue",
      p_table_id: null,
      p_reason: null,
    });
    expect(result).toEqual({ refund: null });
  });

  test("H6 a refusal from the edge action surfaces its code", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        name: "FunctionsHttpError",
        context: { json: async () => ({ error: "payout_in_flight" }) },
      },
    });
    await expect(
      cancelPaidVenueReservation({ reservationId: "5e3b1c7a-9d2f-4a6b-8c1d-3391aa000001" }),
    ).rejects.toEqual(expect.objectContaining({ code: "payout_in_flight" }));
    const { error } = await runMutation({
      reservationId: "5e3b1c7a-9d2f-4a6b-8c1d-3391aa000001",
      toStatus: "cancelled_by_venue",
      refundsGuest: true,
    });
    expect(error).toBeInstanceOf(VenueCancelRefundError);
    expect((error as VenueCancelRefundError).code).toBe("payout_in_flight");
  });
});
