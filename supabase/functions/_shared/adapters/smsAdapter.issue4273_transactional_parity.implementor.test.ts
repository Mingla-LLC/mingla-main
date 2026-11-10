// #4273 (country switches) — T-T1: TRANSACTIONAL SMS IS BYTE-FOR-BYTE UNCHANGED.
//
// The country-switches change edits smsAdapter.ts in its MARKETING branch
// only. This suite sends a fixed matrix of transactional texts (the default
// messageType) through smsAdapter.send with a stubbed env and a recording
// fetch, and compares every provider request (URL, method, headers except
// Authorization, every body field IN ORDER) and every returned object with a
// golden captured from origin/main 28f88fea6d, BEFORE the change.
//
// Matrix: 7 destinations (US, NG, GB, BE, CA, an invalid number, an unmapped
// calling code) x bundle US/NG on/off (4) x with/without a Messaging Service
// override x with/without media x NG inside/outside the operator embargo
// = 224 cases.
//
// Golden generation (never from the anchor checkout):
//   T=$(mktemp -d) && git worktree add --detach "$T/base" 28f88fea6d
//   cp supabase/functions/_shared/adapters/smsAdapter.issue4273_transactional_parity.implementor.test.ts \
//      "$T/base/supabase/functions/_shared/adapters/"
//   (cd "$T/base" && ISSUE4273_WRITE_GOLDEN="$PWD/golden.json" deno test --allow-env --allow-net \
//      --allow-read --allow-write --no-check \
//      supabase/functions/_shared/adapters/smsAdapter.issue4273_transactional_parity.implementor.test.ts)
//   cp "$T/base/golden.json" supabase/functions/_shared/__tests__/fixtures/issue_4273/transactional_sms_golden.json
//   git worktree remove --force "$T/base"
//
// Tester step (git is not available inside this suite): also assert
//   git diff 28f88fea6d -- supabase/functions/_shared/notifyV2.ts \
//     supabase/functions/attendance-claim-backfill/index.ts \
//     supabase/functions/send-pair-request/index.ts supabase/functions/send-phone-invite/index.ts \
//     supabase/functions/send-venue-sms/index.ts supabase/functions/stay-reservations/index.ts \
//     supabase/functions/support-brand-person-erasure/index.ts \
//     supabase/functions/ticket-confirmation-dispatch/index.ts \
//     supabase/functions/_shared/twilioVerify.ts supabase/functions/_shared/e164Country.ts \
//     supabase/functions/_shared/secretBundle.ts
// is empty.
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { smsAdapter } from "./smsAdapter.ts";

const GOLDEN_PATH = new URL(
  "../__tests__/fixtures/issue_4273/transactional_sms_golden.json",
  import.meta.url,
);

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
  "TWILIO_MARKETING_MESSAGING_SERVICE_SID",
  "TWILIO_STATUS_CALLBACK_SECRET",
  "SUPABASE_URL",
];

const DESTINATIONS: Array<[string, string]> = [
  ["us", "+12025550142"],
  ["ng", "+2348031234567"],
  ["gb", "+447700900123"],
  ["be", "+32470123456"],
  ["ca", "+14165550123"],
  ["invalid", "12345"],
  ["unmapped", "+8613800138000"],
];
const BUNDLES: Array<[boolean, boolean]> = [
  [true, true],
  [false, false],
  [true, false],
  [false, true],
];
// 12:00 WAT (inside the NG window) and 22:00 WAT (inside the embargo).
const NOWS: Array<[string, string]> = [
  ["ng_open", "2026-11-09T11:00:00.000Z"],
  ["ng_embargo", "2026-11-09T21:00:00.000Z"],
];

interface CapturedRequest {
  url: string;
  method: string;
  headers: Array<[string, string]>;
  body: Array<[string, unknown]>;
}

function bodyEntries(body: unknown): Array<[string, unknown]> {
  if (body instanceof URLSearchParams) return [...body.entries()];
  if (typeof body !== "string") return [["<non-string>", String(body)]];
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    return Object.entries(JSON.parse(trimmed) as Record<string, unknown>);
  }
  return [...new URLSearchParams(body).entries()];
}

