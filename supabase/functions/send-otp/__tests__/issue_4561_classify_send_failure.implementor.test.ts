// MINGLA-INVARIANT: I-OTP-REFUSAL-NOT-RETRYABLE | issue #4561 | A provider refusal of a delivery channel for one destination is returned as channel_unavailable, never as the retryable send_failed; an account or configuration failure of our own is send_failed, never channel_unavailable.
/**
 * issue #4561 — a refused text must never strand a person on the phone step.
 *
 * FAILS-ON-REVERT: classifySendFailure decides on the provider's error CODE.
 * Reverting it to a status-only rule (any 4xx -> channel_unavailable, or any
 * non-429 -> send_failed as before #4561) fails named rows below: the fraud
 * block arrives as a 403 exactly like an account failure can.
 *
 * ADVERSARIAL: no response body in send-otp carries exception or provider
 * text, and every string the installed app matches on still exists.
 * Fixtures use fictional values only; nothing here reaches the network.
 */
import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  alternativesAfter,
  CHANNEL_UNAVAILABLE_TEXT,
  classifySendFailure,
  RATE_LIMITED_TEXT,
  SEND_FAILED_TEXT,
} from "../classifySendFailure.ts";

const read = (path: string): string =>
  Deno.readTextFileSync(new URL(`../../../../${path}`, import.meta.url));

const PROVIDER_TEXT =
  "Provider says: destination +10000000000 blocked (fixture)";
const body = (code: unknown) => ({
  code,
  message: PROVIDER_TEXT,
  more_info: "https://example.invalid/errors",
  status: 0,
});

type Row = [string, number, unknown, string, string];
const ROWS: Row[] = [
  // name, HTTP status, provider body, public code, internal class
  [
    "fraud block 60410 (403)",
    403,
    body(60410),
    "channel_unavailable",
    "channel_unavailable",
  ],
  [
    "blocked destination 21216 (400)",
    400,
    body(21216),
    "channel_unavailable",
    "channel_unavailable",
  ],
  [
    "geo permission block 60605 (403)",
    403,
    body(60605),
    "channel_unavailable",
    "channel_unavailable",
  ],
  [
    "landline cannot take SMS 60205",
    400,
    body(60205),
    "channel_unavailable",
    "channel_unavailable",
  ],
  [
    "unseen destination code 69999",
    400,
    body(69999),
    "channel_unavailable",
    "channel_unavailable",
  ],
  ["rate limit 429", 429, body(20429), "rate_limited", "rate_limited"],
  ["max send attempts 60203", 429, body(60203), "rate_limited", "rate_limited"],
  [
    "max send attempts 60203 on a 400",
    400,
    body(60203),
    "rate_limited",
    "rate_limited",
  ],
  [
    "invalid number 60200",
    400,
    body(60200),
    "invalid_number",
    "invalid_number",
  ],
  [
    "auth failure 20003 (401)",
    401,
    body(20003),
    "send_failed",
    "account_config",
  ],
  [
    "auth failure 20003 on a 403",
    403,
    body(20003),
    "send_failed",
    "account_config",
  ],
  [
    "service not found 20404 (404)",
    404,
    body(20404),
    "send_failed",
    "account_config",
  ],
  ["404 without a code", 404, null, "send_failed", "account_config"],
  [
    "account not active 20005 (403)",
    403,
    body(20005),
    "send_failed",
    "account_config",
  ],
  [
    "account not active 10001",
    403,
    body(10001),
    "send_failed",
    "account_config",
  ],
  [
    "channel disabled in service 60223",
    400,
    body(60223),
    "send_failed",
    "account_config",
  ],
  ["provider 5xx", 503, body(20503), "send_failed", "account_config"],
  ["provider 500 without a code", 500, null, "send_failed", "provider_error"],
  ["4xx with an unreadable body", 400, null, "send_failed", "provider_error"],
  [
    "4xx with a non-numeric code",
    403,
    body("blocked"),
    "send_failed",
    "provider_error",
  ],
];

for (const [name, status, providerBody, code, failureClass] of ROWS) {
  Deno.test(`#4561 classify: ${name} -> ${code}`, () => {
    const result = classifySendFailure(status, providerBody);
    assertEquals(result.code, code);
    assertEquals(result.failureClass, failureClass);
  });
}

