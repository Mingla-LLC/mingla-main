/**
 * ADVERSARIAL test — mingla-tester, META-ORCH-1234 Bug A.
 * Different angle than the implementor: a Supabase fake that THROWS if a non-uuid
 * value reaches the audit_log.event_id column (mimicking Postgres's uuid type
 * rejection). Proves coerceEventId is the ONLY thing standing between the call
 * sites and a thrown insert — and that a real account.updated event id can never
 * throw the webhook.
 *
 * Fails-on-revert: if writeAudit stops coercing (passes input.event_id through),
 * the evt_/acct_ cases throw "invalid input syntax for type uuid" -> test FAILS.
 */
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { writeAudit } from "./audit.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fake that REJECTS like Postgres uuid column: any non-null event_id that is not
// a uuid => insert returns an error (writeAudit then throws).
function pgLikeSupabase(): {
  // deno-lint-ignore no-explicit-any
  client: any;
  inserted: () => Record<string, unknown> | null;
} {
  let captured: Record<string, unknown> | null = null;
  const client = {
    from(_t: string) {
      return {
        insert(row: Record<string, unknown>) {
          captured = row;
          const ev = row.event_id;
          if (ev !== null && (typeof ev !== "string" || !UUID_RE.test(ev))) {
            return Promise.resolve({
              error: {
                message: `invalid input syntax for type uuid: "${String(ev)}"`,
              },
            });
          }
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { client, inserted: () => captured };
}

// Representative account.updated path: syncAccount derives event_id from the
// Stripe event id (evt_...). Simulate every shape that previously threw.
const STRIPE_SHAPES = [
  "evt_1Tml2YI4pBxuXrhh", // account.updated event id
  "acct_1Tml2YI4pBxuXrhh", // connected account id
  "evt_3OaBcDeFgHiJkLmN9999", // longer evt
  "py_1Abc", // payout id
  "fee_1Abc", // application fee id
  "", // empty string
  "1Tml2YI4pBxuXrhh", // raw id without prefix
];

Deno.test("ADVERSARIAL: every Stripe-shaped event_id is coerced to null and NEVER throws the (pg-like) insert", async () => {
  for (const shape of STRIPE_SHAPES) {
    const { client, inserted } = pgLikeSupabase();
    // Must NOT throw — coercion turns it into null before the uuid column.
    await writeAudit(client, {
      user_id: null,
      brand_id: "1ce63bf4-1a33-4309-ab0b-ec23343e3569",
      event_id: shape,
      action: "stripe_connect.account_updated",
      target_type: "stripe_connect_account",
      target_id: "acct_1Tml2YI4pBxuXrhh",
    });
    assertEquals(
      inserted()?.event_id,
      null,
      `event_id="${shape}" should coerce to null`,
    );
  }
});

Deno.test("ADVERSARIAL: a real Mingla events.id uuid still reaches the column (not over-coerced)", async () => {
  const { client, inserted } = pgLikeSupabase();
  const realUuid = "1ce63bf4-1a33-4309-ab0b-ec23343e3569";
  await writeAudit(client, {
    user_id: null,
    brand_id: null,
    event_id: realUuid,
    action: "x",
    target_type: "t",
    target_id: "id",
  });
  assertEquals(inserted()?.event_id, realUuid);
});

Deno.test("ADVERSARIAL: control — if a raw Stripe id COULD reach the column, the pg-like fake DOES throw (proves the fake is real)", async () => {
  // Directly exercise the fake with a non-uuid to prove it would have thrown,
  // i.e. coercion is load-bearing, not a no-op.
  const { client } = pgLikeSupabase();
  await assertRejects(
    async () => {
      // Bypass writeAudit's coercion by calling insert directly with a raw evt_ id.
      const { error } = await client.from("audit_log").insert({
        event_id: "evt_raw_would_throw",
      });
      if (error) throw new Error(error.message);
    },
    Error,
    "invalid input syntax for type uuid",
  );
});
