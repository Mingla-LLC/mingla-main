// #4273 (country switches) — TESTER ADVERSARIAL: a hostile or broken database
// answer must never text anyone through a wrong sender.
//
// The implementor's suites hand marketing-send a pre-parsed snapshot
// (options.smsSwitches) or a clean RPC payload. This suite attacks the other
// side: the REAL loader (loadSmsCountrySwitches via the
// sms_marketing_switches_v1 RPC), the REAL route rule and the REAL adapter
// (fetch stubbed) are fed what a corrupted row, a bad config SID, a hand-made
// UPDATE that slipped past the CHECKs, or a flaky RPC would return. Every case
// carries a positive control in the same pass so a "nothing sent" result can
// never pass vacuously.
//
//   X1 the config SID is the TRANSACTIONAL service (MG1942...), GB on → GB is
//      not texted; US/NG still go out; no request carries MG1942 as a marketing
//      sender. (fails on revert of the transactional-SID refusal in
//      _shared/smsCountrySwitches.ts parseSmsCountrySwitches, 3ba7474cb6)
//   X2 a SID in the wrong shape (upper-case hex, trailing newline) → GB not texted.
//   X3 hand-corrupted rows (US marketing_service, NG toll_free, GB toll_free),
//      all on → zero provider HTTP.
//   X4 country codes in the wrong case / with whitespace ("gb", " GB ") → GB
//      not texted (the row is dropped, never matched loosely).
//   X5 rows forced on before they are ready (IE registration not done, BE needs
//      a local number) → not texted; IE once registered → texted on the DB
//      marketing SID. (fails on revert of the registration check in
//      smsMarketingRouteFromSwitches, 3ba7474cb6)
//   X6 type confusion (marketingEnabled "true", registrationDone 1) → dropped.
//   X7 the RPC rejects / answers a string → unreadable on every try: legacy
//      rows say sms_rate_book_unavailable, zero HTTP.
//   X8 a flaky RPC (error, then a good answer) recovers on the retry and sends
//      on the fresh snapshot; a country switched OFF between the quote and the
//      send is not texted (the send reads its own snapshot).
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FakeTime } from "https://deno.land/std@0.224.0/testing/time.ts";
import { processClaimedCampaigns, smsQuoteInputs } from "./index.ts";
import { MAPPED_COUNTRIES } from "../_shared/e164Country.ts";
import { SMS_COUNTRIES } from "../_shared/smsCountries.ts";

const MARKETING_SID = "MG9d42785c51834395018b52144736b9a7";
const TRANSACTIONAL_SID = "MG1942fbb549187fcf77c0e860405abf58";
const TOLL_FREE_ENV_SID = "MG4273tollfreeX";

const US = "+12025550142";
const NG = "+2348031104273";
const GB = "+447700900123";
const IE = "+353851234567";
const BE = "+32470123456";
// Monday 17:00Z: Washington 12:00, London/Dublin 17:00, Brussels 18:00,
// Lagos 18:00 — every window open.
const SEND_AT = new Date("2026-11-09T17:00:00Z");

const ENV: Record<string, string> = {
  MINGLA_DELIVERY_FLAGS_JSON: JSON.stringify({
    schema_version: 1,
    marketing_send_live_enabled: true,
    sms_live_enabled: { us: true, ng: true },
  }),
  TWILIO_ACCOUNT_SID: "AC4273tester",
  TWILIO_AUTH_TOKEN: "tok4273tester",
  TWILIO_MESSAGING_SERVICE_SID: TOLL_FREE_ENV_SID,
  TERMII_API_KEY: "tk4273tester",
  TERMII_BASE_URL: "https://termii.tester.test",
  TERMII_SENDER_ID: "Mingla",
  UNSUBSCRIBE_TOKEN_SECRET: "issue4273-tester-secret-0123456789abcdef",
  MINGLA_TRACKING_LINK_ORIGIN: "https://usemingla.com/m",
};

type Row = Record<string, unknown>;

/** A DB-shaped switches payload as sms_marketing_switches_v1 would return it. */
function payload(
  on: readonly string[],
  opts: {
    sid?: unknown;
    done?: readonly string[];
    patch?: (rows: Row[]) => Row[];
  } = {},
): Record<string, unknown> {
  const onSet = new Set(on);
  const done = new Set(opts.done ?? []);
  const rows: Row[] = MAPPED_COUNTRIES.map((country) => {
    const profile = SMS_COUNTRIES[country];
    return {
      country,
      marketingEnabled: onSet.has(country),
      sender: profile.sender === "alphanumeric"
        ? "marketing_service"
        : profile.sender === "needs_number"
        ? "needs_local_number"
        : profile.sender,
      registrationRequired: profile.registrationRequired,
      registrationDone: done.has(country),
    };
  });
  return {
    marketingServiceSid: "sid" in opts ? opts.sid : MARKETING_SID,
    countries: opts.patch ? opts.patch(rows) : rows,
  };
}

