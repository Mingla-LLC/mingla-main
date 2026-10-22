// issue #3827 — the order screen and the Orders ledger after guest-list comps.
//
//   O-1  Q10 / discovery D-1: "Resend ticket" goes through guest-list `resend`
//        (service key on the server), never a direct dispatcher call with the
//        host's token, which ticket-confirmation-dispatch always refuses (403).
//   O-2  a guest-list (comp) order never renders refund or cancel controls on
//        the order screen: it redirects to the guest page first.
//   O-3  the Orders list is the sales ledger: comps are filtered out.
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const detail = readFileSync(join(__dirname, "..", "[oid]", "index.tsx"), "utf8");
const list = readFileSync(join(__dirname, "..", "index.tsx"), "utf8");

describe("issue #3827 — order screen", () => {
  test("O-1 resend uses guest-list resend, not the dispatcher with a user token", () => {
    expect(detail).toMatch(/resendGuestListTicket\(\{\s*orderId:\s*order\.id/);
    expect(detail).not.toContain("resendTicketConfirmation");
  });

  test("O-2 a guest-list order redirects to the guest page before any refund/cancel control", () => {
    expect(detail).toMatch(/router\.replace\(`\/event\/\$\{eventId\}\/guests\/order-\$\{orderId\}`/);
    const early = detail.indexOf("if (isGuestListOrder) {");
    const refund = detail.search(/<RefundSheet\s/);
    expect(early).toBeGreaterThan(0);
    expect(refund === -1 || early < refund).toBe(true);
  });

  test("O-3 the Orders list drops guest-list orders", () => {
    expect(list).toContain("withoutCompOrders(ordersQuery.data ?? [])");
  });
});
