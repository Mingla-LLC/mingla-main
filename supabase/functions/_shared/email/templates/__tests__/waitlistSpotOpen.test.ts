// T-WL-06 — waitlist spot-open template rendering.

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import { renderWaitlistSpotOpenEmail } from "../waitlistSpotOpen.ts";

Deno.test("T-WL-06: waitlist spot-open email renders subject, html, text, and claim URL", () => {
  const rendered = renderWaitlistSpotOpenEmail({
    brand: { name: "Night Kitchen" },
    event: { title: "Late Supper" },
    ticketType: { name: "Chef Table" },
    qtyRequested: 2,
    expiresAt: "2026-05-25T12:00:00.000Z",
    claimUrl: "https://business.usemingla.com/checkout/event-1?wl=wl-1",
  });

  assertEquals(rendered.subject, "A spot just opened: Late Supper");
  assertStringIncludes(rendered.html, "Claim spot");
  assertStringIncludes(
    rendered.html,
    "https://business.usemingla.com/checkout/event-1?wl=wl-1",
  );
  assertStringIncludes(rendered.text, "Claim within 24 hours");
});

Deno.test("T-WL-06: event title is escaped in HTML", () => {
  const rendered = renderWaitlistSpotOpenEmail({
    brand: { name: "Brand" },
    event: { title: "<script>alert(1)</script>" },
    ticketType: { name: "GA" },
    qtyRequested: 1,
    expiresAt: "2026-05-25T12:00:00.000Z",
    claimUrl: "https://business.usemingla.com/checkout/event-1?wl=wl-1",
  });

  assertStringIncludes(rendered.html, "&lt;script&gt;alert(1)&lt;/script&gt;");
  assertEquals(rendered.html.includes("<script>alert(1)</script>"), false);
});
