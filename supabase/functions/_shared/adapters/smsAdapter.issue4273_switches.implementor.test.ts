// #4273 (country switches) — the adapter's MARKETING branch.
//
// The caller (marketing-send) decides each country's route from
// public.sms_country_switches and passes it as `marketingRoute`; the adapter
// no longer reads any per-country bundle switch for marketing, and refuses
// any wrong sender/route pairing with ZERO provider HTTP:
//   T-A1 marketingRoute absent → provider_kill_switch_off, 0 HTTP
//   T-A2 GB with no marketing SID → marketing_sender_mismatch, 0 HTTP
//   T-A3 US carrying an override SID → marketing_sender_mismatch, 0 HTTP
//   T-A4 US routed "marketing" → marketing_sender_mismatch, 0 HTTP
//   T-A5 NG routed "toll_free" → marketing_sender_mismatch, 0 HTTP
//   T-A7 GB carrying the TRANSACTIONAL service SID → marketing_sender_mismatch,
//        0 HTTP (a marketing text never rides the verification sender)
//   T-A6 GB happy, with NO bundle key for GB → one Twilio POST carrying the
//        marketing SID; US happy on the toll-free service; NG happy on Termii.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { smsAdapter, type SmsSendInput } from "./smsAdapter.ts";
import { TRANSACTIONAL_SERVICE_SID } from "../smsCountries.ts";

const MARKETING_SID = "MG9d42785c51834395018b52144736b9a7";
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

interface Call {
  url: string;
  body: string;
}

