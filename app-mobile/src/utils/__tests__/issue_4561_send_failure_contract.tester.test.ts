// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals (precedent: #4114).
/* eslint-disable import/no-unresolved -- Deno-discovered suite; Expo ESLint does not resolve URL imports. */
/**
 * issue #4561 — tester adversarial suite (a different angle from the
 * implementor's happy path): the app must never trust a malformed or hostile
 * send-otp failure body, and every public code the SERVER can emit must reach
 * the app unchanged.
 *
 * - `alternatives` holding unknown channels, the refused channel itself, or a
 *   non-array must never offer a channel the provider just refused.
 * - a `channel_unavailable` body with no `channel` refuses the channel that was
 *   requested, so a refused call after a refused text ends in "nothing left".
 * - an unknown `code` is the retryable send_failed and carries no channel data.
 * - recording the same refusal twice never consumes the call fallback.
 * - cross-boundary: the real server classifier's public code for every
 *   provider reply is read back by the app as the same code.
 *
 * FAILS-ON-REVERT: dropping the refused-channel or channel-type filter in
 * `readSendOtpFailure`, or the known-code allowlist, fails named rows below.
 * Fixtures use fictional values only; nothing here reaches the network.
 */
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  otpPickerChannels,
  phoneStepPresentation,
  phoneStepSendChannel,
  readSendOtpFailure,
  refusedForNumber,
  withRefusedChannel,
} from "../edgeFunctionError.ts";

const MSG = "fixture message";
const refusal = (extra: Record<string, unknown>) => ({ error: MSG, code: "channel_unavailable", ...extra });

Deno.test("#4561 adversarial: alternatives never offer the refused channel or an unknown one", () => {
  const r = readSendOtpFailure(
    refusal({ channel: "sms", alternatives: ["sms", "pigeon", "call", 7, null, "call"] }),
    MSG,
    "sms",
  );
  assertEquals(r.channel, "sms");
  assert(!r.alternatives!.includes("sms"), "the refused channel came back as an alternative");
  assert(r.alternatives!.every((c) => c === "sms" || c === "call" || c === "whatsapp"), "unknown channel leaked");
  assertEquals(r.alternatives!.filter((c) => c !== "call"), []);
});

Deno.test("#4561 adversarial: a non-array or missing alternatives list is empty, not a crash", () => {
  for (const alternatives of ["call", { 0: "call" }, null, undefined, 42]) {
    const r = readSendOtpFailure(refusal({ channel: "sms", alternatives }), MSG, "sms");
    assertEquals(r.alternatives, [], `alternatives=${JSON.stringify(alternatives)}`);
  }
});

Deno.test("#4561 adversarial: a refusal with no or a bogus channel refuses the requested channel", () => {
  assertEquals(readSendOtpFailure(refusal({}), MSG, "call").channel, "call");
  assertEquals(readSendOtpFailure(refusal({ channel: "carrier-pigeon" }), MSG, "sms").channel, "sms");
  // A refused call after a refused text leaves nothing to send (Q-1 disabled button).
  const afterSms = withRefusedChannel([], readSendOtpFailure(refusal({}), MSG, "sms").channel!);
  const afterCall = withRefusedChannel(afterSms, readSendOtpFailure(refusal({}), MSG, "call").channel!);
  assertEquals(phoneStepSendChannel(afterSms), "call");
  assertEquals(phoneStepSendChannel(afterCall), null);
  assertEquals(otpPickerChannels(afterCall), []);
});

Deno.test("#4561 adversarial: an unknown or non-string code is send_failed with no channel data", () => {
  for (const code of ["teapot", "CHANNEL_UNAVAILABLE", 422, true, ""]) {
    const r = readSendOtpFailure({ error: MSG, code, channel: "sms", alternatives: ["call"] }, MSG, "sms");
    assertEquals(r.code, "send_failed", `code=${JSON.stringify(code)}`);
    assertEquals("channel" in r, false, `channel leaked for code=${JSON.stringify(code)}`);
    assertEquals("alternatives" in r, false, `alternatives leaked for code=${JSON.stringify(code)}`);
  }
});

