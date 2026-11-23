// Issue #3281 S4 — the Admin order view lists add-on lines and refunds an
// add-on on its own (decision D-2), sending `addOnLines` to admin-refund-order.
//
// Run: node --test src/__tests__/issue3281_order_add_on_refunds.implementor.test.js
// (from mingla-admin). Hermetic: drives the pure modules the page renders from.
// Fails on revert: drop the refunded-quantity bound in addOnRows (an add-on
// refunded twice) or the addOnLines body -> red.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addOnRows, addOnLinesBody, addOnSummary, planRemovalNotice, SPREAD_ADD_ON_NOTE } from "../lib/orderAddOnRefunds.js";
import { adminRefundErrorCopy, describeAdminRefundError } from "../lib/adminRefundError.js";

const money = (cents, currency) => `${currency} ${(cents / 100).toFixed(2)}`;
const LINES = [
  { id: "a1", name: "Friday dinner", quantity: 2, unit_price_cents: 1500, total_cents: 3000, refunded_quantity: 1, refunded_cents: 1500 },
  { id: "a2", name: "Tote bag", quantity: 1, unit_price_cents: 900, total_cents: 900, refunded_quantity: 0, refunded_cents: 0 },
  { id: "a3", name: "Welcome drink", quantity: 3, unit_price_cents: 0, total_cents: 0, refunded_quantity: 3, refunded_cents: 0 },
];

describe("#3281 S4 — add-on rows on the order view", () => {
  it("shows name, quantity, paid and refunded, and what is left to refund", () => {
    const rows = addOnRows(LINES);
    assert.deepEqual(rows.map((r) => [r.name, r.quantity, r.paidCents, r.refundedQty, r.remaining]), [
      ["Friday dinner", 2, 3000, 1, 1],
      ["Tote bag", 1, 900, 0, 1],
      ["Welcome drink", 3, 0, 3, 0],
    ]);
    assert.equal(addOnSummary(rows[0], money, "USD"), "×2 · paid USD 30.00 · refunded 1 (USD 15.00)");
    assert.equal(addOnSummary(rows[1], money, "USD"), "×1 · paid USD 9.00");
  });

  it("never offers more than is left: picks clamp to the remaining quantity and money", () => {
    const rows = addOnRows(LINES, { a1: 5, a2: 1, a3: 2 });
    assert.deepEqual(rows.map((r) => [r.id, r.qty, r.amount]), [["a1", 1, 1500], ["a2", 1, 900], ["a3", 0, 0]]);
    // A line whose money is already back (a capped earlier refund) moves nothing more.
    const capped = addOnRows([{ ...LINES[1], refunded_cents: 900 }], { a2: 1 });
    assert.equal(capped[0].amount, 0);
  });

  it("drops malformed rows instead of inventing an add-on", () => {
    assert.deepEqual(addOnRows(null), []);
    assert.deepEqual(addOnRows([null, { id: 7 }, { id: "z", quantity: 0 }]), []);
    assert.equal(addOnRows([{ id: "n", quantity: 1, unit_price_cents: 100, total_cents: 100 }])[0].name, "Add-on");
  });
});

describe("#3281 S4 — the refund body", () => {
  it("sends only picked add-on lines, as order_add_on_line_item_id + quantity", () => {
    const rows = addOnRows(LINES, { a1: 1, a2: 0 });
    assert.deepEqual(addOnLinesBody(rows), { addOnLines: [{ order_add_on_line_item_id: "a1", quantity: 1 }] });
  });

  it("adds no field at all when nothing is picked, so a ticket refund's body is unchanged", () => {
    assert.deepEqual(addOnLinesBody(addOnRows(LINES)), {});
    assert.deepEqual(addOnLinesBody(undefined), {});
  });
});

