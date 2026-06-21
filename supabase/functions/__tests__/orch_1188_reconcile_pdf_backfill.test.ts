// ORCH-1188 FIX 4 [reconcile-finalized orders had NULL ticket_pdf_path → "render
// failed"] — edge-function source-contract tests.
//
// Run locally:
//   deno test --allow-read supabase/functions/__tests__/orch_1188_reconcile_pdf_backfill.test.ts
//
// FIX 4a — reconcile-stuck-checkouts now invokes ticket-confirmation-dispatch in
//          `skipNotify` mode after a finalize, so the recovered order gets a
//          ticket_pdf_path WITHOUT emailing/SMSing the buyer (historical/test
//          sessions). ticket-confirmation-dispatch renders+uploads the PDF then
//          returns BEFORE the notification send loop when skipNotify is true.
// FIX 4b — ticket-pdf-fetch's lazyBackfillPdf relaxes the brands/ticket_types
//          joins to LEFT so trip/experience ticket shapes still render, and
//          surfaces the real detail on failure.
//
// These FAIL on a TRUE LINE-DELETION of the fix.

import { assert } from "jsr:@std/assert@1";

const reconcile = await Deno.readTextFile(
  "supabase/functions/reconcile-stuck-checkouts/index.ts",
);
const dispatch = await Deno.readTextFile(
  "supabase/functions/ticket-confirmation-dispatch/index.ts",
);
const pdfFetch = await Deno.readTextFile(
  "supabase/functions/ticket-pdf-fetch/index.ts",
);

function has(src: string, needle: string, why: string) {
  assert(src.includes(needle), `must contain \`${needle}\` (${why})`);
}

// ── FIX 4a: reconcile dispatches render-only PDF ──────────────────────────────
Deno.test("FIX4a — reconcile invokes ticket-confirmation-dispatch with skipNotify", () => {
  has(reconcile, '"ticket-confirmation-dispatch"', "invokes the dispatch fn");
  has(reconcile, "skipNotify: true", "render-only mode (no email/SMS spam)");
  has(reconcile, "supabase.functions.invoke", "uses functions.invoke");
  // The OLD hard skip comment must be gone (the function no longer no-ops).
  assert(
    !/Skip notification dispatch for historical reconciliation/.test(reconcile),
    "the old 'skip dispatch entirely' behavior must be removed",
  );
});

// ── FIX 4a: dispatch render-only short-circuit ────────────────────────────────
Deno.test("FIX4a — dispatch renders+uploads PDF then returns before send loop on skipNotify", () => {
  has(dispatch, "const skipNotify = body.skipNotify === true", "parses skipNotify");
  has(dispatch, "if (skipNotify) {", "early-return guard");
  // The early-return must sit AFTER the PDF upload block and BEFORE the
  // notification SELECT — assert ordering by index.
  const upIdx = dispatch.indexOf("ticket_pdf_path: pdfPath");
  const guardIdx = dispatch.indexOf("if (skipNotify) {");
  // The notification send loop reads pending ticket_order_notifications rows.
  // (this select string appears twice; the legacy send loop is the LAST one.)
  const notifIdx = dispatch.lastIndexOf(
    '.select("id, channel, recipient, status, attempt_count, payload")',
  );
  assert(upIdx > 0, "PDF-upload block must exist");
  assert(guardIdx > upIdx, "skipNotify return must come AFTER PDF upload");
  assert(notifIdx > 0, "the notification send loop must exist");
  assert(
    guardIdx < notifIdx,
    "skipNotify return must come BEFORE the notification send loop",
  );
});

// ── FIX 4b: ticket-pdf-fetch tolerates trip/experience shapes ─────────────────
Deno.test("FIX4b — lazyBackfillPdf uses LEFT joins on brands + ticket_types", () => {
  has(pdfFetch, "brands!left ( id, name )", "brands join relaxed to LEFT");
  has(pdfFetch, "ticket_types!left ( name )", "ticket_types join relaxed to LEFT");
  // No more !inner on these two (would drop trip/exp rows).
  assert(
    !/brands!inner/.test(pdfFetch),
    "brands!inner must be gone (drops rows for trip/exp)",
  );
  assert(
    !/ticket_types!inner/.test(pdfFetch),
    "ticket_types!inner must be gone (drops rows for trip/exp)",
  );
  // Safe fallbacks for the now-nullable relations are preserved.
  has(pdfFetch, 'event.brands?.name ?? "your host"', "brand-name fallback");
  has(pdfFetch, 't.ticket_types?.name ?? "Ticket"', "ticket-name fallback");
  // Failure surfaces the real detail.
  has(pdfFetch, "detail: message", "render_failed surfaces the real detail");
});
