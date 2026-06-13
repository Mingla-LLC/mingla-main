/**
 * ORCH-1130 — order-summary "Total due today" + vestigial Calculate-tax
 * removal. Source-file structural regression test (file reads + regex,
 * mirror of native_checkout_flow_parity.test.ts). Append-only; happy-path.
 *
 * Fix #1 — order-summary box renders BOTH "Total" (full) AND "Total due
 * today" (deposit) under installments, on the trip buyer + payment steps.
 * The due-today line is gated (pay-over-time only); pay-in-full shows Total
 * only. fails-on-revert: delete the due-today JSX → these assertions FAIL.
 *
 * Fix #2 — neither the trip nor the event (nor experience) payment screen
 * renders CartTaxPreview / a "Calculate tax" gate; the deleted component is
 * gone; Pay is NOT disabled awaiting a tax calc; and the native create path
 * carries NO buyer address (call-shape). fails-on-revert: re-add the form
 * or its Pay-gate → these assertions FAIL.
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..", "..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(repoRoot, rel), "utf8");
const exists = (rel: string): boolean =>
  fs.existsSync(path.join(repoRoot, rel));

const TRIP_BUYER = "mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx";
const TRIP_PAYMENT =
  "mingla-business/app/checkout-trip/[tripEventId]/payment.tsx";
const EVENT_PAYMENT = "mingla-business/app/checkout/[eventId]/payment.tsx";
const EXPERIENCE_PAYMENT =
  "mingla-business/app/checkout-experience/[experienceEventId]/payment.tsx";
const DEAD_COMPONENT =
  "mingla-business/src/components/checkout/CartTaxPreview.tsx";

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("ORCH-1130 Fix #1 — Total + Total due today under installments", () => {
  it("trip buyer.tsx renders a 'Total due today' line gated on the deposit memo", () => {
    const code = stripComments(read(TRIP_BUYER));
    // Both labels present (full Total + due-today).
    expect(code).toMatch(/>Total</);
    expect(code).toMatch(/Total due today/);
    // The due-today line is gated on the re-added dueTodayCents memo (deposit
    // read from projectInstallmentSchedule, NOT recomputed).
    expect(code).toMatch(/dueTodayCents\s*!==\s*null/);
    expect(code).toMatch(/projectInstallmentSchedule\(/);
    expect(code).toMatch(/paymentPlanChoice\s*!==\s*"installments"/);
  });

  it("trip payment.tsx renders a 'Total due today' line from projectedSchedule.depositCents", () => {
    const code = stripComments(read(TRIP_PAYMENT));
    expect(code).toMatch(/>Total</);
    expect(code).toMatch(/Total due today/);
    // Gated on the installments selection + the EXISTING projected schedule
    // deposit (never recomputed in the box).
    expect(code).toMatch(
      /isUsingInstallments\s*&&\s*projectedSchedule\s*!==\s*null/,
    );
    expect(code).toMatch(/projectedSchedule\.depositCents/);
  });
});

describe("ORCH-1130 Fix #2 — vestigial Calculate-tax / billing-address form removed", () => {
  it("deleted the shared CartTaxPreview component", () => {
    expect(exists(DEAD_COMPONENT)).toBe(false);
  });

  for (const screen of [TRIP_PAYMENT, EVENT_PAYMENT, EXPERIENCE_PAYMENT]) {
    it(`${screen} renders no CartTaxPreview / Calculate-tax / billing-address form`, () => {
      const code = stripComments(read(screen));
      expect(code).not.toMatch(/\bCartTaxPreview\b/);
      expect(code).not.toMatch(/Calculate tax/i);
      expect(code).not.toMatch(/BILLING ADDRESS/i);
      expect(code).not.toMatch(/handleTaxPreviewChange/);
    });

    it(`${screen} does NOT disable Pay awaiting a tax calc (no taxPreview === null gate)`, () => {
      const code = stripComments(read(screen));
      // The old Pay-gate `(Platform.OS !== "web" && taxPreview === null)` is gone.
      expect(code).not.toMatch(/taxPreview\s*===\s*null/);
      expect(code).not.toMatch(/Calculate tax before paying/);
    });
  }

  it("native create call carries NO buyer address (no-address venue-sourced path)", () => {
    // nativeCheckoutFlow.native.ts only forwards an address if a (legacy)
    // caller supplies one — the screens no longer pass buyer.address.
    const flow = stripComments(
      read("mingla-business/src/payments/nativeCheckoutFlow.native.ts"),
    );
    expect(flow).toMatch(
      /input\.buyer\.address\s*\?\s*\{\s*address:\s*input\.buyer\.address\s*\}\s*:\s*\{\}/,
    );

    // None of the payment screens send a buyer address into nativeCheckout.
    for (const screen of [TRIP_PAYMENT, EVENT_PAYMENT, EXPERIENCE_PAYMENT]) {
      const code = stripComments(read(screen));
      // The previous `address: readyTaxPreview.address` is gone.
      expect(code).not.toMatch(/address:\s*readyTaxPreview\.address/);
      // The native create still gets the all-in via a NO-ADDRESS mode:"preview".
      expect(code).toMatch(/mode:\s*"preview"/);
    }
  });

  it("the all-in total (incl. tax) is shown via the silent no-address preview", () => {
    for (const screen of [TRIP_PAYMENT, EVENT_PAYMENT, EXPERIENCE_PAYMENT]) {
      const code = stripComments(read(screen));
      // displayAllIn prefers the server-computed preview total (cents) over base.
      expect(code).toMatch(/allInPreviewCents/);
      expect(code).toMatch(/displayAllIn/);
    }
  });
});
