// ISSUE-1326 — paid NG (Paystack) venue-reservation finalize on the webhook rail.
//
// The bug (pre-1326): a Paystack-routed venue reservation with a fee is CHARGED
// (reservation_checkout_sessions row, paystack_reference = mingla_resv_*, funds
// captured) but NOTHING finalizes it — the charge.success router resolved the
// reference against event_rsvp_contributions then ticket_checkout_sessions only,
// so a reservation reference matched NEITHER → `orphan` → no reservations row,
// no refund.
//
// These tests drive the REAL exported `handlePaystackChargeSuccess` (with an
// injected Paystack verifier + a contribution/ticket/reservation-aware fake
// supabase) so the money path is proven at runtime, hermetically (no network).
//
// Coverage (SPEC / #1326 deliverable):
//   T1  paid NG reservation charge.success → reservation_finalized (NOT orphan),
//       finalize RPC called exactly once, ad-conversion fired exactly once.
//   T2  redelivered webhook (session already linked) → reservation_replayed,
//       finalize NOT called, NO second mint, NO second fire (idempotent).
//   T3  amount mismatch → amount_mismatch, no finalize, session failed, audit.
//   T4  currency mismatch → currency_mismatch, no finalize, session failed.
//   T5  slot taken after charge (RPC raises slot_unavailable) → reservation_
//       refund_due, session failed with the refund-due reason, MANUAL-refund
//       audit marker, no crash, NO mint, NO fire.
//   T6  reference matches NEITHER contribution/ticket/reservation → orphan
//       (the pre-existing behavior is preserved — the branch is additive).
//
// FAILS-ON-REVERT: deleting the reservation branch in paystackWebhookRouter.ts
// turns T1 back into `orphan` (T1 goes RED). Deleting the amount/currency guard
// in reservationPaystackFinalize.ts makes T3/T4 finalize (RED). Deleting the
// idempotent short-circuit makes T2 call finalize again + double-fire (RED).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handlePaystackChargeSuccess } from "../paystackWebhookRouter.ts";
import { finalizeVerifiedPaystackReservation } from "../reservationPaystackFinalize.ts";

// ─── Fake supabase: contribution + ticket (both MISS) + reservation + the fire ──

interface ReservationSessionRow {
  id: string;
  status: string | null;
  reservation_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  attribution_click_id: string | null;
  failure_reason?: string | null;
}

interface FakeState {
  reservationSession: ReservationSessionRow | null;
  finalizeCalls: number;
  // Counted at resolveReservationContext's FIRST read (`from('reservations')`):
  // this is invoked exactly once per fireAdConversion call. We return null there
  // so the fire no-ops (context_unresolved) → zero senders, zero network — the
  // count alone proves the helper DID (or did NOT) invoke the conversion fire.
  fireInvocations: number;
  // Optional gate: when set, resolveReservationContext's `from('reservations')`
  // read (the fire's FIRST await) blocks until this promise resolves. Used to
  // prove the await/void fire-mode without any timing measurement.
  fireGate?: Promise<void>;
  finalizeImpl: (args: Record<string, unknown>) => Promise<
    { data: unknown; error: { message: string } | null }
  >;
  auditActions: string[];
  sessionUpdates: Record<string, unknown>[];
}

