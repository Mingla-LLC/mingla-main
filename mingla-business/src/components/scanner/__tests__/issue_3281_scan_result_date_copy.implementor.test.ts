/**
 * issue #3281 PR8 — door overlay names the admitted date (structural).
 * [TEST-MOD-APPROVED #3281]
 */
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = "mingla-business/src/components/scanner/scanResultCopy.ts";
const SCANNER = "mingla-business/app/event/[id]/scanner/index.tsx";
const SERVICE = "mingla-business/src/services/scanTicketService.ts";

Deno.test("scanResultCopy ships Admitted / Already scanned / Opens helpers", () => {
  const text = Deno.readTextFileSync(SRC);
  assert(text.includes("formatAdmittedDateLine"));
  assert(text.includes("Admitted - "));
  assert(text.includes("Already scanned for"));
  assert(text.includes("formatPassDateProgress"));
  assert(text.includes("Date ${passIndex} of ${passTotal}"));
});

Deno.test("ServerScanResult carries eventDateId", () => {
  const text = Deno.readTextFileSync(SERVICE);
  assert(text.includes("eventDateId"));
});

Deno.test("scanner screen wires describeScanResult with dayLabel", () => {
  const text = Deno.readTextFileSync(SCANNER);
  assert(text.includes("describeScanResult"));
  assert(text.includes("eventDateId"));
  assert(text.includes("formatOccurrenceDayLabel"));
  assert(text.includes("allDaysPass"));
  assert(text.includes("getPublicEventById"));
  assert(text.includes("shouldApplyScanEnrichment"));
  assert(text.includes("enrichmentGenerationRef"));
  // Grace window: buyer schedule may omit the admitted day; door reads event_dates.
  assert(text.includes('.from("event_dates")'));
  assert(!text.includes("eventDateDisplay"));
  // Base overlay + haptics must not await enrichment (ticket already consumed).
  assert(text.includes("Authoritative scan outcome first"));
  assert(text.includes("if (admittedId === null) return"));
});

Deno.test("scanResultCopy exports shouldApplyScanEnrichment", () => {
  const text = Deno.readTextFileSync(SRC);
  assert(text.includes("shouldApplyScanEnrichment"));
});
