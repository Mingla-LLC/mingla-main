// Issue #1237 (pre-flip fast-follow of #1013) — append-only companion to
// issue_1218_parse_stamp_defensive.adversarial.test.ts.
//
// Closes the contained P2 gap that #1218's adversarial suite documented but
// deliberately did NOT lock in (see that file, lines "NOTE (see QA report P2
// finding)"): a `fees_breakdown` row whose `amount` is a FALSY-but-absent value
// (`null` / `""` / `false` / `0`) was coerced by `Number(...)` to a real `0`
// line, flipped the internal saw-numeric gate, and made
// `parsePaystackTransferCost` return a spurious `{0,0}` — MASKING the combined
// `fee_charged` that the reconcile actually needs.
//
// Zero money impact today (parsed cost is display/reconcile-only; not wired into
// net_release, same containment as #1217/#1219), but it MUST be correct before
// the NG flip turns on fee reconciliation.
//
// Fails-on-revert: deleting the #1237 presence/typeof gate in engine.ts (which
// restores `const amount = Number(row.amount); if (!Number.isInteger(amount) ||
// amount < 0) continue;`) makes each falsy-amount case coerce to a real 0 line,
// flip sawNumeric, and return {0,0} → every "falls back" assertion below fails.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parsePaystackTransferCost } from "../engine.ts";

// Each falsy-but-absent amount must be treated as NOT a real fee line, so the
// parser falls back to the combined fee_charged instead of collapsing to {0,0}.
Deno.test("#1237 falsy breakdown amount falls back to fee_charged (never spurious {0,0})", () => {
  const falsyAmounts: unknown[] = [null, "", false, 0];
  for (const amount of falsyAmounts) {
    const cost = parsePaystackTransferCost({
      status: "success",
      fee_charged: 2_500,
      // Single row whose amount is falsy-but-absent — the only itemised line.
      fees_breakdown: [{ amount, type: "transfer" }],
    });
    assertEquals(
      cost,
      { actualFeeCents: 2_500, actualStampCents: 0 },
      `amount=${JSON.stringify(amount)} must fall back to fee_charged, not {0,0}`,
    );
    assert(
      cost !== null && (cost.actualFeeCents + cost.actualStampCents) > 0,
      `amount=${JSON.stringify(amount)} must not collapse the transfer cost to 0`,
    );
  }
});

// The same falsy amounts appearing as the FEE line must not suppress a genuine,
// present stamp line — the real 5_000 stamp is still honoured (proves the fix
// suppresses only falsy lines, it does not over-correct and drop real ones).
Deno.test("#1237 falsy fee line does not suppress a genuine present stamp line", () => {
  const falsyAmounts: unknown[] = [null, "", false, 0];
  for (const amount of falsyAmounts) {
    const cost = parsePaystackTransferCost({
      status: "success",
      fee_charged: 5_000,
      fees_breakdown: [
        { amount, type: "transfer" }, // falsy fee line → skipped
        { amount: 5_000, type: "stamp_duty" }, // genuine stamp → honoured
      ],
    });
    assertEquals(
      cost,
      { actualFeeCents: 0, actualStampCents: 5_000 },
      `amount=${JSON.stringify(amount)}: genuine stamp line must survive`,
    );
  }
});

// Guard against over-correction: a genuine positive breakdown is still itemised
// exactly as before the fix (unchanged behaviour, pinned here for regression).
Deno.test("#1237 genuine positive breakdown is unchanged", () => {
  assertEquals(
    parsePaystackTransferCost({
      status: "success",
      fee_charged: 7_500,
      fees_breakdown: [
        { amount: 2_500, type: "transfer" },
        { amount: 5_000, type: "stamp_duty" },
      ],
    }),
    { actualFeeCents: 2_500, actualStampCents: 5_000 },
  );
});
