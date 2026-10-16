/**
 * #3645 Ilashe P0 — Paystack paid-without-ticket recovery via reconcile sweep.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classify } from "../classify.ts";

const NOW = "2026-10-16T12:00:00.000Z";
const PAST = "2026-10-16T11:00:00.000Z";
const FUTURE = "2026-10-16T12:30:00.000Z";

Deno.test("#3645 classify: Paystack success finalizes even past expiry", () => {
  assertEquals(
    classify({
      refClass: "PAYSTACK",
      expiresAt: PAST,
      truth: { paystackStatus: "success" },
      nowIso: NOW,
    }),
    { action: "finalize" },
  );
});

Deno.test("#3645 classify: Paystack terminal unpaid expires only past cutoff", () => {
  assertEquals(
    classify({
      refClass: "PAYSTACK",
      expiresAt: PAST,
      truth: { paystackStatus: "abandoned" },
      nowIso: NOW,
    }),
    { action: "expire" },
  );
  assertEquals(
    classify({
      refClass: "PAYSTACK",
      expiresAt: FUTURE,
      truth: { paystackStatus: "failed" },
      nowIso: NOW,
    }),
    { action: "skip", reason: "in_window" },
  );
});

Deno.test("#3645 classify: missing verify truth never expires", () => {
  assertEquals(
    classify({
      refClass: "PAYSTACK",
      expiresAt: PAST,
      truth: {},
      nowIso: NOW,
    }),
    { action: "skip", reason: "paystack_verify_unavailable" },
  );
});

Deno.test("#3645 source: sweep imports Paystack verify + charge success", async () => {
  const src = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  if (!src.includes("paystackVerifyTransaction")) {
    throw new Error("missing paystackVerifyTransaction import");
  }
  if (!src.includes("handlePaystackChargeSuccess")) {
    throw new Error("missing handlePaystackChargeSuccess finalize path");
  }
  if (!src.includes("PAYSTACK_VERIFY_BATCH_LIMIT")) {
    throw new Error("missing Paystack verify batch cap");
  }
  if (src.includes("paystack_verify_unavailable")) {
    throw new Error("legacy unconditional paystack_verify_unavailable skip remains");
  }
});
