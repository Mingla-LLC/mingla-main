// META-ORCH-1076 [Paystack Africa] Phase 1 — webhook router + signature regression.
//
// Covers (SPEC §8 T-02/T-04/T-05/T-06 at the router level):
//   - valid charge.success → verify → finalize (one order)
//   - idempotent replay (session already finalized) → exactly one order
//   - amount mismatch on verify → no finalize, session failed
//   - currency mismatch → no finalize, session failed
//   - verify status != success → no finalize
//   - orphan reference (no session) → no finalize
//   - bad signature → verifyPaystackSignature rejects (401 at the edge fn)
//
// fails-on-revert: deleting the amount-match gate in handlePaystackChargeSuccess
// makes the "amount mismatch" test finalize an order (finalizeCalls===1) →
// assertion fails. Deleting the order_id early-return makes the "replay" test
// call finalize again. Module-import failure on revert of paystackWebhookRouter.ts
// errors every test. Verified before the router existed.
import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handlePaystackChargeSuccess } from "../../_shared/paystackWebhookRouter.ts";
import { verifyPaystackSignature } from "../../_shared/paystack.ts";

// ---- Minimal fake Supabase client tailored to the router's calls ----
interface FakeSessionRow {
  id: string;
  status: string;
  order_id: string | null;
  total_cents: number;
  currency: string;
}

interface FakeState {
  session: FakeSessionRow | null;
  finalizeCalls: number;
  finalizeReturn: Record<string, unknown> | null;
  auditActions: string[];
  sessionUpdates: Record<string, unknown>[];
}

function makeFakeSupabase(state: FakeState) {
  return {
    from(table: string) {
      if (table === "ticket_checkout_sessions") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return Promise.resolve({ data: state.session, error: null });
                  },
                };
              },
            };
          },
          update(patch: Record<string, unknown>) {
            return {
              eq() {
                state.sessionUpdates.push(patch);
                if (state.session) {
                  state.session = { ...state.session, ...(patch as Partial<FakeSessionRow>) };
                }
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      if (table === "audit_log") {
        return {
          insert(row: Record<string, unknown>) {
            state.auditActions.push(String(row.action));
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc(fn: string, _args: Record<string, unknown>) {
      if (fn === "biz_ticket_checkout_finalize") {
        state.finalizeCalls += 1;
        // Simulate the RPC flipping the session to finalized.
        if (state.session) {
          state.session = { ...state.session, order_id: "order-1", status: "paid_completed" };
        }
        return Promise.resolve({ data: state.finalizeReturn, error: null });
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

// qrTokenPepper() reads "app.qr_token_pepper" from env (≥32 chars, not the
// local sentinel) — set a deterministic value so the finalize call doesn't throw.
Deno.env.set("app.qr_token_pepper", "test-pepper-meta-orch-1076-0000000000000000");

const REF = "mingla_sess-1_abc";

function baseState(): FakeState {
  return {
    session: { id: "sess-1", status: "awaiting_web_redirect", order_id: null, total_cents: 537500, currency: "NGN" },
    finalizeCalls: 0,
    finalizeReturn: { orderId: "order-1", checkoutSessionId: "sess-1" },
    auditActions: [],
    sessionUpdates: [],
  };
}

Deno.test("charge.success: verify success + amount/currency match → finalize once", async () => {
  const state = baseState();
  const supabase = makeFakeSupabase(state);
  const verify = (_ref: string) =>
    Promise.resolve({ status: "success", amount: 537500, currency: "NGN", channel: "card", id: 99 });

  const result = await handlePaystackChargeSuccess(supabase, { reference: REF }, verify);
  assertEquals(result.status, "finalized");
  assertEquals(result.orderId, "order-1");
  assertEquals(state.finalizeCalls, 1);
});

Deno.test("idempotent replay: session already finalized → no second finalize", async () => {
  const state = baseState();
  state.session = { ...state.session!, order_id: "order-1", status: "paid_completed" };
  const supabase = makeFakeSupabase(state);
  const verify = (_ref: string) =>
    Promise.resolve({ status: "success", amount: 537500, currency: "NGN", channel: "card", id: 99 });

  const result = await handlePaystackChargeSuccess(supabase, { reference: REF }, verify);
  assertEquals(result.status, "replayed");
  assertEquals(result.orderId, "order-1");
  assertEquals(state.finalizeCalls, 0); // EXACTLY ONE order across both fires
});

Deno.test("amount mismatch → no finalize, session marked failed, audit written", async () => {
  const state = baseState();
  const supabase = makeFakeSupabase(state);
  // Verify returns a DIFFERENT amount than the session total (537500).
  const verify = (_ref: string) =>
    Promise.resolve({ status: "success", amount: 100, currency: "NGN", channel: "card", id: 99 });

  const result = await handlePaystackChargeSuccess(supabase, { reference: REF }, verify);
  assertEquals(result.status, "amount_mismatch");
  assertEquals(state.finalizeCalls, 0);
  assertEquals(state.session?.status, "failed");
  assertEquals(state.auditActions.includes("paystack.charge_amount_mismatch"), true);
});

Deno.test("currency mismatch → no finalize, session failed", async () => {
  const state = baseState();
  const supabase = makeFakeSupabase(state);
  const verify = (_ref: string) =>
    Promise.resolve({ status: "success", amount: 537500, currency: "GBP", channel: "card", id: 99 });

  const result = await handlePaystackChargeSuccess(supabase, { reference: REF }, verify);
  assertEquals(result.status, "currency_mismatch");
  assertEquals(state.finalizeCalls, 0);
  assertEquals(state.session?.status, "failed");
});

Deno.test("verify status != success → no finalize", async () => {
  const state = baseState();
  const supabase = makeFakeSupabase(state);
  const verify = (_ref: string) =>
    Promise.resolve({ status: "failed", amount: 537500, currency: "NGN", id: 99 });

  const result = await handlePaystackChargeSuccess(supabase, { reference: REF }, verify);
  assertEquals(result.status, "verify_not_success");
  assertEquals(state.finalizeCalls, 0);
});

Deno.test("orphan reference (no session) → no finalize, audit written", async () => {
  const state = baseState();
  state.session = null;
  const supabase = makeFakeSupabase(state);
  const verify = (_ref: string) =>
    Promise.resolve({ status: "success", amount: 537500, currency: "NGN", id: 99 });

  const result = await handlePaystackChargeSuccess(supabase, { reference: REF }, verify);
  assertEquals(result.status, "orphan");
  assertEquals(state.finalizeCalls, 0);
  assertEquals(state.auditActions.includes("paystack.charge_orphan_reference"), true);
});

Deno.test("signature verification: HMAC-SHA512 of raw body with secret key", async () => {
  const secret = "sk_test_meta_orch_1076";
  const rawBody = JSON.stringify({ event: "charge.success", data: { reference: REF } });
  // Compute the expected signature the same way Paystack does.
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const goodSig = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");

  assertEquals(await verifyPaystackSignature(rawBody, goodSig, secret), true);
  assertEquals(await verifyPaystackSignature(rawBody, "deadbeef", secret), false);
  assertEquals(await verifyPaystackSignature(rawBody, null, secret), false);
  // Tampered body → signature no longer matches.
  assertEquals(
    await verifyPaystackSignature(rawBody + "x", goodSig, secret),
    false,
  );
});