const replace = (country: string, fields: Row) => (rows: Row[]) =>
  rows.map((r) => (r.country === country ? { ...r, ...fields } : r));

type Write = { table: string; op: string; payload: unknown };
type RpcAnswer = () => Promise<{ data: unknown; error: unknown }>;

function fakeDb(phones: string[], sealed: boolean, switchesRpc: RpcAnswer) {
  const brandId = "42730000-0000-4000-8000-0000000000b2";
  const writes: Write[] = [];
  let switchesCalls = 0;
  const person = (key: string, phone: string) => ({
    contact_key: key,
    display_name: "Guest",
    first_name: "Guest",
    raw_email: null,
    raw_phone: phone,
    order_count: 1,
    total_spend_minor: 0,
    total_spend_currency: "USD",
    last_event_id: null,
    last_event_name: null,
    last_purchase_at: null,
    email_marketing_ok: false,
    sms_marketing_ok: true,
  });
  // Every country under attack is PRICED, so a skip can only come from the
  // switches, never from a missing price.
  const priceRows = [
    ["US", "twilio", "USD", 83, 100],
    ["NG", "termii", "NGN", 500, 1],
    ["GB", "twilio", "USD", 560, 100],
    ["IE", "twilio", "USD", 900, 100],
    ["BE", "twilio", "USD", 1000, 100],
  ].map(([country, provider, currency, n, d]) => ({
    country,
    provider,
    currency,
    minor_numerator: n,
    minor_denominator: d,
    source: provider === "termii" ? "termii_fixed" : "twilio_pricing_api",
    source_reference: `${country}-tester`,
    fetched_at: "2026-11-08T06:17:00.000Z",
  }));
  const builder = (table: string) => {
    let op = "select";
    const filters: Array<[string, unknown]> = [];
    const result = () => {
      if (op === "upsert" && table === "marketing_messages") {
        return { data: { id: crypto.randomUUID() }, error: null };
      }
      if (op !== "select") return { data: null, error: null };
      if (table === "sms_country_prices") return { data: priceRows, error: null };
      if (table === "marketing_audiences") {
        return {
          data: {
            id: "aud",
            brand_id: brandId,
            query_definition: { kind: "all_brand_people", brand_id: brandId },
          },
          error: null,
        };
      }
      if (table === "brands") {
        return filters.some(([m]) => m === "in")
          ? { data: [{ id: brandId, slug: "lantern-room" }], error: null }
          : {
            data: { id: brandId, name: "Lantern Room", slug: "lantern-room" },
            error: null,
          };
      }
      if (table === "marketing_messages") return { data: null, error: null };
      if (table === "marketing_book_send_executions") {
        return {
          data: sealed ? { id: "exec", scheduled_for: null } : null,
          error: null,
        };
      }
      return { data: [], error: null };
    };
    const chain: Record<string, unknown> = {};
    for (
      const method of ["eq", "in", "is", "neq", "or", "order", "range", "limit"]
    ) {
      chain[method] = (_column: string, value: unknown) => {
        filters.push([method, value]);
        return chain;
      };
    }
    const write = (kind: string) => (p?: unknown) => {
      op = kind;
      writes.push({ table, op, payload: p ?? null });
      return chain;
    };
    chain.select = () => chain;
    chain.insert = write("insert");
    chain.update = write("update");
    chain.upsert = write("upsert");
    chain.delete = write("delete");
    chain.maybeSingle = () => Promise.resolve(result());
    chain.single = () => Promise.resolve(result());
    chain.then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve(result()).then(resolve, reject);
    return chain;
  };
  return {
    writes,
    switchesCalls: () => switchesCalls,
    client: {
      from: builder,
      rpc: (name: string) => {
        if (name === "sms_marketing_switches_v1") {
          switchesCalls += 1;
          return switchesRpc();
        }
        return Promise.resolve(
          name === "biz_marketing_book_send_audience"
            ? {
              data: {
                brand_id: brandId,
                reach: {
                  total: phones.length,
                  reachable_email: 0,
                  reachable_sms: phones.length,
                },
                rows: phones.map((phone, i) => person(`k${i}`, phone)),
              },
              error: null,
            }
            : { data: null, error: null },
        );
      },
    },
  };
}

interface Http {
  url: string;
  host: string;
  sid: string | null;
  body: string;
}

