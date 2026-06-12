/**
 * ORCH-1120 [Published-trip Settings tab → editable refund tiers + booking
 * deadline + bookings-closed (sales-gated)] — implementor happy-path
 * regression test (per ORCH-0840 regression-test enforcement + append-only CI).
 *
 * Pins the THREE load-bearing contracts of ORCH-1120 in source:
 *   1. The new EditPublishedTripSettingsAccordion saves ONLY through the
 *      sales-gated biz_update_live_trip path (useUpdateLiveTripFields /
 *      updateLiveTripFields), NEVER the sales-unaware refundPolicyService
 *      updateRefundPolicy / updateBookingDeadline. (SC-3, §6 audit invariant.)
 *   2. The accordion mounts the live (NON-disabled) "Bookings closed" Switch
 *      with onValueChange + carries ONLY the dirty fields into the patch.
 *      (SC-1, SC-2.)
 *   3. The parent screen's buildRejectDialog exhaustively handles the 4 new
 *      refund-class reject reasons with the "Refund first" copy + "Open Orders"
 *      CTA, and the read-only Settings snapshot + dead-end "use the wizard"
 *      hint are GONE. (SC-4, SC-7, T-13.)
 *
 * fails-on-revert: deleting any of the 4 new buildRejectDialog cases, the
 * gated-save call, the live Switch, or re-introducing the dead-end hint makes
 * a matching assertion fail.
 *
 * The tester layers the adversarial different-angle suite (live SQL gate drive,
 * device dead-tap proof, Android opaque-glass) per SPEC §13.
 *
 * Spec: SPEC_ORCH-1120_TRIP_SETTINGS_REFUND_DEADLINE.md §8, §9.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOT = join(__dirname, "..", "..", "..");
function read(rel: string): string {
  return readFileSync(join(SRC_ROOT, rel), "utf8");
}

// Strip comments so the "never calls X" assertions test actual CODE, not the
// header prose (which legitimately documents what the published path must NOT
// call). Mirrors the strict-grep gate's comment-stripping.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("ORCH-1120 — published-trip Settings editable refund/deadline/bookings-closed", () => {
  const SCREEN = read("components/trip/EditPublishedTripScreen.tsx");
  const ACCORDION = read(
    "components/trip/EditPublishedTripSettingsAccordion.tsx",
  );
  const SERVICE = read("services/tripsService.ts");

  // ---- 1. Gated-RPC routing (SC-3) ----
  describe("saves route through the sales-gated biz_update_live_trip RPC", () => {
    test("accordion calls the gated mutation hook", () => {
      expect(ACCORDION).toMatch(/useUpdateLiveTripFields\(\)/);
      expect(ACCORDION).toMatch(/\.mutateAsync\(\{/);
    });

    test("accordion NEVER calls the sales-unaware refundPolicyService writers", () => {
      const code = stripComments(ACCORDION);
      expect(code).not.toMatch(/updateRefundPolicy/);
      expect(code).not.toMatch(/updateBookingDeadline/);
    });

    test("the published screen NEVER calls the sales-unaware refundPolicyService writers", () => {
      const code = stripComments(SCREEN);
      expect(code).not.toMatch(/updateRefundPolicy/);
      expect(code).not.toMatch(/updateBookingDeadline/);
    });
  });

  // ---- 2. Live controls + dirty-only patch (SC-1, SC-2) ----
  describe("live controls + dirty-only patch", () => {
    test("Bookings-closed Switch is live (onValueChange + native disabled only during submit)", () => {
      expect(ACCORDION).toMatch(/onValueChange=\{setClosed\}/);
      // The switch must NOT be hardcoded disabled — only disabled while submitting.
      expect(ACCORDION).toMatch(/disabled=\{submitting\}/);
      expect(ACCORDION).toMatch(/accessibilityRole="switch"/);
    });

    test("mounts the ORCH-0875 editors UNMODIFIED, each wrapped for submit-disable (FORK 2)", () => {
      expect(ACCORDION).toMatch(/<RefundPolicyEditor value=\{policy\} onChange=\{setPolicy\} \/>/);
      expect(ACCORDION).toMatch(/<BookingDeadlinePicker/);
      expect(ACCORDION).toMatch(
        /pointerEvents=\{submitting \? "none" : "auto"\}/,
      );
    });

    test("patch carries ONLY the dirty fields", () => {
      expect(ACCORDION).toMatch(/patch\.refund_policy = policy/);
      expect(ACCORDION).toMatch(/patch\.booking_deadline = deadline/);
      expect(ACCORDION).toMatch(/patch\.bookings_closed = closed/);
    });

    test("ok:false business rejects route to the parent via onReject (FORK 1)", () => {
      expect(ACCORDION).toMatch(/onReject\(result\)/);
    });
  });

  // ---- 3. Service union extension ----
  describe("service contract", () => {
    test("LiveTripPatch carries the 3 new keys", () => {
      expect(SERVICE).toMatch(/refund_policy\?:/);
      expect(SERVICE).toMatch(/booking_deadline\?:/);
      expect(SERVICE).toMatch(/bookings_closed\?:/);
    });

    const NEW_REASONS = [
      "refund_policy_downgrade_with_sales",
      "refund_tier_removed_with_sales",
      "booking_deadline_earlier_with_sales",
      "bookings_closed_harms_active",
    ];
    for (const r of NEW_REASONS) {
      test(`UpdateLiveTripRejectReason includes '${r}'`, () => {
        expect(SERVICE).toContain(`"${r}"`);
      });
    }
  });

  // ---- 4. Parent reject dialog (SC-4, SC-7) ----
  describe("buildRejectDialog exhaustively handles the 4 new refund-class reasons", () => {
    const fnMatch = SCREEN.match(
      /const buildRejectDialog = useCallback\([\s\S]*?\[router,\s*showToast\],\s*\);/,
    );
    test("buildRejectDialog is present", () => {
      expect(fnMatch).not.toBeNull();
    });
    const FN = fnMatch?.[0] ?? "";

    const NEW_REASONS = [
      "refund_policy_downgrade_with_sales",
      "refund_tier_removed_with_sales",
      "booking_deadline_earlier_with_sales",
      "bookings_closed_harms_active",
    ];
    for (const r of NEW_REASONS) {
      test(`switch handles '${r}' with "Refund first" + "Open Orders"`, () => {
        expect(FN).toContain(`case "${r}":`);
        const caseMatch = FN.match(
          new RegExp(
            `case "${r}":[\\s\\S]*?title:\\s*"Refund first"[\\s\\S]*?primaryLabel:\\s*"Open Orders"`,
          ),
        );
        expect(caseMatch).not.toBeNull();
      });
    }

    test("exhaustive switch — never-defaulted union still present", () => {
      expect(FN).toMatch(/const _exhaust:\s*never\s*=\s*result\.reason/);
    });
  });

  // ---- 5. Dead-end hint gone + accordion mounted (T-13, SC-1) ----
  describe("read-only snapshot + dead-end hint removed", () => {
    test("the 'use the wizard' dead-end hint is GONE", () => {
      expect(SCREEN).not.toMatch(/Open the wizard from the draft trip menu/);
      expect(SCREEN).not.toMatch(/managed from the trip\s*wizard/);
    });

    test("the case 'settings' renders the new accordion + wires onReject/onDirtyChange", () => {
      expect(SCREEN).toMatch(/<EditPublishedTripSettingsAccordion/);
      expect(SCREEN).toMatch(
        /onReject=\{\(r\) => setRejectDialog\(buildRejectDialog\(r\)\)\}/,
      );
      expect(SCREEN).toMatch(/onDirtyChange=\{setSettingsDirty\}/);
      expect(SCREEN).toMatch(/affectedOrderCount=\{totalConfirmedOrders\}/);
    });

    test("the dead settings styles are removed", () => {
      expect(SCREEN).not.toMatch(/settingsHint:\s*\{/);
      expect(SCREEN).not.toMatch(/settingsField:\s*\{/);
      expect(SCREEN).not.toMatch(/settingsValue:\s*\{/);
    });

    test("editedSectionKeys lights the Settings 'Edited' badge from settingsDirty", () => {
      expect(SCREEN).toMatch(/if \(settingsDirty\) out\.add\("settings"\)/);
    });
  });
});
