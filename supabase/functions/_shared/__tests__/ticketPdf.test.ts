// ORCH-0785 — Ticket PDF render unit tests.
// Verifies: cold-start esm.sh imports resolve under Deno; PDF is parseable;
// page count matches tickets.length; forbidden privacy strings are absent.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { buildTicketPdf } from "../ticketPdf.ts";

function fixtureInput(ticketCount = 1) {
  return {
    event: {
      title: "Sunset Sail",
      startAtIso: "2026-06-12T18:00:00Z",
      timezone: "Europe/London",
      locationText: "Brighton Marina",
      brandName: "Coastline Co",
    },
    order: { shortId: "abcd1234" },
    tickets: Array.from({ length: ticketCount }, (_, i) => ({
      ticketId: `t${i + 1}`,
      ticketName: "General",
      qrPayload: `mingla:v1:ticket:11111111-2222-3333-4444-55555555555${i}:sig:deadbeef`,
    })),
    attendeeNameHint: "Buyer Name",
  };
}

Deno.test("buildTicketPdf returns parseable PDF with one page per ticket", async () => {
  const result = await buildTicketPdf(fixtureInput(3));
  assertEquals(result.pageCount, 3);
  assertEquals(result.filename, "tickets-abcd1234.pdf");
  const bytes = Uint8Array.from(atob(result.contentBase64), (c) =>
    c.charCodeAt(0));
  const reloaded = await PDFDocument.load(bytes);
  assertEquals(reloaded.getPageCount(), 3);
});

Deno.test("buildTicketPdf rejects empty tickets[]", async () => {
  const empty = fixtureInput(0);
  await assertRejects(
    () => buildTicketPdf(empty),
    Error,
    "ticket_pdf_no_tickets",
  );
});

Deno.test("buildTicketPdf bytes do NOT contain forbidden privacy strings", async () => {
  const result = await buildTicketPdf(fixtureInput(2));
  const bytes = Uint8Array.from(atob(result.contentBase64), (c) =>
    c.charCodeAt(0));
  // PDFs compress streams, so we check raw bytes as a coarse signal — any
  // accidental inclusion of these literal strings in unscanned metadata would
  // surface here.
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  assert(!text.includes("qr_token_hash"));
  assert(!text.includes("qr_token_pepper"));
  assert(!text.includes("stripe_payment_intent_id"));
  assert(!text.includes("buyer_phone_e164"));
});

Deno.test("buildTicketPdf size envelope: 1 ticket < 200KB", async () => {
  const result = await buildTicketPdf(fixtureInput(1));
  assert(
    result.byteLength < 200 * 1024,
    `expected <200KB, got ${result.byteLength}`,
  );
});

Deno.test("buildTicketPdf size envelope: 5 tickets < 1MB", async () => {
  const result = await buildTicketPdf(fixtureInput(5));
  assert(
    result.byteLength < 1 * 1024 * 1024,
    `expected <1MB, got ${result.byteLength}`,
  );
});
