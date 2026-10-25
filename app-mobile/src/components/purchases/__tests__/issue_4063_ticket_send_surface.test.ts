import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../../../../");
const sheet = readFileSync(
  resolve(appRoot, "src/components/purchases/SendTicketSheet.tsx"),
  "utf8",
);
const route = readFileSync(
  resolve(appRoot, "app/purchases/[kind]/[id].tsx"),
  "utf8",
);
const service = readFileSync(
  resolve(appRoot, "src/services/purchasesService.ts"),
  "utf8",
);

test("T5-17 maps the server self-contact refusal to the reviewed sheet error", () => {
  assert.ok(sheet.includes('code === "self"'));
  assert.ok(sheet.includes('"send.errorSelf"'));
  assert.ok(sheet.includes("offerTicketToFriend"));
  assert.ok(service.includes('ticket_offer_self'));
  assert.ok(service.includes('new TicketTransferError("self")'));
});

test("send-to-friend is limited to valid extra tickets and preserves offered QR access", () => {
  assert.ok(route.includes('ticket.ticketIndex >= 2'));
  assert.ok(route.includes('statusKey === "valid"'));
  assert.ok(route.includes('ticket.transferState === "offered"'));
  assert.ok(route.includes("confirmTakeBack(ticket)"));
  assert.ok(route.includes("SendTicketSheet"));
});

test("a post-send cache refresh failure cannot turn a committed transfer into a retry", () => {
  assert.match(
    sheet,
    /postHogService\.capture\("ticket_sent", \{ channel \}\);[\s\S]*?try \{[\s\S]*?await onSent\(\);[\s\S]*?\} catch \{[\s\S]*?onClose\(\);/,
  );
});

test("held tickets join Purchases through their own safe ownership query", () => {
  assert.ok(service.includes("fetchMyHeldTickets"));
  assert.ok(service.includes('.eq("holder_user_id", userId)'));
  assert.ok(service.includes('.eq("transfer_state", "claimed")'));
  assert.ok(service.includes('source: "transfer"'));
});
