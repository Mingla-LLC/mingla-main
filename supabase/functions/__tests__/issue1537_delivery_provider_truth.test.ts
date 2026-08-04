// Issue #1537 — DELIVERY LEDGER PROVIDER TRUTH.
//
// IMPLEMENTOR HAPPY-PATH REGRESSION TEST.
//
// WHY THIS EXISTS. `notifyV2` stamped `notification_deliveries.provider` from a
// per-channel constant — `CHANNEL_PROVIDER = { … sms: "twilio" … }` — at every
// SMS call site, regardless of which provider handled the send. Nigeria routes
// to Termii (#1518/#1227), so every Nigerian text was recorded as Twilio and
// the production ledger contained ZERO `termii` rows. The #1529 SC-11 live-fire
// (contact +2348162646567, held back by the NIGERIA kill switch) recorded
// `channel=sms status=skipped provider=twilio failed_reason=provider_kill_switch_off`
// — a Nigerian skip attributed to the American provider, which is why SC-11 had
// to be argued by elimination instead of read off the ledger.
//
// WHAT THIS PINS:
//   T-1  an NG destination that SENDS is ledgered `termii` (and only Termii is called);
//   T-2  a US destination that SENDS is ledgered `twilio` (and only Twilio is called);
//   T-3  the SC-11 repro — an NG destination gated by the NG kill switch is
//        ledgered `termii` with ZERO provider HTTP, so the skip is attributable
//        to the market that caused it;
//   T-4  a `no_contact` skip records the contact that was REJECTED (three
//        production rows carried contact=NULL) and claims NO provider;
//   T-5  a `can_send` suppression on an NG handset is attributed to `termii`;
//   T-6  the guest/anon path reconciles its contact-keyed row to `termii`;
//   T-7  the reported provider is emitted BY THE SENDER THAT RAN, so a miswired
//        country→sender branch is caught rather than papered over.
//
// TEST DISCIPLINE (two lessons this area has already paid for):
//   - BEHAVIOUR, NOT STRING PRESENCE (#1518). Nothing here greps a source file.
//     Every assertion reads a ledger row produced by executing `dispatchV2`, or
//     a value returned by executing `smsAdapter.send()`, with the provider HTTP
//     recorded so "who was actually called" is observed rather than inferred.
//   - NO VACUOUS PASSES (#1529). Every lookup asserts its match count is
//     GREATER THAN ZERO *before* asserting anything about the match, so a
//     filter that stops matching can never read as success. `pickRows` below
//     enforces that for all of them.
//
// fails-on-revert: restoring `sms: "twilio"` to CHANNEL_PROVIDER and stamping it
// at the SMS call sites makes T-1 (termii→twilio), T-3 (the SC-11 row) and T-6
// fail. Miswiring the sender branch so NG calls twilioSend fails T-1 and T-7.
// Deleting the `contact` argument on the no_contact write fails T-4. Exact
// commit hashes are in the #1537 implementation report.
//
// Append-only: NEW file; no existing test modified.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { dispatchV2, type MinimalClient } from "../_shared/notifyV2.ts";
import { smsAdapter } from "../_shared/adapters/smsAdapter.ts";

const TWILIO_HOST = "api.twilio.com";
const TERMII_HOST = "v3.api.termii.com";
const NG_NUMBER = "+2348012345678";
const US_NUMBER = "+14155550123";

const OWNED_KEYS = [
  "MINGLA_DELIVERY_FLAGS_JSON",
  "MINGLA_RUNTIME_CONFIG_JSON",
  "SMS_LIVE_ENABLED_NG",
  "SMS_LIVE_ENABLED_US",
  "TERMII_API_KEY",
  "TERMII_BASE_URL",
  "TERMII_SENDER_ID",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_STATUS_CALLBACK_SECRET",
  "SUPABASE_URL",
];

// ── Recording fetch + hard-reset env ────────────────────────────────────────
let captures: string[] = [];

