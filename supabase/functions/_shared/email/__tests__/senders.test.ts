// ORCH-0785 — Sender resolution and sandbox-guard tests.
import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertNotResendSandbox, formatSenderHeader } from "../senders.ts";

Deno.test("assertNotResendSandbox throws on @resend.dev", () => {
  assertThrows(
    () =>
      assertNotResendSandbox({
        name: "Mingla",
        address: "foo@resend.dev",
      }),
    Error,
    "email_sender_resend_sandbox_forbidden",
  );
});

Deno.test("assertNotResendSandbox throws on uppercase variant", () => {
  assertThrows(
    () =>
      assertNotResendSandbox({
        name: "Mingla",
        address: "Onboarding@Resend.Dev",
      }),
    Error,
    "email_sender_resend_sandbox_forbidden",
  );
});

Deno.test("assertNotResendSandbox accepts usemingla.com sender", () => {
  // Throws nothing.
  assertNotResendSandbox({
    name: "Mingla",
    address: "tickets@usemingla.com",
  });
});

Deno.test("formatSenderHeader composes Name <addr>", () => {
  assertEquals(
    formatSenderHeader({ name: "Mingla", address: "tickets@usemingla.com" }),
    "Mingla <tickets@usemingla.com>",
  );
});
