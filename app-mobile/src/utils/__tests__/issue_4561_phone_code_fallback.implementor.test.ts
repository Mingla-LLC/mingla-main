// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals (precedent: #4114).
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
  codeStepPresentation,
  otpPickerChannels,
  phoneStepPresentation,
  phoneStepSendChannel,
  readSendOtpFailure,
  refusedForNumber,
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
    assertStringIncludes(source, "phoneStepPresentation(");
    assertStringIncludes(source, "withRefusedChannel(");
    assertStringIncludes(source, "SUPPORT_MAILTO");
    assertStringIncludes(source, "Phone Code Send Failed");
  }
  // The picker hides refused channels; the CTA calls once SMS is refused.
  assertStringIncludes(onboarding, "codePresentation.pickerChannels.includes('sms')");
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

// ─── Rework (QA P1-1, P3-1, P3-3) ───

const MESSAGES = { smsRefused: "SMS_REFUSED", allRefused: "ALL_REFUSED" };

Deno.test("#4561 P1-1: a disabled send button always has its reason and support route", () => {
  // Every combination a person can reach the phone step with, including Back
  // from the code screen's all-refused state (no stored error at all).
  const lastErrors = [
    null,
    { message: "Couldn't send code. Try again.", phoneTaken: false },
    { message: "taken", phoneTaken: true },
  ];
  for (const refused of [[], ["sms"], ["call"], ["sms", "call"], ["call", "sms"]] as const) {
    for (const lastError of lastErrors) {
      const p = phoneStepPresentation(refused, lastError, MESSAGES);
      if (p.sendChannel === null) {
        assertEquals(p.error, "ALL_REFUSED", `refused=${refused} last=${JSON.stringify(lastError)}`);
        assertEquals(p.showSupport, true, `refused=${refused} last=${JSON.stringify(lastError)}`);
      }
    }
  }
});

Deno.test("#4561 P1-1: Back from the code-screen all-refused state shows the message and support", () => {
  // Text refused on the phone step, call refused from the picker, then Back:
  // no error was stored for the phone step, only the remembered refusals.
  const remembered = { number: "+12015550142", channels: withRefusedChannel(withRefusedChannel([], "sms"), "call") };
  const p = phoneStepPresentation(refusedForNumber(remembered, "+12015550142"), null, MESSAGES);
  assertEquals(p, { sendChannel: null, error: "ALL_REFUSED", showSupport: true });
  // Back after only SMS was refused: the call button explains itself.
  const smsOnly = phoneStepPresentation(["sms"], null, MESSAGES);
  assertEquals(smsOnly, { sendChannel: "call", error: "SMS_REFUSED", showSupport: false });
  // The onboarding screen draws exactly this presentation, not a second flag.
  const onboarding = read("src/components/OnboardingFlow.tsx");
  assertStringIncludes(onboarding, "error={phonePresentation.error}");
  assertStringIncludes(onboarding, "{phonePresentation.showSupport ? renderEmailSupport() : null}");
  assertStringIncludes(onboarding, "disabled: !isPhoneValid() || !smsConsentChecked || phonePresentation.sendChannel === null");
  assert(!onboarding.includes("otpAllRefused"), "a second all-refused flag is back");
  const rsvp = read("src/components/rsvpGuest/RsvpGuestClaimScreen.tsx");
  assertStringIncludes(rsvp, "numberPresentation.error");
  assertStringIncludes(rsvp, "numberPresentation.showSupport");
});

Deno.test("#4561 P3-1: a country change is a number change and clears the shown refusal", () => {
  const remembered = { number: "+12015550142", channels: ["sms", "call"] as ("sms" | "call")[] };
  // Same digits, another country: a different full number with no refusals.
  assertEquals(refusedForNumber(remembered, "+442015550142"), []);
  assertEquals(phoneStepPresentation(refusedForNumber(remembered, "+442015550142"), null, MESSAGES), {
    sendChannel: "sms",
    error: null,
    showSupport: false,
  });
  // And both screens clear a stored error on a country change, as on a digit change.
  const onboarding = read("src/components/OnboardingFlow.tsx");
  assertStringIncludes(
    onboarding,
    "onChangeCountry={(code) => { setData((p) => ({ ...p, phoneCountryCode: code })); setPhoneError(null); setPhoneErrorKind(null) }}",
  );
  const rsvp = read("src/components/rsvpGuest/RsvpGuestClaimScreen.tsx");
  assertStringIncludes(rsvp, "onChangeCountry={(iso: string) => { setPhoneCountry(iso); setError(null); }}");
});