function headerEntries(headers: HeadersInit | undefined): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  new Headers(headers ?? {}).forEach((value, key) => {
    if (key.toLowerCase() !== "authorization") out.push([key, value]);
  });
  return out;
}

async function runMatrix(): Promise<Record<string, unknown>> {
  const saved: Record<string, string | undefined> = {};
  for (const key of OWNED_KEYS) saved[key] = Deno.env.get(key);
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  const results: Record<string, unknown> = {};
  let captures: CapturedRequest[] = [];
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    captures.push({
      url,
      method: init?.method ?? "GET",
      headers: headerEntries(init?.headers),
      body: bodyEntries(init?.body),
    });
    const response = url.includes("api.twilio.com")
      ? new Response(JSON.stringify({ sid: "SM4273parity" }), { status: 201 })
      : new Response(
        JSON.stringify({
          code: "ok",
          message_id: "3017857812138224517130997",
          message: "Successfully Sent",
        }),
        { status: 200 },
      );
    return Promise.resolve(response);
  }) as typeof fetch;
  console.warn = () => {};
  try {
    for (const [destName, to] of DESTINATIONS) {
      for (const [us, ng] of BUNDLES) {
        for (const sid of [null, "MG4273override000000000000000000"]) {
          for (const media of [undefined, ["https://cdn.example.test/a.jpg"]]) {
            for (const [nowName, nowIso] of NOWS) {
              for (const key of OWNED_KEYS) Deno.env.delete(key);
              Deno.env.set(
                "MINGLA_DELIVERY_FLAGS_JSON",
                JSON.stringify({
                  schema_version: 1,
                  marketing_send_live_enabled: false,
                  sms_live_enabled: { ng, us },
                }),
              );
              Deno.env.set("TWILIO_ACCOUNT_SID", "AC4273parity");
              Deno.env.set("TWILIO_AUTH_TOKEN", "tok4273parity");
              Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MG4273transactional");
              Deno.env.set("TWILIO_STATUS_CALLBACK_SECRET", "cb4273");
              Deno.env.set("SUPABASE_URL", "https://parity.supabase.test");
              Deno.env.set("TERMII_API_KEY", "tk4273parity");
              Deno.env.set("TERMII_BASE_URL", "https://termii.parity.test");
              Deno.env.set("TERMII_SENDER_ID", "Mingla");
              captures = [];
              const result = await smsAdapter.send({
                to,
                brandName: "Harmattan Club",
                message: "Your ticket’s ready — doors at 9…",
                ...(sid === null ? {} : { messagingServiceSid: sid }),
                ...(media === undefined ? {} : { mediaUrls: media }),
                now: new Date(nowIso),
              });
              const caseKey = `${destName}|us:${us}|ng:${ng}|sid:${
                sid === null ? "none" : "override"
              }|media:${media === undefined ? "none" : "one"}|${nowName}`;
              results[caseKey] = { requests: captures, result };
            }
          }
        }
      }
    }
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
  return results;
}

Deno.test("T-T1 #4273 transactional SMS requests and results equal the 28f88fea6d golden (224 cases)", async () => {
  const actual = JSON.parse(JSON.stringify(await runMatrix()));
  const writeTo = Deno.env.get("ISSUE4273_WRITE_GOLDEN");
  if (writeTo) {
    await Deno.writeTextFile(writeTo, JSON.stringify(actual, null, 2) + "\n");
    return;
  }
  const golden = JSON.parse(await Deno.readTextFile(GOLDEN_PATH));
  assertEquals(Object.keys(actual).length, 224);
  assertEquals(Object.keys(golden).length, 224);
  for (const key of Object.keys(golden)) {
    assertEquals(actual[key], golden[key], `case ${key}`);
  }
  // Key order too: the same cases in the same order.
  assertEquals(Object.keys(actual), Object.keys(golden));
});
