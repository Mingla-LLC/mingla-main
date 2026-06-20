/**
 * META-ORCH-1161 COMPLIANCE-PAGES — behavioral test for the self-serve opt-out writer.
 *
 * Step 0.5 (implementor-owned happy-path regression): proves the opt-out path
 * WRITES the correct channel_suppressions AND marketing_unsubscribes rows for an
 * email and for a phone, and is idempotent (a re-submit tolerates the unique
 * violation and still reports success). Drives suppress.ts with a fake supabase
 * client that records every insert — no live edge runtime / DB needed.
 *
 * fails-on-revert: delete the marketing_unsubscribes loop (or the scope mapping)
 * in suppress.ts and the row-shape assertions below fail.
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  isUniqueViolation,
  type SupabaseLike,
  writeSuppressions,
} from "./suppress.ts";

interface Recorded {
  table: string;
  row: Record<string, unknown>;
}

/**
 * Fake client recording inserts. `conflictKeys` simulates already-present unique
 * keys: any insert whose computed key is in the set returns a 23505 error.
 */
function makeFakeClient(conflictKeys: Set<string> = new Set()): {
  client: SupabaseLike;
  inserts: Recorded[];
} {
  const inserts: Recorded[] = [];
  const client: SupabaseLike = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          // Synthetic conflict key per table to mimic the unique indexes.
          const key = table === "channel_suppressions"
            ? `cs:${row.contact}:${row.channel}:${row.scope}`
            : `mu:${row.contact_email ?? row.contact_phone}:${row.channel}:${row.scope}`;
          if (conflictKeys.has(key)) {
            return Promise.resolve({
              error: { code: "23505", message: "duplicate key value" },
            });
          }
          inserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { client, inserts };
}

Deno.test("writeSuppressions: email-only writes channel_suppressions(email) + marketing_unsubscribes(email)", async () => {
  const { client, inserts } = makeFakeClient();
  const res = await writeSuppressions(client, {
    email: "buyer@example.com",
    phone: null,
    scope: "marketing",
  });

  assertEquals(res.channelSuppressionsWritten, 1);
  assertEquals(res.marketingUnsubscribesWritten, 1);
  assertEquals(res.alreadySuppressed, 0);

  const cs = inserts.find((i) => i.table === "channel_suppressions");
  assert(cs, "expected a channel_suppressions insert");
  assertEquals(cs!.row.channel, "email");
  assertEquals(cs!.row.contact, "buyer@example.com");
  assertEquals(cs!.row.scope, "marketing"); // CHECK-valid
  assertEquals(cs!.row.reason, "unsubscribe"); // CHECK-valid
  assertEquals(cs!.row.brand_id, null); // global
  assertEquals(cs!.row.user_id, null);

  const mu = inserts.find((i) => i.table === "marketing_unsubscribes");
  assert(mu, "expected a marketing_unsubscribes insert");
  assertEquals(mu!.row.contact_email, "buyer@example.com");
  assertEquals(mu!.row.contact_phone, null); // CHECK: exactly one contact
  assertEquals(mu!.row.channel, "all"); // resolver expands to email+sms+rcs
  assertEquals(mu!.row.scope, "global"); // CHECK-valid legacy scope
});

Deno.test("writeSuppressions: phone-only writes channel_suppressions(sms) + marketing_unsubscribes(phone)", async () => {
  const { client, inserts } = makeFakeClient();
  const res = await writeSuppressions(client, {
    email: null,
    phone: "+19195551234",
    scope: "all",
  });

  assertEquals(res.channelSuppressionsWritten, 1);
  assertEquals(res.marketingUnsubscribesWritten, 1);

  const cs = inserts.find((i) => i.table === "channel_suppressions");
  assert(cs, "expected a channel_suppressions insert");
  assertEquals(cs!.row.channel, "sms");
  assertEquals(cs!.row.contact, "+19195551234");
  assertEquals(cs!.row.scope, "all"); // CHECK-valid

  const mu = inserts.find((i) => i.table === "marketing_unsubscribes");
  assert(mu, "expected a marketing_unsubscribes insert");
  assertEquals(mu!.row.contact_phone, "+19195551234");
  assertEquals(mu!.row.contact_email, null); // CHECK: exactly one contact
});

Deno.test("writeSuppressions: email AND phone writes BOTH channels in BOTH tables (4 rows)", async () => {
  const { client, inserts } = makeFakeClient();
  const res = await writeSuppressions(client, {
    email: "both@example.com",
    phone: "+19195550000",
    scope: "all",
  });
  assertEquals(res.channelSuppressionsWritten, 2);
  assertEquals(res.marketingUnsubscribesWritten, 2);
  assertEquals(inserts.length, 4);
});

Deno.test("writeSuppressions: idempotent — a re-submit (all keys conflict) reports success, writes nothing new", async () => {
  // Seed conflicts for every key this input would produce.
  const conflicts = new Set<string>([
    "cs:repeat@example.com:email:marketing",
    "mu:repeat@example.com:all:global",
  ]);
  const { client, inserts } = makeFakeClient(conflicts);
  const res = await writeSuppressions(client, {
    email: "repeat@example.com",
    phone: null,
    scope: "marketing",
  });
  assertEquals(res.channelSuppressionsWritten, 0);
  assertEquals(res.marketingUnsubscribesWritten, 0);
  assertEquals(res.alreadySuppressed, 2); // both honored as already-suppressed
  assertEquals(inserts.length, 0); // nothing newly recorded
});

Deno.test("writeSuppressions: a NON-unique DB error throws (no silent failure)", async () => {
  const client: SupabaseLike = {
    from() {
      return {
        insert() {
          return Promise.resolve({
            error: { code: "42P01", message: "relation does not exist" },
          });
        },
      };
    },
  };
  let threw = false;
  try {
    await writeSuppressions(client, {
      email: "x@example.com",
      phone: null,
      scope: "all",
    });
  } catch {
    threw = true;
  }
  assert(threw, "non-unique DB error must propagate, not be swallowed");
});

Deno.test("isUniqueViolation: detects 23505 and duplicate-key text", () => {
  assert(isUniqueViolation({ code: "23505" }));
  assert(isUniqueViolation({ message: "duplicate key value violates unique constraint" }));
  assert(!isUniqueViolation({ code: "42P01", message: "relation does not exist" }));
  assert(!isUniqueViolation(null));
});