Deno.test("#4561 P3-3: a refusal is recorded against the requested channel only", () => {
  const otherChannel = readSendOtpFailure({ code: "channel_unavailable", channel: "whatsapp" }, "x", "sms");
  assertEquals(otherChannel.channel, "sms");
  const callForSms = readSendOtpFailure({ code: "channel_unavailable", channel: "call", alternatives: ["call"] }, "x", "sms");
  assertEquals(callForSms.channel, "sms", "a reply must not mark the call refused when the app asked for SMS");
  assertEquals(callForSms.alternatives, ["call"]);
  const matching = readSendOtpFailure({ code: "channel_unavailable", channel: "call" }, "x", "call");
  assertEquals(matching.channel, "call");
});

// ─── Rework 2 (QA P2-1): a refused channel is never silent on the code screen ───

const ALL_MESSAGES = { smsRefused: "SMS_REFUSED", callRefused: "CALL_REFUSED", allRefused: "ALL_REFUSED" };

Deno.test("#4561 P2-1: call refused from the picker with text allowed keeps the code screen and names the call", () => {
  // Arrived by text; "Call me instead" refused.
  const refused = withRefusedChannel([], "call");
  const code = codeStepPresentation(refused, "call", ALL_MESSAGES);
  assertEquals(code, { message: "CALL_REFUSED", pickerChannels: ["sms"], allRefused: false });
  // The onboarding handler stays on the code screen for a picker refusal.
  const onboarding = read("src/components/OnboardingFlow.tsx");
  const branch = onboarding.slice(
    onboarding.indexOf("if (result.code === 'channel_unavailable') {", onboarding.indexOf("const handleResendViaChannel")),
  );
  const block = branch.slice(0, branch.indexOf("// Phone claimed by another user"));
  assert(!block.includes("goToSubStep('phone')"), "a picker refusal still bounces to the phone screen");
  assertStringIncludes(block, "setPickerRefusal(channel)");
  assertStringIncludes(block, "codeStepPresentation(refused, channel, refusalMessages)");
  assertStringIncludes(onboarding, "{codePresentation.message}");
});

Deno.test("#4561 P2-1: text refused from the picker with call allowed is symmetric", () => {
  const code = codeStepPresentation(withRefusedChannel([], "sms"), "sms", ALL_MESSAGES);
  assertEquals(code, { message: "SMS_REFUSED", pickerChannels: ["call"], allRefused: false });
});

Deno.test("#4561 P2-1: the last allowed channel refused from the picker is the all-refused state", () => {
  assertEquals(codeStepPresentation(["sms", "call"], "call", ALL_MESSAGES), {
    message: "ALL_REFUSED",
    pickerChannels: [],
    allRefused: true,
  });
  assertEquals(codeStepPresentation(["call", "sms"], "sms", ALL_MESSAGES).allRefused, true);
});

Deno.test("#4561 P2-1: every refusal names the channel that was actually refused, on both screens", () => {
  const sets: ("sms" | "call")[][] = [["sms"], ["call"], ["sms", "call"]];
  for (const refused of sets) {
    const phone = phoneStepPresentation(refused, null, ALL_MESSAGES);
    // Never silent: any refusal for this number is explained on the phone step.
    assert(phone.error !== null, `phone screen silent for refused=${refused}`);
    if (phone.sendChannel !== null) {
      const failed = refused[0];
      assertEquals(phone.error, failed === "sms" ? "SMS_REFUSED" : "CALL_REFUSED", `refused=${refused}`);
    }
    for (const pickerRefusal of refused) {
      const code = codeStepPresentation(refused, pickerRefusal, ALL_MESSAGES);
      assert(code.message !== null, `code screen silent for refused=${refused} picker=${pickerRefusal}`);
      if (!code.allRefused) {
        assertEquals(code.message, pickerRefusal === "sms" ? "SMS_REFUSED" : "CALL_REFUSED");
        assert(!code.pickerChannels.includes(pickerRefusal), "the refused channel is still offered");
      }
    }
  }
  // A stale marker for a channel that is not refused for this number says nothing.
  assertEquals(codeStepPresentation([], "call", ALL_MESSAGES).message, null);
});

Deno.test("#4561 P2-1: the announcement is the visible message for every refusal", () => {
  const onboarding = read("src/components/OnboardingFlow.tsx");
  // Phone step: announced text is the derived phone-step error for the new set.
  assertStringIncludes(onboarding, "const message = phoneStepPresentation(refused, null, refusalMessages).error");
  // Code step: announced text is the derived code-step message for the new set.
  assertStringIncludes(onboarding, "if (shown.message) announceError(shown.message)");
  // No hard-coded refusal string is announced anywhere.
  assert(!/announceError\(t\('onboarding:phone\.error_/.test(onboarding), "a fixed refusal string is announced");
  const en = JSON.parse(read("src/i18n/locales/en/onboarding.json"));
  assertEquals(en.phone.error_call_refused, "We can't call this number.");
});
