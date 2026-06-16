/**
 * ORCH-1150 §9.5 — I-PROPOSED-1150-RSVP-NOTIFY-MULTICHANNEL-NONBLOCKING.
 *
 * The rsvp-notify fan-out attempts EVERY channel for which the guest has a
 * usable address/token, and a failure in one channel does NOT block the others
 * or throw; the queue row is `sent` when ≥1 channel succeeds (A4 + A4-NEW-2).
 *
 * Fails-on-revert: wrapping all three channels in one try (so the first throw
 * aborts the rest), OR reverting to a push-only branch for app users, makes
 * these assertions FAIL.
 */

import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { fanOutChannels } from "./fanout.ts";

Deno.test("(a) per-channel non-blocking: SMS throws, email still sends, queue ends sent", async () => {
  let emailFired = false;
  let pushFired = false;
  const res = await fanOutChannels({
    push: async () => {
      pushFired = true;
      return true;
    },
    email: async () => {
      emailFired = true;
      return true;
    },
    sms: async () => {
      throw new Error("twilio 500");
    },
  });
  // SMS throwing did not abort push/email.
  assertEquals(pushFired, true);
  assertEquals(emailFired, true);
  assertEquals(res.outcome.push, true);
  assertEquals(res.outcome.email, true);
  assertEquals(res.outcome.sms, false);
  // ≥1 channel succeeded → sent.
  assertEquals(res.status, "sent");
});

Deno.test("(b) A4-NEW-2 app-user multi-channel: push AND email AND sms all attempted (not push-only)", async () => {
  const fired = { push: false, email: false, sms: false };
  const res = await fanOutChannels({
    push: async () => {
      fired.push = true;
      return true;
    },
    email: async () => {
      fired.email = true;
      return true;
    },
    sms: async () => {
      fired.sms = true;
      return true;
    },
  });
  assertEquals(fired.push, true);
  assertEquals(fired.email, true);
  assertEquals(fired.sms, true);
  assertEquals(res.status, "sent");
});

Deno.test("(c) link guest (no push token) attempts email AND sms only — no crash", async () => {
  const fired = { email: false, sms: false };
  const res = await fanOutChannels({
    push: null, // link guest has no user_id → push skipped
    email: async () => {
      fired.email = true;
      return true;
    },
    sms: async () => {
      fired.sms = true;
      return true;
    },
  });
  assertEquals(fired.email, true);
  assertEquals(fired.sms, true);
  assertEquals(res.outcome.push, false);
  assertEquals(res.status, "sent");
});

Deno.test("(d) all attempted channels fail transiently → failed_retryable", async () => {
  const res = await fanOutChannels({
    push: null,
    email: async () => false,
    sms: async () => false,
  });
  assertEquals(res.status, "failed_retryable");
});

Deno.test("(e) no address/token for any channel → skipped", async () => {
  const res = await fanOutChannels({ push: null, email: null, sms: null });
  assertEquals(res.anyAttempted, false);
  assertEquals(res.status, "skipped");
});