describe("#3281 S4 — refusal copy", () => {
  it("maps the add-on refund codes to plain copy", () => {
    assert.equal(adminRefundErrorCopy("add_on_line_overrefund"), "That's more of this add-on than is left to refund.");
    assert.equal(adminRefundErrorCopy("add_on_refunds_off"), "Refunding an add-on on its own isn't available yet.");
    assert.match(adminRefundErrorCopy("add_on_line_not_found"), /isn't on this order/);
    assert.deepEqual(describeAdminRefundError({ error: "add_on_line_overrefund" }), {
      code: "add_on_line_overrefund",
      message: "That's more of this add-on than is left to refund.",
      keySpent: false,
    });
  });
});

// #3281 S5 — an add-on spread over a trip plan: units taken off the plan's
// unpaid payments are back like refunded ones. Fails on revert: drop the
// removed quantity from addOnRows and the second unit is offered again.
describe("#3281 S5 — add-ons spread over a trip plan", () => {
  const SPREAD = {
    id: "s1", name: "Airport transfer", quantity: 2, unit_price_cents: 30000, total_cents: 60000,
    refunded_quantity: 0, refunded_cents: 0, plan_choice: "spread", removed_quantity: 1, removed_cents: 30000,
  };

  it("counts a unit taken off the plan as back, in quantity and in money", () => {
    const [row] = addOnRows([SPREAD], { s1: 2 });
    assert.deepEqual([row.spread, row.removedQty, row.removedCents, row.remaining, row.qty, row.amount],
      [true, 1, 30000, 1, 1, 30000]);
    assert.equal(addOnSummary(row, money, "USD"), "×2 · paid USD 600.00 · taken off the plan USD 300.00");
  });

  it("a line with nothing taken off the plan reads exactly as before", () => {
    const [row] = addOnRows([LINES[1]]);
    assert.deepEqual([row.spread, row.removedQty, row.removedCents], [false, 0, 0]);
    assert.equal(addOnSummary(row, money, "USD"), "×1 · paid USD 9.00");
  });

  it("says so when a refund only took an add-on off the plan", () => {
    assert.match(SPREAD_ADD_ON_NOTE, /unpaid part comes off the plan/);
    assert.equal(
      planRemovalNotice({ status: "removed_from_plan", removed_from_plan_cents: 30000 }, money, "USD"),
      "Taken off the plan (USD 300.00). Nothing was paid for it yet, so no money moved.",
    );
    assert.equal(planRemovalNotice({ status: "succeeded", amount_cents: 30000 }, money, "USD"), null);
    assert.equal(planRemovalNotice(null, money, "USD"), null);
  });

  it("maps the plan refusals to plain copy", () => {
    assert.match(adminRefundErrorCopy("add_on_plan_open_use_cancel"), /Cancel the booking/);
    assert.match(adminRefundErrorCopy("add_on_plan_changed"), /going through right now/);
    assert.match(adminRefundErrorCopy("balance_payment_in_flight"), /going through right now/);
  });
});

// #3281 deploy window — Admin deploys before the migrations are applied.
// FAILS-ON-REVERT: every order on main's database shows "Couldn't load this
// order's add-ons" because admin_order_add_on_lines does not exist yet.
import { readAddOnLinesResult } from "../lib/orderAddOnRefunds.js";

describe("#3281 deploy window — admin_order_add_on_lines on main's database", () => {
  it("a missing function is no add-ons (no section), exactly as on main", () => {
    assert.deepEqual(readAddOnLinesResult({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }), []);
    assert.deepEqual(readAddOnLinesResult({ data: null, error: { code: "42883", message: "does not exist" } }), []);
    assert.deepEqual(addOnRows(readAddOnLinesResult({ data: null, error: { code: "PGRST202" } })), []);
  });
  it("a real failure still throws (the page says the add-ons didn't load)", () => {
    assert.throws(() => readAddOnLinesResult({ data: null, error: { code: "XX000", message: "boom" } }), /boom/);
  });
  it("lines pass through once the function exists", () => {
    const lines = [{ id: "a", name: "Tote", quantity: 1, unit_price_cents: 1000, total_cents: 1000 }];
    assert.deepEqual(readAddOnLinesResult({ data: lines, error: null }), lines);
  });
});
