#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0829-A mobile-side regression check.
 *
 * Mirrors the in-repo CI script pattern (no Jest infra in app-mobile;
 * tests are Node assertions against the on-disk source of truth).
 *
 * Asserts the contracts that make Bug X (free-ticket silent claim) and
 * Bug Y (calendar empty) regression-proof:
 *
 *   T-A1 TicketClaimConfirmModal component file exists + default export
 *   T-A2 ExpandedBusinessEventSheet imports TicketClaimConfirmModal
 *   T-A3 ExpandedBusinessEventSheet has `pendingClaim` state + setter
 *   T-A4 ExpandedBusinessEventSheet renders TicketClaimConfirmModal as sibling
 *   T-A5 onBuyTicket / onClaimFreeTicket set pendingClaim (no direct handleBuy call)
 *   T-A6 ExpandedBusinessEventSheet imports useQueryClient
 *   T-A7 handleBuy success branch invalidates ["businessEventOrders", userId]
 *   T-A8 handleBuy success branch has 3-attempt polling for paid path
 *   T-A9 calendarService.ts defines BusinessEventCalendarRow type
 *   T-A10 calendarService.ts defines fetchUserBusinessEventOrders + fetchConsumerCalendar
 *   T-A11 useCalendarEntries.ts defines useBusinessEventOrders hook with key ["businessEventOrders", userId]
 *   T-A12 useCalendarEntries.ts defines useConsumerCalendar hook (kept even though Step-6 used parallel useBusinessEventOrders; future consumers may want unified hook)
 *   T-A13 CalendarTab.tsx imports useBusinessEventOrders + BusinessEventCalendarRow
 *   T-A14 CalendarTab.tsx renders a businessEvents section when count > 0
 *   T-A15 BusinessEventCalendarRow component file exists + default export
 *
 * Invariants codified:
 *   I-PROPOSED-TICKET-CLAIM-CONFIRMATION-REQUIRED (T-A1..T-A5)
 *   I-PROPOSED-CONSUMER-CALENDAR-UNIONS-ORDERS  (T-A7..T-A15)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const readMaybe = (rel) => {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return null;
  }
};
const exists = (rel) => fs.existsSync(path.join(root, rel));

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

const modal = readMaybe(
  "src/components/expandedCard/TicketClaimConfirmModal.tsx",
);
const sheet = readMaybe(
  "src/components/expandedCard/ExpandedBusinessEventSheet.tsx",
);
const calService = readMaybe("src/services/calendarService.ts");
const calHook = readMaybe("src/hooks/useCalendarEntries.ts");
const calTab = readMaybe("src/components/activity/CalendarTab.tsx");
const calRow = readMaybe(
  "src/components/activity/BusinessEventCalendarRow.tsx",
);

// ─── Confirmation modal contracts ──────────────────────────────────────────

check(
  "T-A1 TicketClaimConfirmModal exists with default export",
  modal !== null && /export default TicketClaimConfirmModal/.test(modal),
  "src/components/expandedCard/TicketClaimConfirmModal.tsx MUST exist with a default export.",
);

check(
  "T-A2 ExpandedBusinessEventSheet imports TicketClaimConfirmModal",
  sheet !== null &&
    /import\s+TicketClaimConfirmModal\s+from\s+["']\.\/TicketClaimConfirmModal["']/.test(
      sheet,
    ),
  "ExpandedBusinessEventSheet.tsx MUST import TicketClaimConfirmModal.",
);

check(
  "T-A3 ExpandedBusinessEventSheet has pendingClaim state",
  sheet !== null &&
    /const\s+\[pendingClaim,\s*setPendingClaim\]\s*=\s*useState/.test(sheet),
  "ExpandedBusinessEventSheet.tsx MUST declare `[pendingClaim, setPendingClaim] = useState<...>`.",
);

check(
  "T-A4 ExpandedBusinessEventSheet renders <TicketClaimConfirmModal>",
  sheet !== null && /<TicketClaimConfirmModal[\s\S]{0,800}?\/>/.test(sheet),
  "ExpandedBusinessEventSheet.tsx MUST render <TicketClaimConfirmModal /> in its return.",
);

