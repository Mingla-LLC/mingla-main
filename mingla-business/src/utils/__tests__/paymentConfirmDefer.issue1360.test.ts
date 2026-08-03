/**
 * #1360 [payment-confirm-defer] — Tier 3 of #1342. Implementor happy-path
 * regression, LAYER 2: SOURCE WIRING (SPEC §7 T-3/T-4/T-5, SC-5).
 *
 * The order/door screens carry heavy native deps the node/ts-jest env cannot
 * render, so — exactly like CoverPickerSheet.nestedToast.issue1356.test.tsx —
 * the wiring is asserted over SOURCE TEXT: every payment-confirmation onSuccess
 * handler must CLOSE its sheet/dialog FIRST and route its confirmation toast
 * through deferAfterDismiss(() => showToast(...)) — never a raw synchronous
 * showToast(...) in the close handler.
 *
 * FAILS-ON-REVERT (SPEC §9): revert any handler to the pre-fix
 * `showToast(...) ; close()` shape and its assertion goes RED — the handler then
 * contains a showToast that is NOT wrapped in deferAfterDismiss, so the deferred
 * count no longer equals the showToast count.
 *
 * Covers all FOUR folded-in sites (orchestrator scope decision):
 *   RefundSheet + CancelOrderDialog (orders/[oid]/index.tsx) and
 *   DoorRefundSheet via BOTH parents (door/[saleId].tsx, guests/[guestId].tsx).
 *
 * I-PROPOSED-1360-PAYMENT-CONFIRM-DEFERRED-PAST-DISMISSAL.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, test } from "@jest/globals";

// src/utils/__tests__ → up three → mingla-business root.
const BIZ_ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string): string => readFileSync(join(BIZ_ROOT, rel), "utf8");

// Strip block + line comments so the doc comments (which name showToast /
// deferAfterDismiss in prose) can never satisfy or trip a code assertion. The
// `[^:]` guard keeps `https://` intact.
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ORDERS = "app/event/[id]/orders/[oid]/index.tsx";
const DOOR = "app/event/[id]/door/[saleId].tsx";
const GUESTS = "app/event/[id]/guests/[guestId].tsx";

const ordersCode = stripComments(read(ORDERS));
const doorCode = stripComments(read(DOOR));
const guestsCode = stripComments(read(GUESTS));

/**
 * Return the `{ ... }` block whose opening brace is the first `{` at/after
 * `marker`, via balanced-brace scanning. Template-literal `${...}` braces stay
 * balanced, so the scan terminates at the true block end.
 */
function sliceHandler(src: string, marker: string): string {
  const m = src.indexOf(marker);
  if (m < 0) throw new Error(`marker not found: ${marker}`);
  const open = src.indexOf("{", m);
  if (open < 0) throw new Error(`no block after marker: ${marker}`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced block after marker: ${marker}`);
}

/**
 * A payment-confirmation handler is correctly wired iff:
 *  - it raises at least one showToast,
 *  - EVERY showToast in it is wrapped in `deferAfterDismiss(() => showToast(`, and
 *  - its sheet/dialog close call precedes the defer.
 */
function assertDeferred(block: string, closeCall: string, _label: string): void {
  // At least one confirmation toast is raised.
  const showToasts = (block.match(/showToast\(/g) ?? []).length;
  expect(showToasts).toBeGreaterThan(0);
  // EVERY showToast in the handler is wrapped in deferAfterDismiss — a revert to
  // a raw synchronous showToast(...) drops the wrapper and this count diverges.
  const deferred = (
    block.match(/deferAfterDismiss\(\s*\(\)\s*=>\s*showToast\(/g) ?? []
  ).length;
  expect(deferred).toBe(showToasts);
  // The sheet/dialog closes BEFORE the toast is deferred.
  const closeIdx = block.indexOf(closeCall);
  const deferIdx = block.indexOf("deferAfterDismiss(");
  expect(closeIdx).toBeGreaterThanOrEqual(0);
  expect(closeIdx).toBeLessThan(deferIdx);
}

describe("#1360 payment confirmation toast is deferred past sheet dismissal", () => {
  test("the shared deferAfterDismiss helper exists and imports the primitives' delay", () => {
    const util = read("src/utils/deferAfterDismiss.ts");
    expect(util).toMatch(/export function deferAfterDismiss\(/);
    // Single source of truth: the delay is imported from the Sheet/Modal
    // primitives, never hardcoded.
    expect(util).toMatch(
      /from "\.\.\/components\/ui\/SheetMobile"/,
    );
    expect(util).toMatch(/from "\.\.\/components\/ui\/Modal"/);
    expect(stripComments(util)).toMatch(/setTimeout\(/);
  });

  test("T-3 RefundSheet onSuccess closes then defers (orders/[oid])", () => {
    const block = sliceHandler(ordersCode, "onSuccess={(amountGbp) =>");
    assertDeferred(block, "setRefundSheetMode(null)", "RefundSheet");
  });

  test("T-4 CancelOrderDialog onSuccess closes then defers (orders/[oid])", () => {
    const block = sliceHandler(ordersCode, "onSuccess={() =>");
    assertDeferred(block, "setCancelDialogVisible(false)", "CancelOrderDialog");
  });

  test("T-5a DoorRefundSheet onSuccess closes then defers (door/[saleId])", () => {
    const block = sliceHandler(
      doorCode,
      "const handleRefundSuccess = useCallback",
    );
    assertDeferred(block, "setRefundOpen(false)", "DoorRefundSheet(door)");
  });

  test("T-5b DoorRefundSheet onSuccess closes then defers (guests/[guestId])", () => {
    const block = sliceHandler(guestsCode, "const handleDoorRefundSuccess =");
    assertDeferred(block, "setRefundOpen(false)", "DoorRefundSheet(guests)");
  });

  test("every payment screen imports the shared helper", () => {
    for (const code of [ordersCode, doorCode, guestsCode]) {
      expect(code).toMatch(
        /import \{ deferAfterDismiss \} from ".*utils\/deferAfterDismiss"/,
      );
    }
  });
});
