/**
 * #4402 — the host contract page after a creator-hire payment.
 *
 * MINGLA-INVARIANT: I-4402-E | issue #4402 | the host UI never says "Nothing was charged" while the server's payment_check is not not_paid
 *
 * fails-on-revert: restoring the old "Payment not completed … Nothing was
 * charged" card (shown whenever the offer had no captured hold) puts the
 * literal back in HostGigContractScreen and the source assertions fail;
 * restoring confirmGigHire in HireSheet fails the confirm_reference check.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mockInvoke = jest.fn();
jest.mock("../../../../services/supabase", () => ({
  supabase: { functions: { invoke: mockInvoke }, rpc: jest.fn(), from: jest.fn() },
}));
jest.mock("../../../../services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));

import {
  hostPaymentCard,
  nextPaymentCheckDelay,
  paymentCheckState,
  PAYMENT_CHECK_LIMIT_MS,
  type HostPaymentCheckState,
} from "../../../programs/contractCopy";
import { confirmGigReference, startGigHire } from "../../../../services/gigHireService";
import { programErrorMessage } from "../../../../utils/creatorProgramFormat";

const ALL: HostPaymentCheckState[] = [
  "checking",
  "paid",
  "pending",
  "not_paid",
  "mismatch",
  "refunded",
  "error",
];
const SRC = join(__dirname, "..", "..", "..", "..");

describe("#4402 payment card copy", () => {
  it("says 'Nothing was charged' only when the server said not_paid", () => {
    for (const state of ALL) {
      for (const fromReturn of [true, false]) {
        const card = hostPaymentCard(state, { creatorName: "Ada", fromReturn });
        const words = card ? `${card.title} ${card.body}` : "";
        expect(words.includes("Nothing was charged")).toBe(state === "not_paid");
      }
    }
  });

  it("offers Retry only after not_paid (or a refunded late payment), never while confirming", () => {
    expect(hostPaymentCard("checking", { creatorName: "Ada", fromReturn: true })).toMatchObject({
      title: "Confirming your payment…",
      action: null,
      busy: true,
    });
    expect(hostPaymentCard("checking", { creatorName: "Ada", fromReturn: false })?.title).toBe(
      "Checking your payment",
    );
    expect(hostPaymentCard("pending", { creatorName: "Ada", fromReturn: true })).toMatchObject({
      title: "Your payment is still being confirmed",
      body: "We'll update this page when it lands. You won't be charged twice.",
      action: "check",
      actionLabel: "Check again",
    });
    expect(hostPaymentCard("not_paid", { creatorName: "Ada", fromReturn: true })).toMatchObject({
      title: "The payment didn't go through",
      body: "Nothing was charged.",
      action: "retry",
      actionLabel: "Try again",
    });
    expect(hostPaymentCard("not_paid", { creatorName: "Ada", fromReturn: false })).toMatchObject({
      title: "Payment not completed",
      action: "retry",
      actionLabel: "Retry payment",
    });
    expect(hostPaymentCard("mismatch", { creatorName: "Ada", fromReturn: true })).toMatchObject({
      title: "We couldn't match this payment",
      body: "Our team has been alerted.",
      action: null,
    });
    expect(hostPaymentCard("paid", { creatorName: "Ada", fromReturn: true })).toBeNull();
    for (const state of ["checking", "pending", "mismatch", "error"] as const) {
      expect(hostPaymentCard(state, { creatorName: "Ada", fromReturn: false })?.action).not.toBe("retry");
    }
  });

  it("maps answers to states; unknown answers are errors, never not_paid", () => {
    expect(paymentCheckState({ ok: true, payment_check: "paid" })).toBe("paid");
    expect(paymentCheckState({ ok: false, payment_check: "pending" })).toBe("pending");
    expect(paymentCheckState({ ok: false, payment_check: "not_paid" })).toBe("not_paid");
    expect(paymentCheckState({ ok: false })).toBe("error");
    expect(paymentCheckState({ ok: false, payment_check: "something" })).toBe("error");
  });

  it("polls a pending answer every 3 s for up to 30 s, then stops", () => {
    expect(nextPaymentCheckDelay("pending", 0)).toBe(3000);
    expect(nextPaymentCheckDelay("pending", PAYMENT_CHECK_LIMIT_MS - 3000)).toBe(3000);
    expect(nextPaymentCheckDelay("pending", PAYMENT_CHECK_LIMIT_MS - 2999)).toBeNull();
    expect(nextPaymentCheckDelay("paid", 0)).toBeNull();
    expect(nextPaymentCheckDelay("not_paid", 0)).toBeNull();
  });
});

describe("#4402 gig hire service", () => {
  beforeEach(() => mockInvoke.mockReset());

  it("confirm_reference sends the reference and the contract, nothing else", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { ok: true, status: "captured", payment_check: "paid", brand_id: "b", contract_id: "c" },
      error: null,
    });
    await expect(confirmGigReference({ contractId: "c", reference: "ghold_x" })).resolves.toMatchObject({
      ok: true,
      payment_check: "paid",
      brand_id: "b",
    });
    expect(mockInvoke).toHaveBeenCalledWith("gig-hire", {
      body: { action: "confirm_reference", reference: "ghold_x", contract_id: "c" },
    });
  });

  it("a refused start keeps the paid offer it points at", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: { json: async () => ({ ok: false, error: "already_paid", contract_id: "c1" }) },
      },
    });
    await expect(
      startGigHire({ interestId: "i1", feeMinor: 10000, idempotencyKey: "gig-i1-10000-abcd" }),
    ).resolves.toEqual({ ok: false, error: "already_paid", contract_id: "c1" });
    expect(mockInvoke.mock.calls[0][1].body).not.toHaveProperty("return_url");
  });

  it("has words for every payment check error", () => {
    for (const code of [
      "already_paid",
      "payment_pending",
      "payment_failed",
      "payment_mismatch",
      "payment_check_failed",
      "payment_late_refunded",
    ]) {
      expect(programErrorMessage(code, "FALLBACK")).not.toBe("FALLBACK");
    }
    expect(programErrorMessage("payment_pending")).not.toContain("Nothing was charged");
  });
});

describe("#4402 screens use the server's check", () => {
  const screen = readFileSync(
    join(SRC, "components", "creators", "screens", "HostGigContractScreen.tsx"),
    "utf8",
  );
  const sheet = readFileSync(join(SRC, "components", "gigs", "HireSheet.tsx"), "utf8");

  it("the contract page has no hard-coded 'Nothing was charged' and reads the payment card", () => {
    expect(screen).not.toContain("Nothing was charged");
    expect(screen).toContain("hostPaymentCard(");
    expect(screen).toContain("confirmGigReference(");
    expect(screen).toContain('"reference"');
  });

  it("the hire sheet confirms through confirm_reference and opens an already-paid offer", () => {
    expect(sheet).toContain("confirmGigReference(");
    expect(sheet).not.toContain("confirmGigHire");
    expect(sheet).toMatch(/start\.error === "already_paid"[\s\S]{0,80}onPaid\(start\.contract_id\)/);
  });
});