async function withHarness(
  setup: () => void,
  fn: () => Promise<void>,
): Promise<void> {
  const snap: Record<string, string | undefined> = {};
  for (const k of OWNED_KEYS) snap[k] = Deno.env.get(k);
  const realFetch = globalThis.fetch;
  captures = [];
  globalThis.fetch = ((input: unknown) => {
    const url = typeof input === "string" ? input : String(input);
    captures.push(url);
    if (url.includes(TERMII_HOST)) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ code: "ok", message_id: "tm_1537" }),
          { status: 200 },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ sid: "SM_1537" }), { status: 201 }),
    );
  }) as unknown as typeof fetch;
  try {
    for (const k of OWNED_KEYS) Deno.env.delete(k);
    setup();
    await fn();
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(snap)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

const twilioCalls = () => captures.filter((u) => u.includes(TWILIO_HOST));
const termiiCalls = () => captures.filter((u) => u.includes(TERMII_HOST));

function bundle(ng: boolean, us: boolean): string {
  return JSON.stringify({
    schema_version: 1,
    marketing_send_live_enabled: false,
    sms_live_enabled: { ng, us },
  });
}

function setAllCreds(): void {
  Deno.env.set("TERMII_API_KEY", "tk_1537");
  Deno.env.set("TERMII_BASE_URL", `https://${TERMII_HOST}`);
  Deno.env.set("TERMII_SENDER_ID", "Mingla");
  Deno.env.set("TWILIO_ACCOUNT_SID", "AC_1537");
  Deno.env.set("TWILIO_AUTH_TOKEN", "tok_1537");
  Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MG_1537");
}

// ── Ledger-capturing fake client ────────────────────────────────────────────
interface LedgerRow {
  notification_id: string | null;
  contact: string | null;
  idempotency_key: string | null;
  channel: string;
  status: string;
  provider: string | null;
  provider_message_id: string | null;
  failed_reason: string | null;
  segments: number | null;
}

const CATEGORY = {
  key: "buyer_reservation_changed",
  is_transactional: true,
  urgency: "high",
  default_channels: ["inapp", "sms"],
  active: true,
};

const PAYLOAD = {
  reservation_id: "res-1537",
  status: "confirmed",
  date: "Aug 4",
  time: "7:30 PM",
  party_size: 4,
  brand_name: "Lantern & Vine",
};

/**
 * Captures every `notification_deliveries` row and applies updates the way the
 * guest reconcile does, so the row a test reads is the row the code wrote —
 * including the columns (`provider`, `contact`) this issue is about.
 */
function makeClient(
  ledger: LedgerRow[],
  opts: { smsAllowed?: boolean } = {},
): MinimalClient {
  const smsAllowed = opts.smsAllowed !== false;
  return {
    // deno-lint-ignore no-explicit-any
    from(table: string): any {
      if (table === "notification_categories") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: CATEGORY, error: null }),
            }),
          }),
        };
      }
      if (table === "notifications") {
        return {
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: "notif-1537" }, error: null }),
            }),
          }),
        };
      }
      if (table === "notification_deliveries") {
        return {
          insert: (row: Record<string, unknown>) => {
            ledger.push({
              notification_id: (row.notification_id as string | null) ?? null,
              contact: (row.contact as string | null) ?? null,
              idempotency_key: (row.idempotency_key as string | null) ?? null,
              channel: row.channel as string,
              status: row.status as string,
              provider: (row.provider as string | null) ?? null,
              provider_message_id:
                (row.provider_message_id as string | null) ?? null,
              failed_reason: (row.failed_reason as string | null) ?? null,
              segments: (row.segments as number | null) ?? null,
            });
            return Promise.resolve({ data: null, error: null });
          },
          update: (patch: Record<string, unknown>) => ({
            eq: (_c1: string, idemVal: unknown) => ({
              eq: (_c2: string, chVal: unknown) => {
                for (const r of ledger) {
                  if (
                    r.idempotency_key === idemVal && r.channel === chVal &&
                    r.notification_id === null
                  ) {
                    if (patch.status !== undefined) {
                      r.status = patch.status as string;
                    }
                    if (patch.provider !== undefined) {
                      r.provider = patch.provider as string | null;
                    }
                    if (patch.provider_message_id !== undefined) {
                      r.provider_message_id = patch
                        .provider_message_id as string | null;
                    }
                    if (patch.failed_reason !== undefined) {
                      r.failed_reason = patch.failed_reason as string | null;
                    }
                    if (patch.segments !== undefined) {
                      r.segments = patch.segments as number | null;
                    }
                  }
                }
                return Promise.resolve({ data: null, error: null });
              },
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
        insert: () => Promise.resolve({ data: null, error: null }),
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "can_send") {
        const channel = args.p_channel as string;
        if (channel === "sms" && !smsAllowed) {
          return Promise.resolve({ data: false, error: null });
        }
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as MinimalClient;
}

/**
 * #1529's lesson, enforced mechanically: a ledger lookup MUST prove it matched
 * something before its content is asserted. A filter that silently stops
 * matching would otherwise turn every downstream assertion into a no-op and the
 * test would pass while the product was broken.
 */
function pickRows(
  ledger: LedgerRow[],
  pred: (r: LedgerRow) => boolean,
  label: string,
): LedgerRow[] {
  const rows = ledger.filter(pred);
  assert(
    rows.length > 0,
    `VACUITY GUARD: ${label} matched 0 of ${ledger.length} ledger rows — ` +
      `the assertions below would pass by matching nothing. Rows: ` +
      JSON.stringify(ledger),
  );
  return rows;
}

const smsRows = (ledger: LedgerRow[]) =>
  pickRows(ledger, (r) => r.channel === "sms", "channel=sms");

// ---------------------------------------------------------------------------
// T-1 — AN NG DESTINATION THAT SENDS IS LEDGERED `termii`.
// The headline claim: the ledger names the provider that did the work.
// ---------------------------------------------------------------------------
Deno.test("#1537 T-1: an NG send is ledgered provider=termii, and only Termii is called", async () => {
  await withHarness(() => {
    setAllCreds();
    Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", bundle(true, true));
  }, async () => {
    const ledger: LedgerRow[] = [];
    const res = await dispatchV2(makeClient(ledger), {
      user_id: "user-1537",
      contact: NG_NUMBER,
      category_key: CATEGORY.key,
      payload: PAYLOAD,
      idempotency_key: "idem-1537-t1",
    });
    assertEquals(res.success, true);

    const rows = smsRows(ledger);
    assertEquals(rows.length, 1, "exactly one SMS attempt row");
    assertEquals(rows[0].status, "sent");
    assertEquals(
      rows[0].provider,
      "termii",
      "a Nigerian send MUST be ledgered as termii — this is the #1537 defect",
    );
    assertEquals(rows[0].provider_message_id, "tm_1537");

    // The label must agree with observed traffic, not merely be well-formed.
    assertEquals(termiiCalls().length, 1, "Termii handled it");
    assertEquals(twilioCalls().length, 0, "Twilio must not be involved");
  });
});

// ---------------------------------------------------------------------------
// T-2 — A US DESTINATION THAT SENDS IS LEDGERED `twilio`.
// The control that stops T-1 being satisfied by stamping `termii` everywhere.
// ---------------------------------------------------------------------------
Deno.test("#1537 T-2: a US send is ledgered provider=twilio, and only Twilio is called", async () => {
  await withHarness(() => {
    setAllCreds();
    Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", bundle(true, true));
  }, async () => {
    const ledger: LedgerRow[] = [];
    await dispatchV2(makeClient(ledger), {
      user_id: "user-1537",
      contact: US_NUMBER,
      category_key: CATEGORY.key,
      payload: PAYLOAD,
      idempotency_key: "idem-1537-t2",
    });

    const rows = smsRows(ledger);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].status, "sent");
    assertEquals(
      rows[0].provider,
      "twilio",
      "a US send MUST still be ledgered as twilio — no regression for the live market",
    );
    assertEquals(rows[0].provider_message_id, "SM_1537");
    assertEquals(twilioCalls().length, 1);
    assertEquals(termiiCalls().length, 0);
  });
});

// ---------------------------------------------------------------------------
// T-3 — THE SC-11 REPRODUCTION. This is the exact production row.
// NG dark, US live: a +234 contact is held back by the NIGERIA kill switch and
// must be ledgered against the NIGERIAN provider. Before the fix this row read
// `provider=twilio`, which is why the kill switch's own effect could not be
// demonstrated from the ledger.
// ---------------------------------------------------------------------------
Deno.test("#1537 T-3: an NG kill-switch skip is ledgered termii with ZERO provider HTTP", async () => {
  await withHarness(() => {
    setAllCreds();
    Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", bundle(false, true));
  }, async () => {
    const ledger: LedgerRow[] = [];
    await dispatchV2(makeClient(ledger), {
      user_id: "user-1537",
      contact: NG_NUMBER,
      category_key: CATEGORY.key,
      payload: PAYLOAD,
      idempotency_key: "idem-1537-t3",
    });

    const rows = smsRows(ledger);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].status, "skipped");
    assertEquals(rows[0].failed_reason, "provider_kill_switch_off");
    assertEquals(
      rows[0].provider,
      "termii",
      "a skip must name the provider that WOULD have carried it, so the skip is " +
        "attributable to the Nigerian kill switch rather than to Twilio",
    );
    // The dark-market guarantee is unchanged and still observed, not assumed.
    assertEquals(captures.length, 0, "a dark market makes no HTTP at all");
  });
});

// ---------------------------------------------------------------------------
// T-4 — THE `no_contact` ROW RECORDS WHO WAS MISSED.
// Three production rows carried status=skipped, failed_reason=no_contact and
// contact=NULL, so the ledger recorded that someone was not reached but not
// who. There is also no destination here, hence no market and no provider —
// null, never a fabricated "twilio".
// ---------------------------------------------------------------------------
Deno.test("#1537 T-4: a no_contact skip records the rejected contact and claims no provider", async () => {
  await withHarness(() => {
    setAllCreds();
    Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", bundle(true, true));
  }, async () => {
    const ledger: LedgerRow[] = [];
    // An SMS channel handed an EMAIL address: allowed by policy, unsendable.
    await dispatchV2(makeClient(ledger), {
      user_id: "user-1537",
      contact: " Guest@Example.COM ",
      category_key: CATEGORY.key,
      payload: PAYLOAD,
      idempotency_key: "idem-1537-t4",
    });

    const rows = pickRows(
      ledger,
      (r) => r.channel === "sms" && r.failed_reason === "no_contact",
      "channel=sms AND failed_reason=no_contact",
    );
    assertEquals(rows.length, 1);
    assertEquals(rows[0].status, "skipped");
    assertEquals(
      rows[0].contact,
      "guest@example.com",
      "the rejected recipient must be recoverable from the ledger, normalized " +
        "the same way the guest path already normalizes this column",
    );
    assertEquals(
      rows[0].provider,
      null,
      "no destination means no market — naming a provider here would be fabrication",
    );
    assertEquals(captures.length, 0);
  });
});

// ---------------------------------------------------------------------------
// T-5 — A POLICY SUPPRESSION IS ATTRIBUTABLE TOO.
// `can_send` denied the SMS. No adapter ran, but the destination is known, so
// the market that would have carried it is known.
// ---------------------------------------------------------------------------
Deno.test("#1537 T-5: a can_send suppression on an NG handset is attributed to termii", async () => {
  await withHarness(() => {
    setAllCreds();
    Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", bundle(true, true));
  }, async () => {
    const ledger: LedgerRow[] = [];
    await dispatchV2(makeClient(ledger, { smsAllowed: false }), {
      user_id: "user-1537",
      contact: NG_NUMBER,
      category_key: CATEGORY.key,
      payload: PAYLOAD,
      idempotency_key: "idem-1537-t5",
    });

    const rows = pickRows(
      ledger,
      (r) => r.channel === "sms" && r.status === "suppressed",
      "channel=sms AND status=suppressed",
    );
    assertEquals(rows.length, 1);
    assertEquals(rows[0].failed_reason, "can_send_denied");
    assertEquals(rows[0].provider, "termii");
    assertEquals(captures.length, 0);
  });
});

// ---------------------------------------------------------------------------
// T-6 — THE GUEST/ANON PATH. Contact-keyed rows (notification_id NULL) are
// claimed before the send and reconciled after it; both halves must name the
// real provider, or a guest Nigerian booking confirmation is as unauditable as
// an authenticated one.
// ---------------------------------------------------------------------------
Deno.test("#1537 T-6: a guest NG send reconciles its contact-keyed row to termii", async () => {
  await withHarness(() => {
    setAllCreds();
    Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", bundle(true, true));
  }, async () => {
    const ledger: LedgerRow[] = [];
    await dispatchV2(makeClient(ledger), {
      user_id: null, // guest → dispatchAnon
      contact: NG_NUMBER,
      category_key: CATEGORY.key,
      payload: PAYLOAD,
      idempotency_key: "idem-1537-t6",
    });

    const rows = pickRows(
      ledger,
      (r) => r.channel === "sms" && r.notification_id === null,
      "channel=sms AND notification_id IS NULL (guest row)",
    );
    assertEquals(rows.length, 1);
    assertEquals(rows[0].contact, NG_NUMBER);
    assertEquals(rows[0].status, "sent");
    assertEquals(rows[0].provider, "termii");
    assertEquals(rows[0].provider_message_id, "tm_1537");
    assertEquals(termiiCalls().length, 1);
    assertEquals(twilioCalls().length, 0);
  });
});

// ---------------------------------------------------------------------------
// T-7 — THE REPORTED PROVIDER COMES FROM THE SENDER THAT RAN.
// This is what makes T-1/T-2 falsifiable. If the adapter labelled results from
// its own country selection rather than from the sender's own return value, a
// miswired branch (NG → twilioSend) would report `termii` while Twilio did the
// work, and T-1 would pass on a broken product. Pairing the returned provider
// with the observed HTTP host closes that.
// ---------------------------------------------------------------------------
Deno.test("#1537 T-7: the returned provider always matches the host that was actually called", async () => {
  const cases: Array<{ to: string; provider: string; host: string }> = [
    { to: NG_NUMBER, provider: "termii", host: TERMII_HOST },
    { to: US_NUMBER, provider: "twilio", host: TWILIO_HOST },
  ];
  for (const c of cases) {
    await withHarness(() => {
      setAllCreds();
      Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", bundle(true, true));
    }, async () => {
      const r = await smsAdapter.send({
        to: c.to,
        brandName: "Lantern & Vine",
        message: "Your booking is confirmed.",
        countryCode: null,
      });
      assertEquals(r.status, "sent", c.to);
      assertEquals(r.provider, c.provider, c.to);
      assert(captures.length > 0, `VACUITY GUARD: no HTTP observed for ${c.to}`);
      assertEquals(
        captures.filter((u) => u.includes(c.host)).length,
        captures.length,
        `every call for ${c.to} must go to ${c.host}; reporting ` +
          `${c.provider} while calling another host is the failure mode this ` +
          `assertion exists to catch. Observed: ${JSON.stringify(captures)}`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// T-8 — NULL IS THE HONEST ANSWER WHERE NO PROVIDER WAS EVER SELECTED.
// An unroutable input has no market. Inventing one would re-create the defect
// in a new place.
// ---------------------------------------------------------------------------
Deno.test("#1537 T-8: unroutable destinations report provider=null, not a guess", async () => {
  await withHarness(() => {
    setAllCreds();
    Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", bundle(true, true));
  }, async () => {
    const invalid = await smsAdapter.send({
      to: "not-a-number",
      brandName: "Lantern & Vine",
      message: "Your booking is confirmed.",
    });
    assertEquals(invalid.status, "failed");
    assertEquals(invalid.error, "invalid_recipient");
    assertEquals(invalid.provider, null);

    // A well-formed E.164 whose calling code is unmapped: #1529 fails this
    // closed, and #1537 must not put a provider name on it.
    const unmapped = await smsAdapter.send({
      to: "+9991234567",
      brandName: "Lantern & Vine",
      message: "Your booking is confirmed.",
    });
    assertEquals(unmapped.status, "skipped");
    assertEquals(unmapped.error, "country_unresolved");
    assertEquals(unmapped.provider, null);

    assertEquals(captures.length, 0, "neither case may touch a provider");
  });
});