const answer = (data: unknown): RpcAnswer => () =>
  Promise.resolve({ data, error: null });

async function runSend(
  phones: string[],
  switchesRpc: RpcAnswer,
  sealed = false,
) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = Deno.env.get(k);
    Deno.env.set(k, v);
  }
  const http: Http[] = [];
  const realFetch = globalThis.fetch;
  const quiet = console.error;
  console.error = () => {};
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const body = String(init?.body ?? "");
    http.push({
      url,
      host: new URL(url).hostname,
      sid: url.includes("api.twilio.com")
        ? new URLSearchParams(body).get("MessagingServiceSid")
        : null,
      body,
    });
    return Promise.resolve(
      url.includes("api.twilio.com")
        ? new Response(JSON.stringify({ sid: `SM${http.length}` }), { status: 201 })
        : new Response(
          JSON.stringify({ code: "ok", message_id: "3017857812138224517130997" }),
          { status: 200 },
        ),
    );
  }) as typeof fetch;
  const time = new FakeTime(SEND_AT);
  const db = fakeDb(phones, sealed, switchesRpc);
  try {
    let settled = false;
    const pending = processClaimedCampaigns(
      // deno-lint-ignore no-explicit-any
      db.client as any,
      [{
        id: "42730000-0000-4000-8000-0000000000c2",
        account_id: "42730000-0000-4000-8000-0000000000d2",
        brand_id: "42730000-0000-4000-8000-0000000000b2",
        audience_id: "aud",
        channel: "sms",
        // deno-lint-ignore no-explicit-any
        channel_payload: { kind: "sms", body: "Doors at 9." } as any,
        name: "Hostile switches",
        scheduled_for: null,
        // deno-lint-ignore no-explicit-any
      }] as any,
      {
        live: true,
        resendApiKey: "re_test_key",
        // No smsSwitches: the REAL loader reads the RPC.
        opsAlert: () => Promise.resolve(),
      },
    ).finally(() => {
      settled = true;
    });
    while (!settled) await time.tickAsync(250);
    const summary = await pending;
    return { summary, http, writes: db.writes, rpcCalls: db.switchesCalls() };
  } finally {
    time.restore();
    globalThis.fetch = realFetch;
    console.error = quiet;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

/** Which destinations reached a provider, and on which Twilio sender. */
function sentTo(http: Http[]): string[] {
  return http.map((h) => {
    if (h.host !== "api.twilio.com") return `termii`;
    const to = new URLSearchParams(h.body).get("To");
    return `${to}@${h.sid}`;
  }).sort();
}

function noWrongSender(http: Http[]): void {
  for (const h of http) {
    assert(
      h.sid !== TRANSACTIONAL_SID,
      `the transactional service carried a marketing text: ${h.body}`,
    );
  }
}

Deno.test("#4273 X1 the transactional SID in the marketing config never sends a marketing text", async () => {
  const { http, summary } = await runSend(
    [US, NG, GB],
    answer(payload(["US", "NG", "GB"], { sid: TRANSACTIONAL_SID })),
  );
  assertEquals(summary.failed, 0, JSON.stringify(summary.errors));
  noWrongSender(http);
  // Positive control: US (toll-free env service) and NG (Termii) still go out.
  assertEquals(sentTo(http), [`${US}@${TOLL_FREE_ENV_SID}`, "termii"]);
});

Deno.test("#4273 X2 a marketing SID in the wrong shape is refused, never trimmed or case-folded", async () => {
  for (
    const sid of [
      MARKETING_SID.toUpperCase().replace(/^MG/, "MG"),
      `${MARKETING_SID}\n`,
      ` ${MARKETING_SID}`,
      MARKETING_SID.slice(0, -1),
    ]
  ) {
    const { http } = await runSend([US, GB], answer(payload(["US", "GB"], { sid })));
    assertEquals(sentTo(http), [`${US}@${TOLL_FREE_ENV_SID}`], JSON.stringify(sid));
  }
  // Positive control: the exact seeded SID sends GB on the marketing service.
  const ok = await runSend([GB], answer(payload(["GB"])));
  assertEquals(sentTo(ok.http), [`${GB}@${MARKETING_SID}`]);
});

Deno.test("#4273 X3 hand-corrupted sender rows that slipped past the CHECKs text no one", async () => {
  const corrupt = payload(["US", "NG", "GB"], {
    patch: (rows) =>
      replace("GB", { sender: "toll_free" })(
        replace("NG", { sender: "toll_free" })(
          replace("US", { sender: "marketing_service" })(rows),
        ),
      ),
  });
  const { http, summary } = await runSend([US, NG, GB], answer(corrupt));
  assertEquals(summary.failed, 0, JSON.stringify(summary.errors));
  assertEquals(http, [], "no provider HTTP for any corrupted country");
});

Deno.test("#4273 X4 country codes in the wrong case or with whitespace are dropped, never matched loosely", async () => {
  for (const code of ["gb", " GB", "GB ", "Gb"]) {
    const rows = payload(["US"], {
      patch: (all) => [
        ...all.filter((r) => r.country !== "GB"),
        {
          country: code,
          marketingEnabled: true,
          sender: "marketing_service",
          registrationRequired: false,
          registrationDone: false,
        },
      ],
    });
    const { http } = await runSend([US, GB], answer(rows));
    assertEquals(sentTo(http), [`${US}@${TOLL_FREE_ENV_SID}`], JSON.stringify(code));
  }
});

Deno.test("#4273 X5 rows forced on before they are ready are not texted; IE once registered is", async () => {
  // IE on without registration; BE on while it still needs a local number.
  const forced = await runSend([IE, BE, US], answer(payload(["IE", "BE", "US"])));
  assertEquals(sentTo(forced.http), [`${US}@${TOLL_FREE_ENV_SID}`]);
  // Positive control: IE with its registration done goes out on the DB
  // marketing service, carrying the opt-out link (one-way sender).
  const ready = await runSend([IE], answer(payload(["IE"], { done: ["IE"] })));
  assertEquals(sentTo(ready.http), [`${IE}@${MARKETING_SID}`]);
  const body = new URLSearchParams(ready.http[0].body).get("Body") ?? "";
  assert(body.includes("https://usemingla.com/m/"), body);
  assert(!body.includes("Reply STOP"), body);
});

Deno.test("#4273 X6 type-confused rows are dropped (\"true\" is not true, 1 is not done)", async () => {
  const rows = payload(["US"], {
    patch: (all) =>
      replace("IE", {
        marketingEnabled: true,
        registrationDone: 1,
      })(replace("GB", { marketingEnabled: "true" })(all)),
  });
  const { http } = await runSend([US, GB, IE], answer(rows));
  assertEquals(sentTo(http), [`${US}@${TOLL_FREE_ENV_SID}`]);
});

Deno.test("#4273 X7 an RPC that rejects or answers garbage is unreadable on every try: nothing is texted", async () => {
  const shapes: Array<[string, RpcAnswer]> = [
    ["rejects", () => Promise.reject(new Error("socket hang up"))],
    ["string payload", answer(JSON.stringify(payload(["US", "NG"])))],
    ["array payload", answer([payload(["US", "NG"])])],
    ["countries not an array", answer({ marketingServiceSid: MARKETING_SID, countries: {} })],
  ];
  for (const [label, rpc] of shapes) {
    const { http, writes, rpcCalls } = await runSend([US, NG], rpc);
    assertEquals(http, [], label);
    assertEquals(rpcCalls, 3, `${label}: three tries, then give up`);
    const reasons = writes
      .filter((w) => w.table === "marketing_messages" && w.op !== "select")
      .map((w) => (w.payload as { failure_reason?: string }).failure_reason);
    assertEquals(
      reasons,
      ["sms_rate_book_unavailable", "sms_rate_book_unavailable"],
      label,
    );
  }
});

Deno.test("#4273 X8 a flaky RPC recovers on the fresh snapshot; a country switched off after the quote is not texted", async () => {
  // Error on the first try, a good answer (GB on) on the second.
  let call = 0;
  const flaky: RpcAnswer = () => {
    call += 1;
    return Promise.resolve(
      call === 1
        ? { data: null, error: { message: "timeout" } }
        : { data: payload(["GB"]), error: null },
    );
  };
  const recovered = await runSend([GB], flaky);
  assertEquals(sentTo(recovered.http), [`${GB}@${MARKETING_SID}`]);
  assertEquals(recovered.rpcCalls, 2);

  // The quote saw GB on…
  const saved = Deno.env.get("MINGLA_DELIVERY_FLAGS_JSON");
  Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", ENV.MINGLA_DELIVERY_FLAGS_JSON);
  try {
    const quote = await smsQuoteInputs(
      fakeDb([], true, answer(payload(["US", "GB"]))).client,
    );
    assertEquals(quote.smsCountryLive?.("GB"), true);
  } finally {
    if (saved === undefined) Deno.env.delete("MINGLA_DELIVERY_FLAGS_JSON");
    else Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", saved);
  }
  // …and an admin switched it off before the send pass: the send reads its
  // own snapshot and texts US only.
  const after = await runSend([US, GB], answer(payload(["US"])));
  assertEquals(sentTo(after.http), [`${US}@${TOLL_FREE_ENV_SID}`]);
});