check(
  "T-A5 callbacks set pendingClaim (no direct handleBuy in onBuyTicket / onClaimFreeTicket)",
  sheet !== null &&
    /onBuyTicket[\s\S]{0,400}?setPendingClaim/.test(sheet) &&
    /onClaimFreeTicket[\s\S]{0,400}?setPendingClaim/.test(sheet) &&
    !/onBuyTicket[\s\S]{0,150}?handleBuy\(/.test(sheet) &&
    !/onClaimFreeTicket[\s\S]{0,150}?handleBuy\(/.test(sheet),
  "ExpandedBusinessEventSheet onBuyTicket + onClaimFreeTicket MUST call setPendingClaim (NOT handleBuy directly).",
);

// ─── Post-success invalidation + polling ───────────────────────────────────

check(
  "T-A6 ExpandedBusinessEventSheet imports useQueryClient",
  sheet !== null &&
    /import\s+\{\s*useQueryClient\s*\}\s+from\s+["']@tanstack\/react-query["']/.test(
      sheet,
    ),
  "ExpandedBusinessEventSheet.tsx MUST import useQueryClient.",
);

check(
  "T-A7 handleBuy success branch invalidates [\"businessEventOrders\", userId]",
  sheet !== null &&
    /invalidateQueries\(\s*\{\s*queryKey:\s*\["businessEventOrders",\s*userId\],?\s*\}/.test(
      sheet,
    ),
  "ExpandedBusinessEventSheet handleBuy success branch MUST invalidate the businessEventOrders query.",
);

check(
  "T-A8 handleBuy paid branch polls 3 times",
  sheet !== null &&
    /attempts\s*\+=\s*1/.test(sheet) &&
    /if\s*\(attempts\s*>=\s*3\)\s*clearInterval/.test(sheet),
  "ExpandedBusinessEventSheet paid path MUST poll 3 times to catch Stripe webhook → finalize latency.",
);

// ─── Service layer ─────────────────────────────────────────────────────────

check(
  "T-A9 calendarService defines BusinessEventCalendarRow type",
  calService !== null &&
    /export\s+interface\s+BusinessEventCalendarRow/.test(calService),
  "calendarService.ts MUST export BusinessEventCalendarRow interface.",
);

check(
  "T-A10 calendarService defines fetchUserBusinessEventOrders + fetchConsumerCalendar",
  calService !== null &&
    /static\s+async\s+fetchUserBusinessEventOrders/.test(calService) &&
    /static\s+async\s+fetchConsumerCalendar/.test(calService),
  "calendarService.ts MUST define both static methods.",
);

// ─── Hook layer ────────────────────────────────────────────────────────────

check(
  "T-A11 useBusinessEventOrders hook defined with correct query key",
  calHook !== null &&
    /export\s+const\s+useBusinessEventOrders\s*=/.test(calHook) &&
    /queryKey:\s*\["businessEventOrders",\s*userId\]/.test(calHook),
  "useCalendarEntries.ts MUST export useBusinessEventOrders with queryKey [\"businessEventOrders\", userId].",
);

check(
  "T-A12 useConsumerCalendar hook defined (unified union)",
  calHook !== null && /export\s+const\s+useConsumerCalendar\s*=/.test(calHook),
  "useCalendarEntries.ts MUST export useConsumerCalendar (kept for future consumers wanting unified union).",
);

// ─── CalendarTab integration ───────────────────────────────────────────────

check(
  "T-A13 CalendarTab imports useBusinessEventOrders + BusinessEventCalendarRow",
  calTab !== null &&
    /import\s+\{\s*useBusinessEventOrders\s*\}\s+from\s+["']\.\.\/\.\.\/hooks\/useCalendarEntries["']/.test(
      calTab,
    ) &&
    /import\s+BusinessEventCalendarRow\s+from\s+["']\.\/BusinessEventCalendarRow["']/.test(
      calTab,
    ),
  "CalendarTab.tsx MUST import useBusinessEventOrders + BusinessEventCalendarRow.",
);

check(
  "T-A14 CalendarTab renders the business-event section",
  calTab !== null &&
    /businessOrders\.length\s*>\s*0/.test(calTab) &&
    /<BusinessEventCalendarRow/.test(calTab),
  "CalendarTab.tsx MUST conditionally render <BusinessEventCalendarRow /> for each businessOrders entry.",
);

check(
  "T-A15 BusinessEventCalendarRow exists with default export",
  calRow !== null &&
    /export default BusinessEventCalendarRow/.test(calRow),
  "src/components/activity/BusinessEventCalendarRow.tsx MUST exist with default export.",
);

// ─── Report ────────────────────────────────────────────────────────────────

let allPass = true;
console.log("\nORCH-0829-A mobile regression check\n" + "=".repeat(44));
for (const c of checks) {
  const tag = c.pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${c.name}`);
  if (!c.pass) {
    console.log(`         → ${c.detail}`);
    allPass = false;
  }
}
console.log();
if (!allPass) {
  console.error(
    `ORCH-0829-A regression check FAILED: ${checks.filter((c) => !c.pass).length}/${checks.length} contracts violated.`,
  );
  process.exit(1);
}
console.log(
  `ORCH-0829-A regression check PASS: ${checks.length}/${checks.length}.`,
);
