// #4273 tester retest — the SMS opt-out link, the price-read retry, and
// marketing vs transactional routing.
//
// L-1 (P1) a text to a country whose sender cannot take "STOP" ends with the
//     opt-out short link; every marketing_clicks destination the send writes
//     is decoded and holds no phone and no email; the opt-out row is
//     link_kind 'opt_out' and its token names the message.
// L-2 (P3) a sealed send whose price table cannot be read touches nobody and
//     is re-parked for a later pass instead of finalized as reaching nobody.
// L-3 (P3) the opt-out link is not engagement: marketing-track-click leaves
//     click_count, clicked_at and the "clicked" status alone for it.
// L-4 (P3) transactional texts route exactly as on main: Canada and the
//     Caribbean ride the US switch, Germany is unmapped. Marketing texts use
//     one switch per country and never text a Caribbean number.
// MINGLA-INVARIANT: I-4273-TRANSACTIONAL-SMS-AS-MAIN | issue #4273 | Verification, ticket and RSVP texts resolve their country with countryFromE164 and main's two switches (NG, and US for everything else mapped); only marketing texts use the per-country switches and the marketing country table.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FakeTime } from "https://deno.land/std@0.224.0/testing/time.ts";
import { processClaimedCampaigns } from "./index.ts";
import { smsAdapter } from "../_shared/adapters/smsAdapter.ts";
import { verifySmsUnsubscribeToken } from "../_shared/marketingTokens.ts";

const SECRET = "issue-4273-test-secret-not-a-real-key-0123456789";
const GB = "+447700904273";
const US = "+12025550142";
const BRAND = "42730000-0000-4000-8000-0000000000b1";
const CAMPAIGN = "42730000-0000-4000-8000-0000000000c1";
type Write = { table: string; op: string; payload: unknown };

