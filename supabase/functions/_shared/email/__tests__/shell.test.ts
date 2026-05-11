// ORCH-0785 — Snapshot-style structural tests for the shared email shell.

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("DENO_TESTING", "1");
Deno.env.set("MINGLA_LOGO_URL", "https://usemingla.com/email-assets/mingla-logo.png");
Deno.env.set("MINGLA_FOOTER_ADDRESS", "Mingla, hello@usemingla.com");
Deno.env.set("RESEND_TICKET_FROM", "Mingla <tickets@usemingla.com>");
Deno.env.set("RESEND_ADMIN_FROM", "Mingla <hello@usemingla.com>");
Deno.env.set("RESEND_SYSTEM_FROM", "Mingla <notifications@usemingla.com>");

const { renderTransactionalEmail } = await import("../index.ts");
import type { RenderInput, TicketBodyInput } from "../types.ts";

function ticketFixture(): RenderInput {
  const body: TicketBodyInput = {
    variant: "ticket_confirmation_paid",
    event: {
      title: "Sunset Sail",
      coverMediaUrl: "https://cdn.usemingla.com/events/sunset.jpg",
      coverMediaType: "image",
      locationText: "Brighton Marina",
      isOnline: false,
      startAt: "2026-06-12T18:00:00Z",
      timezone: "Europe/London",
    },
    brand: { name: "Coastline Co", profilePhotoUrl: null },
    order: {
      shortId: "abcd1234",
      totalCents: 5000,
      currency: "GBP",
      buyerName: "Buyer Name",
      lineItems: [{
        ticketName: "General",
        quantity: 2,
        unitPriceCents: 2500,
        totalCents: 5000,
      }],
      tickets: [
        { ticketId: "t1", ticketName: "General" },
        { ticketId: "t2", ticketName: "General" },
      ],
    },
  };
  return {
    variant: "ticket_confirmation_paid",
    recipient: { name: "Buyer", email: "buyer@example.com" },
    body,
  };
}

Deno.test("paid ticket render: shell wraps body with logo, footer, total", () => {
  const result = renderTransactionalEmail(ticketFixture());
  assertEquals(result.from.address, "tickets@usemingla.com");
  assertStringIncludes(result.html, "<!doctype html>");
  assertStringIncludes(result.html, "mingla-logo.png");
  assertStringIncludes(result.html, "Sunset Sail");
  assertStringIncludes(result.html, "Hosted by Coastline Co");
  assertStringIncludes(result.html, "Brighton Marina");
  assertStringIncludes(result.html, "Total");
  assertStringIncludes(result.html, "support@usemingla.com");
  // Footer wordmark replaced the "experience app" tagline — logo now renders
  // in both header and footer (two <img> tags pointing at the same URL).
  const logoMatches = result.html.match(/mingla-logo\.png/g) ?? [];
  assert(logoMatches.length >= 2);
  assertStringIncludes(result.html, "QR in attached PDF");
  assert(!result.html.includes("dating app"));
  assert(result.subject.startsWith("Your Mingla tickets"));
});

Deno.test("free ticket render: Total reads 'Free', subject starts with 'You're in'", () => {
  const fixture = ticketFixture();
  fixture.variant = "ticket_confirmation_free";
  const body = fixture.body as TicketBodyInput;
  body.variant = "ticket_confirmation_free";
  body.order.totalCents = 0;
  body.order.lineItems = [{
    ticketName: "GA",
    quantity: 1,
    unitPriceCents: 0,
    totalCents: 0,
  }];
  body.order.tickets = [{ ticketId: "t1", ticketName: "GA" }];
  const result = renderTransactionalEmail(fixture);
  assertStringIncludes(result.html, "Free");
  assert(result.subject.startsWith("You're in"));
  // SC-2 negative: paid copy must not appear
  assert(!result.html.includes("Thanks for your purchase"));
});

Deno.test("missing image cover renders fallback block, no <img>, no broken-image", () => {
  const fixture = ticketFixture();
  const body = fixture.body as TicketBodyInput;
  body.event.coverMediaUrl = null;
  body.event.coverMediaType = null;
  const result = renderTransactionalEmail(fixture);
  assert(
    !result.html.includes('img src=""'),
    "must not render a broken-image tag",
  );
  assertStringIncludes(result.html, "Mingla event");
});

Deno.test("video cover renders branded fallback block, no <video> tag", () => {
  const fixture = ticketFixture();
  const body = fixture.body as TicketBodyInput;
  body.event.coverMediaUrl = "https://cdn.usemingla.com/v.mp4";
  body.event.coverMediaType = "video";
  const result = renderTransactionalEmail(fixture);
  assert(!result.html.includes("<video"));
  assertStringIncludes(result.html, "Mingla event");
});

Deno.test("missing master event_date omits the date line entirely", () => {
  const fixture = ticketFixture();
  const body = fixture.body as TicketBodyInput;
  body.event.startAt = null;
  const result = renderTransactionalEmail(fixture);
  // The date line is a <p> containing "·" — its absence is the test.
  assert(!result.html.includes("·"));
});

Deno.test("buyer name XSS escapes in HTML", () => {
  const fixture = ticketFixture();
  const body = fixture.body as TicketBodyInput;
  body.order.buyerName = "<script>alert(1)</script>";
  const result = renderTransactionalEmail(fixture);
  assertStringIncludes(result.html, "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert(!result.html.includes("<script>alert(1)</script>"));
});

Deno.test("generic_notification routes to system sender + renders paragraphs", () => {
  const result = renderTransactionalEmail({
    variant: "generic_notification",
    recipient: { name: null, email: "x@y.z" },
    body: {
      variant: "generic_notification",
      title: "Heads up",
      paragraphs: ["Para1", "Para2"],
      cta: { label: "Open Mingla Business", url: "https://usemingla.com/business" },
    },
  });
  assertEquals(result.from.address, "notifications@usemingla.com");
  assertStringIncludes(result.html, "Para1");
  assertStringIncludes(result.html, "Para2");
  assertStringIncludes(result.html, "Open Mingla Business");
});

Deno.test("admin_compose routes to admin sender", () => {
  const result = renderTransactionalEmail({
    variant: "admin_compose",
    recipient: { name: null, email: "x@y.z" },
    body: {
      variant: "admin_compose",
      title: "Welcome to Mingla",
      paragraphs: ["Body line"],
    },
  });
  assertEquals(result.from.address, "hello@usemingla.com");
});

Deno.test("sender sandbox guard rejects @resend.dev sender (direct)", async () => {
  const { assertNotResendSandbox } = await import("../senders.ts");
  assertThrows(
    () =>
      assertNotResendSandbox({ name: "Mingla", address: "foo@resend.dev" }),
    Error,
    "email_sender_resend_sandbox_forbidden",
  );
});
