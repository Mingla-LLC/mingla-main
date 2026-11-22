/* eslint-disable import/no-unresolved -- Deno-discovered suite; Expo ESLint does not resolve URL imports. */
/**
 * issue #4561 — the app half of "a refused text never strands a person".
 *
 * FAILS-ON-REVERT: reading only `error` (the pre-#4561 client) drops `code`,
 * so the code-less and refusal rows fail; making the phone step fall back to
 * SMS after a failed resend (F-4) fails the resend row.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  otpPickerChannels,
  phoneStepSendChannel,
  readSendOtpFailure,
  SUPPORT_MAILTO,
  withRefusedChannel,
} from "../edgeFunctionError.ts";

const read = (path: string): string =>
  Deno.readTextFileSync(new URL(`../../../${path}`, import.meta.url));

Deno.test("#4561 a body with no code maps to the retryable send_failed", () => {
  assertEquals(readSendOtpFailure(null, "Couldn't send code. Try again.", "sms").code, "send_failed");
  assertEquals(
    readSendOtpFailure({ error: "Couldn't send code. Try again." }, "Couldn't send code. Try again.", "sms").code,
    "send_failed",
  );
  assertEquals(readSendOtpFailure({ error: "x", code: "made_up" }, "x", "call").code, "send_failed");
});

Deno.test("#4561 a refusal keeps its channel and the server's alternatives", () => {
  const failure = readSendOtpFailure(
    { error: "old-app text", code: "channel_unavailable", channel: "sms", alternatives: ["call", "sms", "pigeon"] },
    "old-app text",
    "sms",
  );
  assertEquals(failure.code, "channel_unavailable");
  assertEquals(failure.channel, "sms");
  assertEquals(failure.alternatives, ["call"]);
});

Deno.test("#4561 a refusal without a channel field blames the requested channel", () => {
  const failure = readSendOtpFailure({ error: "x", code: "channel_unavailable" }, "x", "call");
  assertEquals(failure.channel, "call");
  assertEquals(failure.alternatives, []);
});

Deno.test("#4561 rate limit and number-taken codes pass through", () => {
  assertEquals(readSendOtpFailure({ code: "rate_limited" }, "Too many attempts. Try again later.", "sms").code, "rate_limited");
  assertEquals(readSendOtpFailure({ code: "phone_taken" }, "taken", "sms").code, "phone_taken");
});

Deno.test("#4561 phone step: SMS first, a call after SMS is refused, nothing after both", () => {
  assertEquals(phoneStepSendChannel([]), "sms");
  assertEquals(phoneStepSendChannel(["sms"]), "call");
  assertEquals(phoneStepSendChannel(["sms", "call"]), null);
  assertEquals(phoneStepSendChannel(["call"]), "sms");
});

Deno.test("#4561 F-4: after a refusal and a failed resend the phone step still offers call", () => {
  // Phone screen: SMS refused for this number.
  let refused = withRefusedChannel([], "sms");
  assertEquals(phoneStepSendChannel(refused), "call");
  // Code screen after the call: the picker never offers SMS again.
  assertEquals(otpPickerChannels(refused), ["call"]);
  // A resend by call then fails for a retryable reason (send_failed): the
  // refusal list is unchanged, so the phone step offers the call, not SMS.
  const retryable = readSendOtpFailure({ error: "Couldn't send code. Try again.", code: "send_failed" }, "x", "call");
  assertEquals(retryable.code, "send_failed");
  assertEquals(phoneStepSendChannel(refused), "call");
  // If the call itself is refused from the picker, nothing is left (Q-3).
  refused = withRefusedChannel(refused, "call");
  assertEquals(otpPickerChannels(refused), []);
  assertEquals(phoneStepSendChannel(refused), null);
  assertEquals(withRefusedChannel(refused, "call"), ["sms", "call"]);
});

Deno.test("#4561 the support route is the approved address", () => {
  assertEquals(SUPPORT_MAILTO, "mailto:support@usemingla.com");
});

Deno.test("#4561 both sendOtp callers use the shared fallback rules", () => {
  const onboarding = read("src/components/OnboardingFlow.tsx");
  const rsvp = read("src/components/rsvpGuest/RsvpGuestClaimScreen.tsx");
  for (const source of [onboarding, rsvp]) {
    assertStringIncludes(source, "phoneStepSendChannel(");
    assertStringIncludes(source, "withRefusedChannel(");
    assertStringIncludes(source, "SUPPORT_MAILTO");
    assertStringIncludes(source, "Phone Code Send Failed");
  }
  // The picker hides refused channels; the CTA calls once SMS is refused.
  assertStringIncludes(onboarding, "otpPickerChannels(refusedChannels).includes('sms')");
  assertStringIncludes(onboarding, "t('onboarding:phone.cta_call_me')");
  assert(!onboarding.includes("const result = await sendOtp(e164)\n"), "first send is still SMS-only");
});

Deno.test("#4561 every new onboarding string exists in English", () => {
  const en = JSON.parse(read("src/i18n/locales/en/onboarding.json"));
  assertEquals(en.phone.cta_call_me, "Call me with the code");
  assertEquals(en.phone.error_sms_refused, "We can't text this number.");
  assertEquals(
    en.phone.error_all_refused,
    "We couldn't reach this number by text or call. Try a different number, or email us and we'll help.",
  );
  assertEquals(en.phone.taken_help, "Use a different number, or email us if this number is yours.");
  assertEquals(en.phone.email_support, "Email support");
  assertEquals(en.otp.body_call, "We're calling {{phone}}");
});
