import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../../../../");
const ticketRoute = readFileSync(
  resolve(appRoot, "app/purchases/[kind]/[id].tsx"),
  "utf8",
);
const calendarRow = readFileSync(
  resolve(appRoot, "src/components/activity/BusinessEventCalendarRow.tsx"),
  "utf8",
);

test("ticket detail owns the complete buyer action surface", () => {
  for (const contract of [
    "ticket.showAtDoor",
    "ticket.groupChat",
    "ticket.addToCalendar",
    "ticket.downloadPdf",
    "ticket.refundsHelp",
    "TicketService.fetchTicketPdfUrl",
    "Calendar.updateEventAsync",
    "useBrandFollow",
  ]) {
    assert.ok(
      ticketRoute.includes(contract),
      `missing ticket contract: ${contract}`,
    );
  }
  assert.ok(ticketRoute.includes('accessibilityRole="image"'));
  assert.ok(ticketRoute.includes('statusKey === "valid"'));
  assert.ok(ticketRoute.includes("ticket.status.${statusKey}"));
  assert.ok(!ticketRoute.includes("TicketPdfSheet"));
});

test("reservation detail keeps the venue pass and managed cancellation path", () => {
  for (const contract of [
    "mingla://reservation/",
    "ticket.showAtVenue",
    "ticket.manageBooking",
    "cancelMyReservation",
    "bookingQrLabel",
  ]) {
    assert.ok(
      ticketRoute.includes(contract),
      `missing reservation contract: ${contract}`,
    );
  }
});

test("calendar order rows route to the canonical purchase detail", () => {
  assert.ok(calendarRow.includes("/purchases/order/"));
  assert.ok(!calendarRow.includes("TicketPdfSheet"));
});