function makeFakeSupabase(state: FakeState) {
  const selectChain = (table: string) => {
    const chain = {
      // filters are irrelevant to the fake — resolution is by table + op.
      eq() {
        return chain;
      },
      not() {
        return chain;
      },
      maybeSingle() {
        let data: unknown = null;
        if (table === "event_rsvp_contributions") data = null; // not a chip-in
        else if (table === "ticket_checkout_sessions") data = null; // not a ticket
        else if (table === "reservation_checkout_sessions") {
          data = state.reservationSession;
        } else if (table === "reservations") {
          // resolveReservationContext's first read — count (proves the fire was
          // invoked) + return null so the fire no-ops (context_unresolved → no
          // senders, no network). If gated, block the RESOLUTION until released.
          state.fireInvocations += 1;
          if (state.fireGate) {
            return state.fireGate.then(() => ({ data: null, error: null }));
          }
          data = null;
        } else if (table === "ad_conversions") data = null;
        else if (table === "ad_connections") data = null;
        else if (table === "ad_attribution_touches") data = null;
        return Promise.resolve({ data, error: null });
      },
    };
    return chain;
  };

  return {
    from(table: string) {
      return {
        select() {
          return selectChain(table);
        },
        update(patch: Record<string, unknown>) {
          return {
            eq() {
              if (table === "reservation_checkout_sessions") {
                state.sessionUpdates.push(patch);
                if (state.reservationSession) {
                  state.reservationSession = {
                    ...state.reservationSession,
                    ...(patch as Partial<ReservationSessionRow>),
                  };
                }
              }
              return Promise.resolve({ error: null });
            },
          };
        },
        insert(row: Record<string, unknown>) {
          if (table === "audit_log") {
            state.auditActions.push(String(row.action));
          }
          return Promise.resolve({ error: null });
        },
        upsert() {
          return Promise.resolve({ error: null });
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "pg_finalize_guest_reservation") {
        state.finalizeCalls += 1;
        return state.finalizeImpl(args);
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

const RESV_REF = "mingla_resv_11111111-2222-3333-4444-555555555555_abcd";
const RESERVATION_ID = "99999999-8888-7777-6666-555555555555";

// The RPC's success return shape: TABLE(reservation reservations, session_id).
function finalizeOk() {
  return () =>
    Promise.resolve({
      data: [{ reservation: { id: RESERVATION_ID }, session_id: "sess-r-1" }],
      error: null,
    });
}
function finalizeSlotTaken() {
  return () =>
    Promise.resolve({
      data: null,
      error: { message: "slot_unavailable" },
    });
}

function baseState(
  over: Partial<ReservationSessionRow> = {},
  finalizeImpl: FakeState["finalizeImpl"] = finalizeOk(),
): FakeState {
  return {
    reservationSession: {
      id: "sess-r-1",
      status: "pending",
      reservation_id: null,
      amount_cents: 537500,
      currency: "NGN",
      attribution_click_id: null,
      ...over,
    },
    finalizeCalls: 0,
    fireInvocations: 0,
    finalizeImpl,
    auditActions: [],
    sessionUpdates: [],
  };
}

const verifyOk = (amount: number, currency = "NGN") => (_ref: string) =>
  Promise.resolve({
    status: "success",
    amount,
    currency,
    channel: "card",
    id: 4242,
    paid_at: "2026-07-28T10:00:00.000Z",
  });

Deno.test("T1 · paid NG reservation charge.success → finalized (NOT orphan) + one mint + one fire", async () => {
  const state = baseState();
  const supabase = makeFakeSupabase(state);
  const result = await handlePaystackChargeSuccess(
    supabase,
    { reference: RESV_REF },
    verifyOk(537500),
  );
  assertEquals(result.status, "reservation_finalized");
  assertEquals(result.orderId, undefined); // never an order
  assertEquals(state.finalizeCalls, 1);
  assertEquals(state.fireInvocations, 1); // exactly one conversion fired
});

Deno.test("T2 · redelivered webhook (session already linked) → replayed, no second mint, no second fire", async () => {
  const state = baseState({
    status: "completed",
    reservation_id: RESERVATION_ID,
  });
  const supabase = makeFakeSupabase(state);
  const result = await handlePaystackChargeSuccess(
    supabase,
    { reference: RESV_REF },
    verifyOk(537500),
  );
  assertEquals(result.status, "reservation_replayed");
  assertEquals(state.finalizeCalls, 0); // EXACTLY ONE reservation across both fires
  assertEquals(state.fireInvocations, 0); // no double-fire
});

Deno.test("T3 · amount mismatch → amount_mismatch, no finalize, session failed, audit", async () => {
  const state = baseState();
  const supabase = makeFakeSupabase(state);
  // Verified amount (100) != session amount_cents (537500).
  const result = await handlePaystackChargeSuccess(
    supabase,
    { reference: RESV_REF },
    verifyOk(100),
  );
  assertEquals(result.status, "amount_mismatch");
  assertEquals(state.finalizeCalls, 0);
  assertEquals(state.fireInvocations, 0);
  assertEquals(state.reservationSession?.status, "failed");
  assertEquals(
    state.auditActions.includes("paystack.reservation_amount_mismatch"),
    true,
  );
});

Deno.test("T4 · currency mismatch → currency_mismatch, no finalize, session failed", async () => {
  const state = baseState();
  const supabase = makeFakeSupabase(state);
  const result = await handlePaystackChargeSuccess(
    supabase,
    { reference: RESV_REF },
    verifyOk(537500, "GHS"),
  );
  assertEquals(result.status, "currency_mismatch");
  assertEquals(state.finalizeCalls, 0);
  assertEquals(state.fireInvocations, 0);
  assertEquals(state.reservationSession?.status, "failed");
  assertEquals(
    state.auditActions.includes("paystack.reservation_currency_mismatch"),
    true,
  );
});

Deno.test("T5 · slot taken after charge → refund_due, session failed w/ refund reason, manual-refund marker, no crash, no mint, no fire", async () => {
  const state = baseState({}, finalizeSlotTaken());
  const supabase = makeFakeSupabase(state);
  const result = await handlePaystackChargeSuccess(
    supabase,
    { reference: RESV_REF },
    verifyOk(537500),
  );
  assertEquals(result.status, "reservation_refund_due");
  assertEquals(state.finalizeCalls, 1); // the RPC WAS attempted (and raised)
  assertEquals(state.fireInvocations, 0); // nothing minted → nothing fired
  assertEquals(state.reservationSession?.status, "failed");
  assertEquals(
    state.reservationSession?.failure_reason,
    "slot_unavailable_after_charge_refund_due",
  );
  assertEquals(
    state.auditActions.includes(
      "paystack.reservation_slot_unavailable_refund_due",
    ),
    true,
  );
});

Deno.test("T6 · reference matches nothing → orphan preserved (branch is additive)", async () => {
  const state = baseState();
  state.reservationSession = null; // not a reservation either
  const supabase = makeFakeSupabase(state);
  const result = await handlePaystackChargeSuccess(
    supabase,
    { reference: "mingla_unknown_ref" },
    verifyOk(537500),
  );
  assertEquals(result.status, "orphan");
  assertEquals(state.finalizeCalls, 0);
  assertEquals(state.fireInvocations, 0);
});

// ─── Helper-level: prove the SHARED finalize path directly (confirm reuses it) ──

Deno.test("helper · finalizeVerifiedPaystackReservation mints + returns finalized on a matching verified charge", async () => {
  const state = baseState();
  const supabase = makeFakeSupabase(state);
  const outcome = await finalizeVerifiedPaystackReservation(
    supabase,
    state.reservationSession!,
    RESV_REF,
    537500,
    "ngn", // lower-case currency must still pass (helper upper-cases)
  );
  assertEquals(outcome.kind, "finalized");
  if (outcome.kind === "finalized") {
    assertEquals(outcome.reservationId, RESERVATION_ID);
  }
  assertEquals(state.finalizeCalls, 1);
  assertEquals(state.fireInvocations, 1);
});

Deno.test("helper · already-linked session short-circuits to replayed (no mint, no fire)", async () => {
  const state = baseState({
    status: "completed",
    reservation_id: RESERVATION_ID,
  });
  const supabase = makeFakeSupabase(state);
  const outcome = await finalizeVerifiedPaystackReservation(
    supabase,
    state.reservationSession!,
    RESV_REF,
    537500,
    "NGN",
  );
  assertEquals(outcome.kind, "replayed");
  assertEquals(state.finalizeCalls, 0);
  assertEquals(state.fireInvocations, 0);
});

// ─── Fire-mode (P2 guest-latency defect fix): the mint/guards/idempotency are
//     identical, but the CONFIRM fast-path must NOT block on the conversion
//     fan-out, while the WEBHOOK reliably awaits it. Proven with a gated fire
//     (no timing measurement — a race vs a bounded timer). ────────────────────

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

Deno.test({
  name:
    "fire-mode · awaitConversion=false (CONFIRM) → mint returns WITHOUT waiting on a hanging conversion fire",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const gate = deferred();
    const state = baseState();
    state.fireGate = gate.promise; // the fire's first read hangs until released
    const supabase = makeFakeSupabase(state);

    const p = finalizeVerifiedPaystackReservation(
      supabase,
      state.reservationSession!,
      RESV_REF,
      537500,
      "NGN",
      false, // confirm fast-path
    );
    // If the helper AWAITED the (gated) fire, it could not win this race.
    const winner = await Promise.race([
      p.then((o) => ({ tag: "returned", kind: o.kind })),
      new Promise<{ tag: string; kind?: string }>((res) =>
        setTimeout(() => res({ tag: "blocked" }), 1000)
      ),
    ]);
    assertEquals(winner.tag, "returned"); // returned while the fire is still gated
    assertEquals(winner.kind, "finalized");
    assertEquals(state.finalizeCalls, 1); // the mint DID happen
    assertEquals(state.fireInvocations, 1); // the fire WAS invoked (background)

    // Release + drain so the background fire completes cleanly.
    gate.resolve();
    await p;
    await new Promise((r) => setTimeout(r, 0));
  },
});

Deno.test({
  name:
    "fire-mode · awaitConversion=true (WEBHOOK) → mint does NOT return until the conversion fire completes",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const gate = deferred();
    const state = baseState();
    state.fireGate = gate.promise;
    const supabase = makeFakeSupabase(state);

    const p = finalizeVerifiedPaystackReservation(
      supabase,
      state.reservationSession!,
      RESV_REF,
      537500,
      "NGN",
      true, // webhook reliable sender
    );
    const winner1 = await Promise.race([
      p.then(() => "returned"),
      new Promise<string>((res) => setTimeout(() => res("blocked"), 100)),
    ]);
    assertEquals(winner1, "blocked"); // still awaiting the gated fire

    gate.resolve();
    const outcome = await p; // now it completes
    assertEquals(outcome.kind, "finalized");
    assertEquals(state.fireInvocations, 1);
  },
});