Deno.test("#4561 the fraud block and an auth failure share a 403 but not a class", () => {
  const fraud = classifySendFailure(403, body(60410));
  const account = classifySendFailure(403, body(20005));
  assertEquals(fraud.code, "channel_unavailable");
  assertEquals(account.code, "send_failed");
});

Deno.test("#4561 the classification carries no provider text", () => {
  for (const [, status, providerBody] of ROWS) {
    const serialized = JSON.stringify(
      classifySendFailure(status, providerBody),
    );
    assertFalse(serialized.includes("Provider says"), serialized);
    assertFalse(serialized.includes("+1000"), serialized);
    assertFalse(serialized.includes("example.invalid"), serialized);
  }
});

Deno.test("#4561 alternatives never offer the refused channel", () => {
  assertEquals(alternativesAfter("sms"), ["call"]);
  assertEquals(alternativesAfter("whatsapp"), ["call"]);
  assertEquals(alternativesAfter("call"), []);
});

const FN = read("supabase/functions/send-otp/index.ts");

function stringifiedBodies(source: string): string[] {
  const out: string[] = [];
  let at = source.indexOf("JSON.stringify(");
  while (at >= 0) {
    let depth = 0;
    let end = at + "JSON.stringify".length;
    for (; end < source.length; end++) {
      const ch = source[end];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(source.slice(at, end + 1));
    at = source.indexOf("JSON.stringify(", end);
  }
  return out;
}

Deno.test("#4561 adversarial: no send-otp response body carries exception or provider text", () => {
  const bodies = stringifiedBodies(FN);
  assert(
    bodies.length >= 10,
    `expected every response body, found ${bodies.length}`,
  );
  for (const b of bodies) {
    for (
      const leak of [
        "err.",
        "err)",
        "twilioData",
        "providerCode",
        "message",
        "more_info",
        "phone,",
        "user.id",
      ]
    ) {
      assertFalse(b.includes(leak), `response body leaks ${leak}: ${b}`);
    }
  }
  // The pre-#4561 catch-all returned the exception text verbatim.
  assertFalse(/error:\s*err\.message/.test(FN));
  assertFalse(FN.includes("console.error('Twilio error:', twilioData)"));
});

Deno.test("#4561 adversarial: a refusal is 422 channel_unavailable, never the retryable 500", () => {
  const refused = FN.slice(FN.indexOf("case 'channel_unavailable':"));
  const block = refused.slice(0, refused.indexOf("case 'send_failed':"));
  assertStringIncludes(block, "status: 422");
  assertStringIncludes(block, "alternatives: alternativesAfter(channel)");
  assertStringIncludes(block, "error: CHANNEL_UNAVAILABLE_TEXT");
  assertStringIncludes(
    FN,
    "classifySendFailure(twilioResponse.status, twilioData)",
  );
  assertStringIncludes(FN, "captureEdgeExceptionAsync(");
});

Deno.test("#4561 adversarial: strings the installed app matches on are byte-identical", () => {
  // OnboardingFlow matches 'already associated' and 'Too many attempts'.
  assertStringIncludes(
    FN,
    "'This phone number is already associated with another account.'",
  );
  assertEquals(RATE_LIMITED_TEXT, "Too many attempts. Try again later.");
  assertEquals(SEND_FAILED_TEXT, "Couldn't send code. Try again.");
  assertStringIncludes(
    FN,
    "'Could not verify phone availability. Please try again.'",
  );
  assertEquals(
    CHANNEL_UNAVAILABLE_TEXT,
    "We can't text this number. Update Mingla to get your code by phone call.",
  );
  const app = read("app-mobile/src/components/OnboardingFlow.tsx");
  assertStringIncludes(app, "includes('already associated')");
  assertStringIncludes(app, "includes('Too many attempts')");
});

Deno.test("#4561 verify-otp returns codes and no debug_code or exception text", () => {
  const verify = read("supabase/functions/verify-otp/index.ts");
  assertFalse(verify.includes("debug_code"));
  assertFalse(/error:\s*err\.message/.test(verify));
  for (
    const code of [
      "code_expired",
      "verify_failed",
      "phone_taken",
      "save_failed",
    ]
  ) {
    assertStringIncludes(verify, `code: '${code}'`);
  }
  assertStringIncludes(
    verify,
    "'Phone verified but save failed. Contact support.'",
  );
  assertStringIncludes(verify, "'Code expired. Request a new one.'");
});
