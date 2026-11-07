import { describe, expect, jest, test } from "@jest/globals";
import { TAP_READY_LIMIT_MS, TapToPaySaleFlow, type TapToPayServer, type TapToPayTerminalClient, type TerminalCallResult, type TerminalPaymentIntentLike } from "../tapToPayFlow";
import { DoorTapError } from "../doorTapEdge";
import type { TapToPayDraft } from "../tapToPayDraft";
jest.mock("../../supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));
const MIN = 60000;
const DRAFT = { lines: [{ ticketTypeId: "t", quantity: 1 }], eventDateId: null, buyerPhone: null, phoneCountryIso: null } as unknown as TapToPayDraft;
const flush = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };
// Server like door-tap-intent: access/tap checks run BEFORE the replay lookup.
const harness = (refuse: (n: number) => DoorTapError | null) => {
  const createdAt = new Map<string, number>(); const byReq = new Map<string, string>();
  const readyAges: number[] = []; const log: string[] = []; let n = 0; let made = 0; let current = "";
  let pending: ((r: TerminalCallResult) => void) | null = null;
  const terminal: TapToPayTerminalClient = {
    ensureReaderConnected: jest.fn(async () => ({})),
    retrievePaymentIntent: jest.fn(async (s: string) => ({ paymentIntent: { id: s.replace(/_secret$/, ""), status: "requires_payment_method" } })),
    collectPaymentMethod: jest.fn((pi: TerminalPaymentIntentLike) => { log.push(`collect:${pi.id}`); return new Promise<TerminalCallResult>((r) => { pending = r; }); }),
    confirmPaymentIntent: jest.fn(async (pi: TerminalPaymentIntentLike) => ({ paymentIntent: { ...pi, status: "succeeded" } })),
    cancelCollectPaymentMethod: jest.fn(async () => { pending?.({ error: { code: "CANCELED" } }); pending = null; return {}; }),
  };
  const createIntent = jest.fn<TapToPayServer["createIntent"]>(async (input) => {
    n += 1;
    const refusal = refuse(n);
    if (refusal) { log.push(`refused:${refusal.code}`); throw refusal; }
    let id = byReq.get(input.clientRequestId);
    if (id === undefined) { made += 1; id = `pi_${made}`; byReq.set(input.clientRequestId, id); createdAt.set(id, Date.now()); log.push(`create:${id}`); } else log.push(`replay:${id}`);
    if (n === 1) throw new DoorTapError("network_error", "answer lost");
    current = id;
    return { paymentIntentId: id, clientSecret: `${id}_secret`, totalCents: 3000, currency: "GBP", stripeAccountId: "a", locationId: "l" };
  });
  const cancelIntent = jest.fn<TapToPayServer["cancelIntent"]>(async (i) => { log.push(`cancel:${i.paymentIntentId}`); });
  const flow = new TapToPaySaleFlow({ eventId: "e", draft: DRAFT, clientRequestId: "11111111-1111-4111-8111-111111111111", terminal,
    server: { createIntent, cancelIntent, completeIntent: jest.fn(async () => ({ orderId: "o", ticketIds: [], receiptQueued: false, replayed: false })) },
    onState: (s) => { if (s.kind === "ready") readyAges.push(Date.now() - (createdAt.get(current) ?? Date.now())); } });
  return { flow, log, readyAges };
};
/**
 * #4271 retest 4 P3-D — the tester's probe (probe_P3D_clock), committed by the
 * implementor: once a create's answer is lost for a request id, a later refusal
 * never resets that request id's clock. Red at d89caf40e4, green after the fix.
 */
describe("retest 4 P3-D: a refusal after a lost create answer never resets the clock on an intent that exists", () => {
  for (const code of ["door_access_denied", "tap_not_available", "stripe_account_not_ready"] as const) {
    test(`lost answer, then ${code} (checked before the replay lookup), then the replay: no ready on an intent past the limit`, async () => {
      jest.useFakeTimers();
      try {
        const h = harness((n) => (n === 2 ? new DoorTapError(code, "blip") : null));
        void h.flow.start(); await flush();           // pi_1 made, answer lost
        jest.advanceTimersByTime(6 * MIN);
        void h.flow.start(); await flush();           // refused (a permission/DB blip), clock cleared
        jest.advanceTimersByTime(6 * MIN);
        void h.flow.start(); await flush();           // replay hands back pi_1, 12 minutes old
        expect(h.log[0]).toBe("create:pi_1");
        expect(h.readyAges.length).toBeGreaterThan(0);
        for (const age of h.readyAges) expect(age).toBeLessThan(TAP_READY_LIMIT_MS);
      } finally { jest.useRealTimers(); }
    });
  }
});
