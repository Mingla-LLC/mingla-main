// #4541 R1.13 (SC-14): a failed answer stash releases the checkout session, so
// the held tickets come back at once instead of when the checkout expires.
// Hermetic: the real stashBrandFormOrRelease over a recording client; the
// handler wiring is covered by issue_4514_checkout_form.implementor.test.ts.
// MINGLA-INVARIANT: I-4541-STASH-REFUSAL-RELEASES | issue #4541 | every non-success return of the checkout answer stash (a refusal, a database error, or answers the stash lost) first marks the unpaid session failed with expires_at now, only where order_id is null; the response bodies are unchanged.
//
// FAILS-ON-REVERT: deleting any releaseUnpaidSession call in stashBrandFormOrRelease fails
// the matching case below (each asserts exactly one release with its reason).
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type CheckoutBrandForm,
  releaseUnpaidSession,
  stashBrandFormOrRelease,
} from "../brandFormCheckout.ts";

const SESSION = "45410000-0000-4000-8000-0000000005e1";
const EVENT = "45410000-0000-4000-8000-0000000005e2";
const PARSED: CheckoutBrandForm = {
  capable: true,
  form: {
    formId: "45410000-0000-4000-8000-0000000005f1",
    versionId: "45410000-0000-4000-8000-0000000005f2",
    answers: { "45410000-0000-4000-8000-0000000005f3": "Vegan" },
  },
};

interface Update {
  table: string;
  values: Record<string, unknown>;
  eq: Array<[string, unknown]>;
  is: Array<[string, unknown]>;
}

/** A session row as the database holds it; the update applies only when every filter matches. */
type SessionRow = Record<string, unknown>;
const UNPAID: SessionRow = {
  id: SESSION,
  status: "pending",
  order_id: null,
  stripe_payment_intent_id: null,
  stripe_checkout_session_id: null,
  provider_attempt_id: null,
};

function client(
  stash: { data: unknown; error: { message: string; details?: string } | null },
  row: SessionRow = { ...UNPAID },
) {
  const updates: Update[] = [];
  const rpcs: string[] = [];
  return {
    updates,
    rpcs,
    row,
    rpc(name: string, _args: Record<string, unknown>) {
      rpcs.push(name);
      return Promise.resolve(stash);
    },
    from(table: string) {
      const u: Update = { table, values: {}, eq: [], is: [] };
      const chain = {
        update(values: Record<string, unknown>) {
          u.values = values;
          updates.push(u);
          return chain;
        },
        eq(col: string, val: unknown) {
          u.eq.push([col, val]);
          return chain;
        },
        is(col: string, val: unknown) {
          u.is.push([col, val]);
          return chain;
        },
        // Awaiting the builder runs the update against the row, like PostgREST.
        then(resolve: (v: { error: null }) => void) {
          const matches = u.eq.every(([c, v]) => row[c] === v) &&
            u.is.every(([c, v]) => row[c] === v);
          if (matches) Object.assign(row, u.values);
          resolve({ error: null });
        },
      };
      return chain;
    },
  };
}

const respond = (body: Record<string, unknown>, status: number) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

async function call(stash: Parameters<typeof client>[0], checkOutcome = "stash") {
  const c = client(stash);
  const res = await stashBrandFormOrRelease(c, {
    checkoutSessionId: SESSION,
    eventId: EVENT,
    parsed: PARSED,
    buyerUserId: null,
    ticketLinkHash: null,
    checkOutcome,
  }, respond);
  return { c, res };
}

function assertReleased(c: ReturnType<typeof client>, reason: string) {
  assertEquals(c.updates.length, 1);
  const u = c.updates[0];
  assertEquals(u.table, "ticket_checkout_sessions");
  assertEquals(u.values.status, "failed");
  assertEquals(u.values.failure_reason, reason);
  assert(Date.parse(String(u.values.expires_at)) <= Date.now());
  assertEquals(u.eq, [["id", SESSION]]);
  assertEquals(u.is, [
    ["order_id", null],
    ["stripe_payment_intent_id", null],
    ["stripe_checkout_session_id", null],
    ["provider_attempt_id", null],
  ]);
  assertEquals(c.row.status, "failed");
}

Deno.test("SC-14 a stash database error answers 409 brand_form_stash_failed and releases the session", async () => {
  const { c, res } = await call({ data: null, error: { message: "could not write" } });
  assert(res !== null);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "brand_form_stash_failed" });
  assertEquals(c.rpcs, ["brand_form_checkout_stash"]);
  assertReleased(c, "brand_form_stash_failed");
});

Deno.test("SC-14 a stash refusal keeps its body and releases the session with its code", async () => {
  const { c, res } = await call({
    data: null,
    error: { message: "form_changed", details: JSON.stringify({ formId: "f", versionId: "v" }) },
  });
  assert(res !== null);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "form_changed", formId: "f", versionId: "v" });
  assertReleased(c, "form_changed");
});

Deno.test("SC-14 answers the stash lost (check said stash) are 409 and release the session", async () => {
  const { c, res } = await call({ data: { outcome: "to_answer", reason: "not_visible" }, error: null });
  assert(res !== null);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "brand_form_stash_failed" });
  assertReleased(c, "brand_form_stash_failed");
});

Deno.test("SC-14 a kept stash (or a finalized replay) continues and releases nothing", async () => {
  for (const outcome of ["stash", "finalized"]) {
    const { c, res } = await call({ data: { outcome }, error: null });
    assertEquals(res, null);
    assertEquals(c.updates.length, 0);
  }
  // A check that never said "stash" is not a loss either.
  const { c, res } = await call({ data: { outcome: "none" }, error: null }, "none");
  assertEquals(res, null);
  assertEquals(c.updates.length, 0);
});

Deno.test("releaseUnpaidSession releases an unpaid session", async () => {
  const c = client({ data: null, error: null });
  await releaseUnpaidSession(c, SESSION, "queue_join_failed");
  assertReleased(c, "queue_join_failed");
});

// #4541 review fix 3: a client retry with the same idempotency key can return a
// session that already carries a payment reference. A stash refusal then must
// answer its refusal WITHOUT releasing the session (the payment may still
// complete; releasing would free held stock and oversell).
// FAILS-ON-REVERT: deleting any of the three payment-reference filters in
// releaseUnpaidSession fails T-PAID (that row is then marked failed).
Deno.test("T-PAID a session with a payment reference is never released by a stash refusal", async () => {
  for (const ref of [
    { stripe_payment_intent_id: "pi_123" },
    { stripe_payment_intent_id: "mingla_45410000-0000-4000-8000-0000000005e1" },
    { stripe_checkout_session_id: "cs_123" },
    { provider_attempt_id: "45410000-0000-4000-8000-0000000005a9" },
    { order_id: "45410000-0000-4000-8000-0000000005a8" },
  ]) {
    const row = { ...UNPAID, ...ref };
    const c = client({ data: null, error: { message: "could not write" } }, row);
    const res = await stashBrandFormOrRelease(c, {
      checkoutSessionId: SESSION,
      eventId: EVENT,
      parsed: PARSED,
      buyerUserId: null,
      ticketLinkHash: null,
      checkOutcome: "stash",
    }, respond);
    assert(res !== null);
    assertEquals(res.status, 409);
    assertEquals(await res.json(), { error: "brand_form_stash_failed" });
    assertEquals(row.status, "pending", JSON.stringify(ref));
    assertEquals(row.expires_at, undefined);
  }
});
