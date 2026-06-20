// META-ORCH-1161 Sub-A (REWORK 2026-06-20) — implementor regression test for the
// two tester-found P2 defects (TEST_META-ORCH-1161_SUBA_THIN_SLICE.md P2-1, P2-2).
//
// DIFFERENT ANGLE from the tester's orch_1161_anon_guest_path.test.ts: that file
// uses a fake client that NEVER simulates the DB UNIQUE conflict (so it pins the
// pre-fix gap with twilio===2). THIS file uses a fake client that DOES enforce the
// real partial UNIQUE(idempotency_key, channel) on guest delivery rows (added in
// migration 20261110000004) AND captures the contact-keyed ledger inserts — so it
// proves the FIXED behavior:
//
//   G1 (P2-2): a guest (user_id=null) SMS send now WRITES a contact-keyed
//       notification_deliveries row (notification_id=null, contact + idempotency_key
//       populated, provider_message_id set) — the observability gap is closed.
//   G2 (P2-1): a DOUBLE dispatch of the SAME idempotency_key on the guest path now
//       sends the SMS exactly ONCE — the second dispatch hits a 23505 on the dedupe
//       slot and SKIPS the provider HTTP. (Twilio HTTP count === 1, not 2.)
//
// fails-on-revert: deleting the dedupe-claim block in dispatchAnon (the
// `if (claim.duplicate) { … continue; }` guard) makes the second dispatch send
// again → G2's twilio===1 assertion fails. Deleting the insertGuestDelivery call
// makes G1's "ledger row written" assertion fail.
//
// Append-only: NEW file; no existing test modified.

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { dispatchV2, type MinimalClient } from "../_shared/notifyV2.ts";

const GUEST_CATEGORY = {
  key: "buyer_reservation_changed",
  is_transactional: true,
  urgency: "high",
  default_channels: ["inapp", "push", "email", "sms"],
  active: true,
};

interface LedgerRow {
  notification_id: string | null;
  contact: string | null;
  idempotency_key: string | null;
  channel: string;
  status: string;
  provider: string | null;
  provider_message_id: string | null;
  segments: number | null;
}