function fakeDb(writes: Write[], phones: string[], sealed: boolean) {
  let messageSeq = 0;
  const row = (phone: string) => ({
    contact_key: phone,
    display_name: "Guest",
    first_name: "Guest",
    raw_email: "guest@example.test",
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
  const builder = (table: string) => {
    let op = "select";
    const filters: Array<[string, unknown]> = [];
    const result = () => {
      if (op === "upsert" && table === "marketing_messages") {
        messageSeq += 1;
        return {
          data: {
            id: `42730000-0000-4000-8000-${String(messageSeq).padStart(12, "e")}`,
          },
          error: null,
        };
      }
      if (op !== "select") return { data: null, error: null };
      if (table === "marketing_audiences") {
        return {
          data: {
            id: "aud",
            brand_id: BRAND,
            query_definition: { kind: "all_brand_people", brand_id: BRAND },
          },
          error: null,
        };
      }
      if (table === "brands") {
        return filters.some(([m]) => m === "in")
          ? { data: [{ id: BRAND, slug: "lantern-room" }], error: null }
          : {
            data: { id: BRAND, name: "Lantern Room", slug: "lantern-room" },
            error: null,
          };
      }
      if (table === "marketing_messages") return { data: null, error: null };
      if (table === "marketing_book_send_executions") {
        return { data: sealed ? { id: "exec" } : null, error: null };
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
    from: builder,
    rpc: (name: string) => {
      writes.push({ table: `rpc:${name}`, op: "rpc", payload: null });
      return Promise.resolve(
        name === "biz_marketing_book_send_audience"
          ? {
            data: {
              brand_id: BRAND,
              reach: {
                total: phones.length,
                reachable_email: 0,
                reachable_sms: phones.length,
              },
              rows: phones.map(row),
            },
            error: null,
          }
          : { data: null, error: null },
      );
    },
  };
}

async function send(
  phones: string[],
  smsRoutes: Array<{ country: string; provider: "twilio" | "termii" }> | null,
  sealed = true,
) {
  const writes: Write[] = [];
  const sent: Array<{ to: string; optOutLink?: string }> = [];
  const realSend = smsAdapter.send;
  const previous = Deno.env.get("UNSUBSCRIBE_TOKEN_SECRET");
  Deno.env.set("UNSUBSCRIBE_TOKEN_SECRET", SECRET);
  // 12:00 in Washington, 17:00 in London: inside both marketing windows.
  const time = new FakeTime(new Date("2026-11-09T17:00:00Z"));
  smsAdapter.send = (input) => {
    sent.push({ to: input.to, optOutLink: input.optOutLink });
    return Promise.resolve({
      ok: true,
      status: "sent",
      providerMessageId: "SM-test",
      provider: "twilio",
      segments: 1,
      // deno-lint-ignore no-explicit-any
    } as any);
  };
  try {
    const summary = await processClaimedCampaigns(
      // deno-lint-ignore no-explicit-any
      fakeDb(writes, phones, sealed) as any,
      [{
        id: CAMPAIGN,
        account_id: "42730000-0000-4000-8000-0000000000d1",
        brand_id: BRAND,
        audience_id: "aud",
        channel: "sms",
        // deno-lint-ignore no-explicit-any
        channel_payload: { kind: "sms", body: "Doors at 9. https://example.test/lineup" } as any,
        name: "Opt-out link",
        scheduled_for: null,
        // deno-lint-ignore no-explicit-any
      }] as any,
      { live: true, resendApiKey: "re_test_key", smsRoutes },
    );
    return { summary, writes, sent };
  } finally {
    smsAdapter.send = realSend;
    time.restore();
    if (previous === undefined) Deno.env.delete("UNSUBSCRIBE_TOKEN_SECRET");
    else Deno.env.set("UNSUBSCRIBE_TOKEN_SECRET", previous);
  }
}

function decodedPayload(url: string): string {
  const token = url.slice(url.lastIndexOf("/") + 1);
  const part = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
  try {
    return atob(part + "=".repeat((4 - (part.length % 4)) % 4));
  } catch {
    return "";
  }
}

Deno.test("#4273 L-1 (P1) every stored click destination holds no phone or email; the opt-out row names the message", async () => {
  const { summary, writes, sent } = await send([GB, US], [
    { country: "GB", provider: "twilio" },
    { country: "US", provider: "twilio" },
  ]);
  assertEquals(summary.failed, 0, JSON.stringify(summary.errors));
  assertEquals(sent.map((s) => s.to).sort(), [US, GB].sort());
  const gb = sent.find((s) => s.to === GB)!;
  const us = sent.find((s) => s.to === US)!;
  assert(gb.optOutLink !== undefined, "GB cannot reply STOP: it gets the link");
  assertEquals(us.optOutLink, undefined, "US replies STOP: no link");
  const clicks = writes
    .filter((w) => w.table === "marketing_clicks" && w.op === "insert")
    .flatMap((w) =>
      w.payload as Array<
        { destination_url: string; tracking_id: string; link_kind?: string }
      >
    );
  assert(clicks.length >= 3, `content links + one opt-out: ${clicks.length}`);
  for (const click of clicks) {
    const text = `${click.destination_url} ${decodedPayload(click.destination_url)}`;
    assert(!text.includes(GB) && !text.includes(GB.slice(1)), text);
    assert(!text.includes(US) && !text.includes(US.slice(1)), text);
    assert(!text.includes("@"), text);
  }
  const optOut = clicks.filter((c) => c.link_kind === "opt_out");
  assertEquals(optOut.length, 1);
  assert(gb.optOutLink!.endsWith(`/${optOut[0].tracking_id}`));
  Deno.env.set("UNSUBSCRIBE_TOKEN_SECRET", SECRET);
  try {
    const token = optOut[0].destination_url.slice(
      optOut[0].destination_url.lastIndexOf("/") + 1,
    );
    const payload = await verifySmsUnsubscribeToken(token);
    assertEquals(payload?.campaign_id, CAMPAIGN);
    assertEquals(payload?.brand_id, BRAND);
    assert(/^[0-9a-f-]{36}$/.test(payload?.message_id ?? ""));
  } finally {
    Deno.env.delete("UNSUBSCRIBE_TOKEN_SECRET");
  }
  assertEquals(
    clicks.filter((c) => c.link_kind === undefined).every((c) =>
      c.destination_url === "https://example.test/lineup"
    ),
    true,
  );
});

Deno.test("#4273 L-2 (P3) a sealed send with unreadable prices touches nobody and is re-parked", async () => {
  const { summary, writes, sent } = await send([GB, US], null, true);
  assertEquals(sent, [], "never text a number Mingla can't price");
  assertEquals(
    writes.filter((w) => w.table === "marketing_messages"),
    [],
    "no recipient row is written",
  );
  assertEquals(
    writes.some((w) => w.table === "rpc:mkt_finalize_campaign"),
    false,
  );
  const park = writes.filter((w) =>
    w.table === "marketing_campaigns" && w.op === "update"
  ).at(-1);
  assertEquals((park?.payload as { status?: string })?.status, "scheduled");
  const at = Date.parse(
    (park?.payload as { scheduled_for: string }).scheduled_for,
  );
  assert(at > Date.parse("2026-11-09T17:00:00Z"), "a later pass");
  assertEquals(summary.succeeded, 1);
  assertEquals(summary.failed, 0);
});

Deno.test("#4273 L-3 (P3) the opt-out link is not a click", async () => {
  const src = await Deno.readTextFile(
    new URL("../marketing-track-click/index.ts", import.meta.url),
  );
  const optOutAt = src.indexOf('link_kind === "opt_out"');
  const bumpAt = src.indexOf("click_count: (msgRow.click_count ?? 0) + 1");
  const clickedAt = src.indexOf("clicked_at: nowIso");
  assert(optOutAt > 0 && optOutAt < bumpAt && optOutAt < clickedAt);
  const branch = src.slice(optOutAt, src.indexOf("}", src.indexOf("return redirect(FALLBACK_URL);", optOutAt)));
  assert(!branch.includes(".update("), "the opt-out branch writes nothing");
  assert(!branch.includes("utm_"), "and adds no tracking tags");
});

Deno.test("#4273 L-4 (P3) transactional routing is main's; marketing is per country", async () => {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  const env: Record<string, string | undefined> = {
    TWILIO_ACCOUNT_SID: "ACtest",
    TWILIO_AUTH_TOKEN: "test",
    TWILIO_MESSAGING_SERVICE_SID: "MGtest",
    MINGLA_DELIVERY_FLAGS_JSON: JSON.stringify({
      schema_version: 1,
      marketing_send_live_enabled: true,
      sms_live_enabled: { ng: false, us: true },
    }),
  };
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = Deno.env.get(k);
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  globalThis.fetch = ((input: string | URL | Request) => {
    calls.push(String(input instanceof Request ? input.url : input));
    return Promise.resolve(
      new Response(JSON.stringify({ sid: "SMtest", status: "queued" }), {
        status: 201,
      }),
    );
  }) as typeof fetch;
  try {
    const transactional = (to: string) =>
      smsAdapter.send({ to, brandName: "Mingla", message: "Your code is 1234" });
    // Toronto, Jamaica and London ride the US switch exactly as on main.
    assertEquals((await transactional("+14165550142")).status, "sent");
    assertEquals((await transactional("+18765550142")).status, "sent");
    assertEquals((await transactional("+447700904273")).status, "sent");
    const de = await transactional("+4915112345678");
    assertEquals([de.status, de.error], ["skipped", "country_unresolved"]);
    const marketing = (to: string) =>
      smsAdapter.send({
        to,
        brandName: "Mingla",
        message: "Doors at 9.",
        messageType: "marketing",
        stopFooterOwnLine: true,
      });
    // Marketing: only the US key is on, so Canada, Jamaica and GB are skipped.
    assertEquals((await marketing("+12025550142")).status, "sent");
    for (const to of ["+14165550142", "+18765550142", "+447700904273"]) {
      const result = await marketing(to);
      assertEquals(
        [result.status, result.error],
        ["skipped", "provider_kill_switch_off"],
        to,
      );
    }
    assertEquals(calls.length, 4, "4 provider calls: 3 transactional + 1 US marketing");
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
});
