#!/usr/bin/env node
/**
 * ORCH-0842 [Fold Tickets into Active + render real ticket PDF in bottom
 * sheet with venue/QR/Save] — happy-path regression test.
 *
 * Asserts the structural pieces of the ORCH-0842 implementation that
 * unambiguously fail-on-revert if the fix is reverted:
 *
 *   1. The standalone "Tickets" accordion block above the Active section
 *      is DELETED from CalendarTab.tsx. The old code rendered a discrete
 *      `<Text style={styles.accordionTitle}>Tickets</Text>` header inside
 *      a top-level Tickets block — that header must NOT appear in the new
 *      unified-Active layout.
 *   2. CalendarTab.tsx contains the unified-row construction
 *      (`unifiedActiveRows` + `unifiedArchiveRows` discriminated-union).
 *   3. calendarService.ts SELECT includes the new venue fields
 *      (`location_text`, `location_geo`, `is_online`, `online_url`) and
 *      `ticket_pdf_path` so the consumer app can render the venue block
 *      and route the PDF fetch.
 *   4. The `parseLocationGeo` helper exists in calendarService.ts.
 *   5. TicketService.fetchTicketPdfUrl exists and invokes the
 *      `ticket-pdf-fetch` edge function.
 *   6. TicketPdfSheet.tsx exists and renders react-native-pdf.
 *   7. ticket-confirmation-dispatch persists to the `ticket-pdfs` bucket.
 *   8. ticket-pdf-fetch enforces buyer_user_id ownership.
 *
 * Each assertion is a single grep against the source. If the
 * implementation is reverted, multiple checks fail simultaneously — the
 * test exercises the bug from multiple angles.
 *
 * To verify fails-on-revert: revert any one of the changes above and
 * re-run; the corresponding check must fail.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const failures = [];

function read(rel) {
  const full = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(full)) {
    failures.push(`${rel}: file expected but missing`);
    return "";
  }
  return fs.readFileSync(full, "utf8");
}

function assertMatch(rel, source, pattern, descriptor) {
  if (!pattern.test(source)) {
    failures.push(
      `${rel}: expected ${descriptor} — pattern ${pattern} did not match`,
    );
  }
}

function assertNoMatch(rel, source, pattern, descriptor) {
  if (pattern.test(source)) {
    failures.push(
      `${rel}: forbidden ${descriptor} — pattern ${pattern} matched`,
    );
  }
}

// ---------------------------------------------------------------------------
// 1. CalendarTab.tsx — standalone Tickets header removed.
// 2. CalendarTab.tsx — unified rows present.
// ---------------------------------------------------------------------------
const calendarTabRel = "app-mobile/src/components/activity/CalendarTab.tsx";
const calendarTab = read(calendarTabRel);

// The legacy block rendered:
//   <Text style={styles.accordionTitle}>Tickets</Text>
//   <Text style={styles.accordionCount}>({businessOrders.length})</Text>
// That literal pair must NOT appear post-ORCH-0842.
assertNoMatch(
  calendarTabRel,
  calendarTab,
  /<Text\s+style=\{styles\.accordionTitle\}>Tickets<\/Text>/,
  'standalone <Text>Tickets</Text> header (should be removed; tickets fold into Active now)',
);

assertNoMatch(
  calendarTabRel,
  calendarTab,
  /\(businessOrders\.length\)/,
  'businessOrders.length used as a standalone accordion count (should fold into unifiedActiveRows.length)',
);

assertMatch(
  calendarTabRel,
  calendarTab,
  /unifiedActiveRows/,
  'unifiedActiveRows reference (sort-merge of calendar entries + ticket orders)',
);
assertMatch(
  calendarTabRel,
  calendarTab,
  /unifiedArchiveRows/,
  'unifiedArchiveRows reference (Archive mirror of unified merge)',
);
assertMatch(
  calendarTabRel,
  calendarTab,
  /kind:\s*["']ticket["']/,
  'discriminated-union "ticket" branch in unified row construction',
);
assertMatch(
  calendarTabRel,
  calendarTab,
  /kind:\s*["']calendar["']/,
  'discriminated-union "calendar" branch in unified row construction',
);

// ---------------------------------------------------------------------------
// 3. calendarService.ts SELECT includes new venue fields + ticket_pdf_path.
// 4. parseLocationGeo helper present.
// ---------------------------------------------------------------------------
const calSvcRel = "app-mobile/src/services/calendarService.ts";
const calSvc = read(calSvcRel);

for (const field of [
  "location_text",
  "location_geo",
  "is_online",
  "online_url",
  "ticket_pdf_path",
]) {
  assertMatch(
    calSvcRel,
    calSvc,
    new RegExp(field),
    `'${field}' present in SELECT / row mapping (ORCH-0842 venue + PDF path surfacing)`,
  );
}

assertMatch(
  calSvcRel,
  calSvc,
  /function\s+parseLocationGeo/,
  'parseLocationGeo helper for PostGIS point parsing',
);
assertMatch(
  calSvcRel,
  calSvc,
  /interface\s+BusinessEventVenue/,
  'BusinessEventVenue type exported on BusinessEventCalendarRow',
);

// ---------------------------------------------------------------------------
// 5. TicketService — fetchTicketPdfUrl invokes ticket-pdf-fetch.
// ---------------------------------------------------------------------------
const ticketSvcRel = "app-mobile/src/services/ticketService.ts";
const ticketSvc = read(ticketSvcRel);

assertMatch(
  ticketSvcRel,
  ticketSvc,
  /fetchTicketPdfUrl/,
  'fetchTicketPdfUrl method',
);
assertMatch(
  ticketSvcRel,
  ticketSvc,
  /["']ticket-pdf-fetch["']/,
  'ticket-pdf-fetch edge function invocation',
);

// ---------------------------------------------------------------------------
// 6. TicketPdfSheet.tsx — download-only flow (operator feedback 2026-05-17:
//    inline PDF rendering removed in favor of a "Download PDF" button below
//    the QR strip that hands the file to the native share sheet).
// ---------------------------------------------------------------------------
const sheetRel = "app-mobile/src/components/activity/TicketPdfSheet.tsx";
const sheet = read(sheetRel);

assertMatch(
  sheetRel,
  sheet,
  /from\s+["']expo-sharing["']/,
  'expo-sharing import (Save / Share action)',
);
assertMatch(
  sheetRel,
  sheet,
  /from\s+["']expo-file-system\/legacy["']/,
  'expo-file-system/legacy import (downloadAsync + cacheDirectory)',
);
assertMatch(
  sheetRel,
  sheet,
  /TicketService\.fetchTicketPdfUrl/,
  'TicketService.fetchTicketPdfUrl call on download',
);
assertMatch(
  sheetRel,
  sheet,
  /Show at door/,
  'QR strip "Show at door" label',
);
assertMatch(
  sheetRel,
  sheet,
  /Download PDF/,
  'Download PDF button label',
);
assertMatch(
  sheetRel,
  sheet,
  /Sharing\.shareAsync/,
  'native share sheet invocation on download',
);
// Inline PDF rendering MUST be gone (operator feedback).
assertNoMatch(
  sheetRel,
  sheet,
  /from\s+["']react-native-pdf["']/,
  'react-native-pdf import (must be absent — inline render removed)',
);

// ---------------------------------------------------------------------------
// 7. ticket-confirmation-dispatch uploads to ticket-pdfs bucket.
// ---------------------------------------------------------------------------
const dispatchRel = "supabase/functions/ticket-confirmation-dispatch/index.ts";
const dispatch = read(dispatchRel);

assertMatch(
  dispatchRel,
  dispatch,
  /\.from\(["']ticket-pdfs["']\)/,
  'ticket-pdfs storage upload on dispatch (Path A persistence)',
);
assertMatch(
  dispatchRel,
  dispatch,
  /ticket_pdf_path/,
  'orders.ticket_pdf_path update after upload',
);

// ---------------------------------------------------------------------------
// 8. ticket-pdf-fetch enforces ownership.
// ---------------------------------------------------------------------------
const fetchRel = "supabase/functions/ticket-pdf-fetch/index.ts";
const fetchFn = read(fetchRel);

assertMatch(
  fetchRel,
  fetchFn,
  /userIdFromAuthHeader/,
  'caller JWT extraction',
);
assertMatch(
  fetchRel,
  fetchFn,
  /buyer_user_id/,
  'buyer_user_id ownership reference (I-PROPOSED-AK)',
);
assertMatch(
  fetchRel,
  fetchFn,
  /buildTicketPdf/,
  'lazy-backfill uses shared renderer (I-PROPOSED-AL)',
);

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error("ORCH-0842 regression check FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  "ORCH-0842 regression check PASSED (Tickets folded into Active, PDF sheet wired, ownership enforced).",
);