Deno.test("#4561 adversarial: recording the same refusal twice never consumes the call fallback", () => {
  const once = withRefusedChannel([], "sms");
  const twice = withRefusedChannel(once, "sms");
  assertEquals(twice, ["sms"]);
  assertEquals(phoneStepSendChannel(twice), "call");
  // A WhatsApp refusal (not offered, D-1) changes nothing the person sees.
  assertEquals(phoneStepSendChannel(withRefusedChannel([], "whatsapp")), "sms");
  assertEquals(otpPickerChannels(["whatsapp"]), ["sms", "call"]);
  // Inputs are not mutated (state held in React must not change under it).
  const frozen = Object.freeze(["sms"]) as readonly ("sms" | "call" | "whatsapp")[];
  withRefusedChannel(frozen, "call");
  assertEquals([...frozen], ["sms"]);
});

Deno.test("#4561 adversarial: every public code the real server classifier emits reaches the app unchanged", async () => {
  const server = await import(
    new URL("../../../../supabase/functions/send-otp/classifySendFailure.ts", import.meta.url).href
  );
  const statuses = [400, 401, 403, 404, 409, 422, 429, 500, 503];
  const codes = [null, 60410, 21216, 60605, 60205, 69999, 20003, 20404, 20429, 60203, 60200, 60223, 10001, "x"];
  for (const status of statuses) {
    for (const providerCode of codes) {
      for (const channel of ["sms", "call"] as const) {
        const f = server.classifySendFailure(status, providerCode === null ? null : { code: providerCode });
        const body: Record<string, unknown> = { error: MSG, code: f.code };
        if (f.code === "channel_unavailable") {
          body.channel = channel;
          body.alternatives = server.alternativesAfter(channel);
        }
        const app = readSendOtpFailure(body, MSG, channel);
        const row = `status=${status} code=${providerCode} channel=${channel}`;
        assertEquals(app.code, f.code, row);
        if (f.code === "channel_unavailable") {
          assertEquals(app.channel, channel, row);
          assert(!app.alternatives!.includes(channel), `${row}: refused channel offered again`);
        }
      }
    }
  }
  // The 409 the server sends before any provider call is also understood.
  assertEquals(readSendOtpFailure({ error: MSG, code: "phone_taken" }, MSG, "sms").code, "phone_taken");
});

Deno.test("#4561 retest adversarial: no refusal set and no last error ever yields a disabled button without its reason and support", () => {
  const msgs = { smsRefused: "SMS_REFUSED", allRefused: "ALL_REFUSED" };
  const sets: ("sms" | "call" | "whatsapp")[][] = [
    [], ["sms"], ["call"], ["whatsapp"], ["sms", "call"], ["call", "sms"], ["sms", "whatsapp"], ["sms", "call", "whatsapp"], ["sms", "sms"],
  ];
  const lastErrors = [null, { message: "TAKEN", phoneTaken: true }, { message: "RETRY", phoneTaken: false }, { message: "", phoneTaken: false }];
  for (const refused of sets) {
    for (const lastError of lastErrors) {
      const p = phoneStepPresentation(refused, lastError, msgs);
      const row = `refused=${JSON.stringify(refused)} last=${JSON.stringify(lastError)}`;
      // The button and the picker agree on what is left.
      assertEquals(p.sendChannel, phoneStepSendChannel(refused), row);
      if (p.sendChannel === null) {
        // Disabled: the reason and the way out always come with it, whatever error came last.
        assertEquals(p.error, "ALL_REFUSED", row);
        assertEquals(p.showSupport, true, row);
        assertEquals(otpPickerChannels(refused), [], row);
      } else {
        assert(p.error !== "ALL_REFUSED", `${row}: all-refused text with a working button`);
        // "We can't text this number" only when SMS really was refused.
        if (p.error === "SMS_REFUSED") assert(refused.includes("sms"), row);
        // Support without a disabled button only for a number on another account.
        if (p.showSupport) assertEquals(lastError?.phoneTaken, true, row);
      }
    }
  }
});

Deno.test("#4561 retest adversarial: refusals belong to one exact number and are copied, not shared", () => {
  const remembered = { number: "+12015550142", channels: ["sms", "call"] as ("sms" | "call")[] };
  assertEquals(refusedForNumber(remembered, "+12015550142"), ["sms", "call"]);
  // Same digits under another country code, or one digit off, carry nothing.
  for (const other of ["+442015550142", "+12015550143", "12015550142", "+1201555014", ""]) {
    assertEquals(refusedForNumber(remembered, other), [], other);
  }
  const copy = refusedForNumber(remembered, "+12015550142");
  copy.pop();
  assertEquals(remembered.channels, ["sms", "call"]);
});