// A fake client that ENFORCES the real partial UNIQUE(idempotency_key, channel) on
// guest rows (notification_id IS NULL) — i.e. it returns a {code:'23505'} on a
// duplicate insert, exactly like Postgres. It captures every ledger row so the
// test can assert the contact-keyed write.
function makeGuestClient(ledger: LedgerRow[]): MinimalClient {
  return {
    // deno-lint-ignore no-explicit-any
    from(table: string): any {
      if (table === "notification_categories") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: GUEST_CATEGORY, error: null }) }),
          }),
        };
      }
      if (table === "notification_deliveries") {
        return {
          insert: (row: Record<string, unknown>) => {
            const idem = (row.idempotency_key as string | null) ?? null;
            const ch = row.channel as string;
            const nid = (row.notification_id as string | null) ?? null;
            // Enforce the partial UNIQUE(idempotency_key, channel) WHERE
            // idempotency_key IS NOT NULL AND notification_id IS NULL.
            if (idem !== null && nid === null) {
              const dup = ledger.some(
                (r) => r.idempotency_key === idem && r.channel === ch && r.notification_id === null,
              );
              if (dup) return Promise.resolve({ data: null, error: { code: "23505" } });
            }
            ledger.push({
              notification_id: nid,
              contact: (row.contact as string | null) ?? null,
              idempotency_key: idem,
              channel: ch,
              status: row.status as string,
              provider: (row.provider as string | null) ?? null,
              provider_message_id: (row.provider_message_id as string | null) ?? null,
              segments: (row.segments as number | null) ?? null,
            });
            return Promise.resolve({ data: null, error: null });
          },
          update: (patch: Record<string, unknown>) => ({
            eq: (_c1: string, idemVal: unknown) => ({
              eq: (_c2: string, chVal: unknown) => {
                for (const r of ledger) {
                  if (r.idempotency_key === idemVal && r.channel === chVal && r.notification_id === null) {
                    if (patch.status !== undefined) r.status = patch.status as string;
                    if (patch.provider_message_id !== undefined) {
                      r.provider_message_id = patch.provider_message_id as string | null;
                    }
                    if (patch.segments !== undefined) r.segments = patch.segments as number | null;
                  }
                }
                return Promise.resolve({ data: null, error: null });
              },
            }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        insert: () => Promise.resolve({ data: null, error: null }),
      };
    },
    rpc(fn: string): Promise<{ data: unknown; error: unknown }> {
      if (fn === "can_send") return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as MinimalClient;
}

interface NetCounters { twilio: number; resend: number }
function withStubbedFetch<T>(fn: (c: NetCounters) => Promise<T>): Promise<T> {
  const counters: NetCounters = { twilio: 0, resend: 0 };
  const orig = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("api.twilio.com")) counters.twilio++;
    if (u.includes("api.resend.com")) counters.resend++;
    return Promise.resolve(
      new Response(JSON.stringify({ sid: `SM-stub-${counters.twilio}`, id: "stub" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    // deno-lint-ignore no-explicit-any
  }) as any;
  return fn(counters).finally(() => {
    globalThis.fetch = orig;
  });
}

function setEnv() {
  Deno.env.set("TWILIO_ACCOUNT_SID", "ACtest");
  Deno.env.set("TWILIO_AUTH_TOKEN", "tokentest");
  Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MGtest");
  Deno.env.set("RESEND_API_KEY", "re_test");
}

// ── G1 (P2-2): a guest SMS send writes a contact-keyed deliveries row ──────────
Deno.test("REWORK G1: guest SMS send writes a contact-keyed notification_deliveries row (P2-2)", async () => {
  setEnv();
  Deno.env.set("SMS_LIVE_ENABLED_US", "true");
  const ledger: LedgerRow[] = [];
  await withStubbedFetch(async () => {
    await dispatchV2(makeGuestClient(ledger), {
      user_id: null, // GUEST
      contact: "+15551230000",
      category_key: "buyer_reservation_changed",
      payload: { reservation_id: "res-g1", brand_name: "Lantern & Vine", date: "Jun 20", time: "7:30 PM", party_size: 2 },
      idempotency_key: "buyer_reservation_changed:res-g1:T1",
      country_code: "US",
    });
  });
  Deno.env.delete("SMS_LIVE_ENABLED_US");

  const smsRow = ledger.find((r) => r.channel === "sms");
  assert(smsRow, "guest SMS send MUST write a notification_deliveries row (P2-2 ledger gap closed)");
  assertEquals(smsRow!.notification_id, null, "guest row is not tied to an inbox notification");
  assertEquals(smsRow!.contact, "+15551230000".toLowerCase(), "guest row is contact-keyed");
  assertEquals(smsRow!.idempotency_key, "buyer_reservation_changed:res-g1:T1", "guest row carries the idempotency_key");
  assertEquals(smsRow!.status, "sent", "ledger reconciled to the provider result");
  assert(smsRow!.provider_message_id !== null, "provider_message_id recorded for webhook reconcile");
});

// ── G2 (P2-1): a double dispatch of the SAME key sends SMS exactly ONCE ────────
Deno.test("REWORK G2: guest double-dispatch of the SAME idempotency_key sends SMS ONCE (P2-1 dedupe)", async () => {
  setEnv();
  Deno.env.set("SMS_LIVE_ENABLED_US", "true");
  const ledger: LedgerRow[] = [];
  const idem = "buyer_reservation_changed:res-g2:T1";
  const { counters } = await withStubbedFetch(async (counters) => {
    const input = {
      user_id: null,
      contact: "+15551230001",
      category_key: "buyer_reservation_changed",
      payload: { reservation_id: "res-g2", brand_name: "Lantern & Vine", date: "Jun 20", time: "7:30 PM", party_size: 2 },
      idempotency_key: idem,
      country_code: "US" as const,
    };
    // Two ticks with the SAME key (a double-claimed outbox row).
    await dispatchV2(makeGuestClient(ledger), input);
    await dispatchV2(makeGuestClient(ledger), input);
    return { counters };
  });
  Deno.env.delete("SMS_LIVE_ENABLED_US");

  // THE fix: the second dispatch hits a 23505 on the (idempotency_key, channel)
  // dedupe slot → skips the provider HTTP. Exactly ONE Twilio send.
  assertEquals(counters.twilio, 1, "guest dedupe → a duplicated drain tick sends SMS exactly once (P2-1)");
  // Exactly one sms ledger row exists for the key.
  const smsRows = ledger.filter((r) => r.channel === "sms" && r.idempotency_key === idem);
  assertEquals(smsRows.length, 1, "exactly one guest SMS ledger row for the idempotency_key");
});
