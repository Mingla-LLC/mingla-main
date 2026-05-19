/**
 * ORCH-0876 [Trip CRUD + Purchase Flow Completion] — implementor happy-path
 * regression test per ORCH-0840 [Regression-test enforcement + append-only CI].
 *
 * Pins the refund-gate rejection-dialog mapping inside
 * `EditPublishedTripScreen.tsx`: every server RPC rejection reason from
 * `UpdateLiveTripRejectReason` MUST map to a user-friendly dialog with a
 * "Refund first"-style remedy, and the destructive ones MUST surface an
 * "Open Orders" CTA.
 *
 * Any future refactor that drops a case from the switch — or that returns
 * a raw error string to the operator — fails this test.
 *
 * Spec: SPEC_ORCH-0876_V2_FULL_PARITY §6.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOT = join(__dirname, "..", "..", "..");
function read(rel: string): string {
  return readFileSync(join(SRC_ROOT, rel), "utf8");
}

describe("ORCH-0876 — EditPublishedTripScreen refund-gate dialog mapping", () => {
  const SRC = read("components/trip/EditPublishedTripScreen.tsx");

  // Isolate the buildRejectDialog function body so the case-coverage assertions
  // can't accidentally match content elsewhere in the file.
  const fnMatch = SRC.match(
    /const buildRejectDialog = useCallback\([\s\S]*?\[router,\s*showToast\],\s*\);/,
  );
  test("buildRejectDialog is present as a useCallback returning RejectDialogContent", () => {
    expect(fnMatch).not.toBeNull();
  });
  const FN = fnMatch?.[0] ?? "";

  const REASONS = [
    "missing_edit_reason",
    "invalid_edit_reason",
    "trip_not_found",
    "trip_not_editable_status",
    "capacity_below_sold",
    "dates_shifted_with_sales",
    "days_dropped_with_sales",
    "inclusions_removed_with_sales",
    "tier_delete_with_sales",
    "tier_price_change_with_sales",
  ] as const;

  for (const reason of REASONS) {
    test(`switch handles reason='${reason}'`, () => {
      expect(FN).toContain(`case "${reason}":`);
    });
  }

  test("destructive reasons surface 'Open Orders' as the primary CTA", () => {
    const destructive = [
      "capacity_below_sold",
      "dates_shifted_with_sales",
      "days_dropped_with_sales",
      "inclusions_removed_with_sales",
      "tier_delete_with_sales",
      "tier_price_change_with_sales",
    ];
    for (const reason of destructive) {
      const caseMatch = FN.match(
        new RegExp(
          `case "${reason}":[\\s\\S]*?primaryLabel:\\s*"Open Orders"`,
        ),
      );
      expect(caseMatch).not.toBeNull();
    }
  });

  test("non-destructive reasons close the dialog without nav (closeOnly action)", () => {
    // missing_edit_reason + invalid_edit_reason + trip_not_editable_status
    // route to closeOnly. trip_not_found navigates back.
    expect(FN).toMatch(/case "missing_edit_reason":[\s\S]*?primaryAction:\s*closeOnly/);
    expect(FN).toMatch(/case "invalid_edit_reason":[\s\S]*?primaryAction:\s*closeOnly/);
    expect(FN).toMatch(/case "trip_not_editable_status":[\s\S]*?primaryAction:\s*closeOnly/);
  });

  test("dialog copy is buyer-protection-first: 'Refund first' headline", () => {
    // At least 5 of the destructive cases must use the 'Refund first' headline.
    const matches = FN.match(/title:\s*"Refund first"/g);
    expect(matches).not.toBeNull();
    expect((matches ?? []).length).toBeGreaterThanOrEqual(5);
  });

  test("exhaustive switch — never-defaulted union (no silent fall-through)", () => {
    expect(FN).toMatch(/const _exhaust:\s*never\s*=\s*result\.reason/);
  });

  test("missing/invalid reason dialog mentions the 10–200 char range", () => {
    expect(FN).toMatch(
      /case "missing_edit_reason":[\s\S]*?between 10 and 200 characters/,
    );
  });

  test("rejectDialog state is set after a server ok=false and after preflight failure", () => {
    expect(SRC).toMatch(/setRejectDialog\(buildRejectDialog\(preflight\)\)/);
    expect(SRC).toMatch(/setRejectDialog\(buildRejectDialog\(result\)\)/);
  });

  test("ConfirmDialog wires the dialog's primaryAction on Confirm tap", () => {
    expect(SRC).toMatch(
      /<ConfirmDialog[\s\S]*?onConfirm=\{[\s\S]*?rejectDialog\.primaryAction\(\)/,
    );
  });

  test("'Open Orders' transitional CTA surfaces a Stripe-dashboard hint (trip-orders ledger pending)", () => {
    // Until trip-orders ledger ships, the 'closeAndOpenOrders' helper points
    // operators at Stripe Dashboard. Removing this hint would lose the only
    // current path for the operator to actually refund.
    expect(FN).toMatch(/Trip orders ledger is coming soon/);
    expect(FN).toMatch(/Stripe dashboard/);
  });

  test("UpdateLiveTripPermissionError handler surfaces auth + event-type + permission toasts", () => {
    expect(SRC).toContain(
      'import { UpdateLiveTripPermissionError } from "../../services/tripsService"',
    );
    expect(SRC).toMatch(/if \(e instanceof UpdateLiveTripPermissionError\)/);
    expect(SRC).toMatch(/case "authentication_required":?[\s\S]*?Sign in to save changes|"You're signed out\. Sign in to save changes\."/);
    // event_not_a_trip mismatch: operator opened the wrong editor.
    expect(SRC).toMatch(/This isn't a trip — open the event editor instead\./);
  });
});