async function withHarness(
  run: (calls: Call[]) => Promise<void>,
): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of OWNED_KEYS) saved[key] = Deno.env.get(key);
  for (const key of OWNED_KEYS) Deno.env.delete(key);
  // US and NG bundle switches on; NO key for GB (marketing no longer reads it).
  Deno.env.set(
    "MINGLA_DELIVERY_FLAGS_JSON",
    JSON.stringify({
      schema_version: 1,
      marketing_send_live_enabled: true,
      sms_live_enabled: { ng: true, us: true },
    }),
  );
  Deno.env.set("TWILIO_ACCOUNT_SID", "AC4273switch");
  Deno.env.set("TWILIO_AUTH_TOKEN", "tok4273switch");
  Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MG4273tollfree");
  Deno.env.set("TERMII_API_KEY", "tk4273switch");
  Deno.env.set("TERMII_BASE_URL", "https://termii.switch.test");
  Deno.env.set("TERMII_SENDER_ID", "Mingla");
  const calls: Call[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push({ url, body: String(init?.body ?? "") });
    return Promise.resolve(
      url.includes("api.twilio.com")
        ? new Response(JSON.stringify({ sid: "SM4273" }), { status: 201 })
        : new Response(
          JSON.stringify({ code: "ok", message_id: "3017857812138224517130997" }),
          { status: 200 },
        ),
    );
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = realFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

const NOON_WAT = new Date("2026-11-09T11:00:00.000Z");
const base = (to: string, extra: Partial<SmsSendInput>): SmsSendInput => ({
  to,
  brandName: "Harmattan Club",
  message: "Doors at 9",
  messageType: "marketing",
  stopFooterOwnLine: true,
  now: NOON_WAT,
  ...extra,
});

Deno.test("#4273 T-A1 marketing with no route is not switched on (fail closed, 0 HTTP)", async () => {
  await withHarness(async (calls) => {
    let ioClaimed = false;
    const result = await smsAdapter.send(base("+12025550142", {
      beforeProviderIo: () => {
        ioClaimed = true;
        return Promise.resolve();
      },
    }));
    assertEquals(result.status, "skipped");
    assertEquals(result.error, "provider_kill_switch_off");
    assertEquals(result.provider, "twilio");
    const nullRoute = await smsAdapter.send(base("+447700900123", {
      marketingRoute: null,
      messagingServiceSid: MARKETING_SID,
    }));
    assertEquals(nullRoute.error, "provider_kill_switch_off");
    assertEquals(calls.length, 0);
    assertEquals(ioClaimed, false);
  });
});

Deno.test("#4273 T-A2..A5 every wrong sender/route pairing is refused with zero HTTP", async () => {
  await withHarness(async (calls) => {
    let ioClaimed = false;
    const claim = () => {
      ioClaimed = true;
      return Promise.resolve();
    };
    const cases: Array<[string, SmsSendInput]> = [
      ["A2 GB with no marketing SID", base("+447700900123", { marketingRoute: "marketing", beforeProviderIo: claim })],
      ["A2b GB with a blank SID", base("+447700900123", { marketingRoute: "marketing", messagingServiceSid: "  ", beforeProviderIo: claim })],
      ["A3 US with an override SID", base("+12025550142", { marketingRoute: "toll_free", messagingServiceSid: MARKETING_SID, beforeProviderIo: claim })],
      ["A4 US routed marketing", base("+12025550142", { marketingRoute: "marketing", messagingServiceSid: MARKETING_SID, beforeProviderIo: claim })],
      ["A5 NG routed toll_free", base("+2348031234567", { marketingRoute: "toll_free", beforeProviderIo: claim })],
      ["A5b GB routed toll_free", base("+447700900123", { marketingRoute: "toll_free", beforeProviderIo: claim })],
      ["A5c CA routed termii", base("+14165550123", { marketingRoute: "termii", beforeProviderIo: claim })],
    ];
    for (const [label, input] of cases) {
      const result = await smsAdapter.send(input);
      assertEquals(result.status, "skipped", label);
      assertEquals(result.error, "marketing_sender_mismatch", label);
      assertEquals(result.ok, false, label);
    }
    assertEquals(calls.length, 0, "zero provider HTTP");
    assertEquals(ioClaimed, false, "before beforeProviderIo");
  });
});

Deno.test("#4273 T-A6 the right pairings send: GB on the marketing service (no bundle key), US toll-free, NG Termii", async () => {
  await withHarness(async (calls) => {
    const gb = await smsAdapter.send(base("+447700900123", {
      marketingRoute: "marketing",
      messagingServiceSid: MARKETING_SID,
      optOutLink: "https://usemingla.com/m/00000000-0000-4000-8000-000000000000",
    }));
    assertEquals(gb.status, "sent");
    assertEquals(calls.length, 1);
    assert(calls[0].url.includes("api.twilio.com"));
    const gbParams = new URLSearchParams(calls[0].body);
    assertEquals(gbParams.get("MessagingServiceSid"), MARKETING_SID);
    assert(gbParams.get("Body")!.includes("https://usemingla.com/m/"));
    assert(!gbParams.get("Body")!.includes("Reply STOP"));

    const us = await smsAdapter.send(base("+12025550142", {
      marketingRoute: "toll_free",
    }));
    assertEquals(us.status, "sent");
    assertEquals(
      new URLSearchParams(calls[1].body).get("MessagingServiceSid"),
      "MG4273tollfree",
    );

    const ng = await smsAdapter.send(base("+2348031234567", {
      marketingRoute: "termii",
    }));
    assertEquals(ng.status, "sent");
    assertEquals(ng.provider, "termii");
    assert(calls[2].url.startsWith("https://termii.switch.test/"));
    assertEquals(JSON.parse(calls[2].body).channel, "generic");
    assertEquals(calls.length, 3);
  });
});

Deno.test("#4273 T-A7 a marketing text on the transactional service SID is refused with zero HTTP", async () => {
  await withHarness(async (calls) => {
    let ioClaimed = false;
    const claim = () => {
      ioClaimed = true;
      return Promise.resolve();
    };
    for (const sid of [TRANSACTIONAL_SERVICE_SID, `  ${TRANSACTIONAL_SERVICE_SID}  `]) {
      for (const to of ["+447700900123", "+33612345678"]) {
        const result = await smsAdapter.send(base(to, {
          marketingRoute: "marketing",
          messagingServiceSid: sid,
          beforeProviderIo: claim,
        }));
        assertEquals(result.status, "skipped", `${to} ${sid}`);
        assertEquals(result.error, "marketing_sender_mismatch", `${to} ${sid}`);
        assertEquals(result.ok, false);
      }
    }
    assertEquals(calls.length, 0, "zero provider HTTP");
    assertEquals(ioClaimed, false, "before beforeProviderIo");
  });
});
