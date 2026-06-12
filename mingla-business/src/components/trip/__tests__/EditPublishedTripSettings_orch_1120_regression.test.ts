/**
 * ORCH-1120 [Published-trip Settings tab → editable refund tiers + booking
 * deadline + bookings-closed (sales-gated)] — implementor happy-path
 * regression test (per ORCH-0840 regression-test enforcement + append-only CI).
 *
 * REWORK (2026-06-12, Seth device feedback): the Settings accordion was showing
 * its OWN "Save changes" button + its OWN reason dialog — a duplicate save path
 * on top of the screen's standard bottom button. The accordion is now a PURE
 * CONTROLLED EDITOR; the single standard bottom Save button owns the save,
 * reason prompt, gate, and reject path. This test now pins the CONSOLIDATED
 * single-save contract.
 *
 * Pins the load-bearing contracts of ORCH-1120 (post-REWORK):
 *   1. The accordion is a CONTROLLED editor — NO internal Save button, NO
 *      reason dialog, NO mutation, NO onReject prop. Its three values are
 *      lifted via controlled props (value + onChange). (REWORK SC.)
 *   2. The PARENT screen folds refund_policy / booking_deadline /
 *      bookings_closed into its LocalTripEditState → buildLiveTripPatch diff →
 *      the single biz_update_live_trip RPC (useUpdateLiveTripFields), NEVER the
 *      sales-unaware refundPolicyService writers. (SC-3, §6 audit invariant.)
 *   3. The diff/severity path treats the three fields as MATERIAL. (SPEC §6.)
 *   4. The parent's buildRejectDialog exhaustively handles the 4 refund-class
 *      reject reasons with the "Refund first" copy + "Open Orders" CTA, and the
 *      read-only Settings snapshot + dead-end "use the wizard" hint are GONE.
 *      (SC-4, SC-7, T-13.)
 *
 * fails-on-revert: deleting the parent's settings diff (patch.refund_policy /
 * booking_deadline / bookings_closed), the MATERIAL_KEYS settings entries, any
 * of the 4 buildRejectDialog cases, or re-introducing an internal accordion
 * save button makes a matching assertion fail.
 *
 * The tester layers the adversarial different-angle suite (live SQL gate drive,
 * device dead-tap proof, Android opaque-glass) per SPEC §13.
 *
 * Spec: SPEC_ORCH-1120_TRIP_SETTINGS_REFUND_DEADLINE.md §8, §9 + REWORK note.
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
  const ADAPTER = read("utils/tripAdapter.ts");

  // ---- 1. Accordion is a PURE CONTROLLED EDITOR (REWORK) ----
  describe("accordion is a controlled editor with NO internal save path", () => {
    const code = stripComments(ACCORDION);

    test("accordion has NO internal Save button (single bottom button only)", () => {
      // No "Save changes" label inside the accordion at all.
      expect(ACCORDION).not.toMatch(/label="Save changes"/);
      // No save-button testIDs.
      expect(ACCORDION).not.toMatch(/settings-accordion-save/);
      expect(ACCORDION).not.toMatch(/settings-accordion-reason-confirm/);
    });

    test("accordion has NO reason dialog / banner of its own", () => {
      expect(code).not.toMatch(/reasonDialogVisible/);
      expect(code).not.toMatch(/onConfirmSave/);
      expect(code).not.toMatch(/onSavePressed/);
      expect(ACCORDION).not.toMatch(/Save settings changes\?/);
    });

    test("accordion does NOT own the mutation or onReject prop", () => {
      expect(code).not.toMatch(/useUpdateLiveTripFields/);
      expect(code).not.toMatch(/\.mutateAsync/);
      expect(code).not.toMatch(/onReject/);
    });

    test("accordion exposes controlled value + onChange props", () => {
      expect(ACCORDION).toMatch(/onRefundPolicyChange/);
      expect(ACCORDION).toMatch(/onBookingDeadlineChange/);
      expect(ACCORDION).toMatch(/onBookingsClosedChange/);
    });

    test("editors stay mounted + wired to the controlled props", () => {
      expect(ACCORDION).toMatch(
        /<RefundPolicyEditor[\s\S]*?value=\{refundPolicy\}[\s\S]*?onChange=\{onRefundPolicyChange\}/,
      );
      expect(ACCORDION).toMatch(/<BookingDeadlinePicker/);
      expect(ACCORDION).toMatch(/onValueChange=\{onBookingsClosedChange\}/);
      expect(ACCORDION).toMatch(/accessibilityRole="switch"/);
    });

    test("never calls the sales-unaware refundPolicyService writers", () => {
      expect(code).not.toMatch(/updateRefundPolicy/);
      expect(code).not.toMatch(/updateBookingDeadline/);
    });
  });

  // ---- 2. Parent owns the single save path (SC-3) ----
  describe("parent screen saves the 3 settings fields through the single RPC", () => {
    const code = stripComments(SCREEN);

    test("buildLiveTripPatch diffs the three settings fields into the patch", () => {
      expect(code).toMatch(/patch\.refund_policy = state\.refundPolicy/);
      expect(code).toMatch(/patch\.booking_deadline = state\.bookingDeadline/);
      expect(code).toMatch(/patch\.bookings_closed = state\.bookingsClosed/);
    });

    test("LocalTripEditState seeds the three settings fields from the trip", () => {
      expect(code).toMatch(/refundPolicy: trip\.refundPolicy/);
      expect(code).toMatch(/bookingDeadline: trip\.bookingDeadline/);
      expect(code).toMatch(/bookingsClosed: trip\.bookingsClosed/);
    });

    test("the single bottom Save button drives handleSavePress", () => {
      expect(SCREEN).toMatch(/testID="edit-trip-save"/);
      expect(SCREEN).toMatch(/onPress=\{handleSavePress\}/);
    });

    test("the parent saves through the gated mutation, never refundPolicyService", () => {
      expect(SCREEN).toMatch(/useUpdateLiveTripFields\(\)/);
      expect(SCREEN).toMatch(/updateLiveTripMutation\.mutateAsync/);
      expect(code).not.toMatch(/updateRefundPolicy/);
      expect(code).not.toMatch(/updateBookingDeadline/);
    });

    test("editedSectionKeys lights the Settings badge from the patch diff", () => {
      expect(code).toMatch(/p\.refund_policy !== undefined/);
      expect(code).toMatch(/out\.add\("settings"\)/);
      // The old accordion-owned dirtiness lift is gone.
      expect(code).not.toMatch(/settingsDirty/);
    });
  });

  // ---- 3. Diff + severity treat settings fields as MATERIAL (SPEC §6) ----
  describe("settings fields are MATERIAL in the diff/severity path", () => {
    test("MATERIAL_KEYS includes the three settings keys", () => {
      const block = ADAPTER.match(
        /MATERIAL_KEYS:[\s\S]*?\];/,
      );
      expect(block).not.toBeNull();
      const FN = block?.[0] ?? "";
      expect(FN).toContain('"refund_policy"');
      expect(FN).toContain('"booking_deadline"');
      expect(FN).toContain('"bookings_closed"');
    });

    test("computeRichTripFieldDiffs emits MATERIAL diffs for the three fields", () => {
      expect(ADAPTER).toMatch(
        /fieldKey: "refund_policy"[\s\S]*?severity: "material"/,
      );
      expect(ADAPTER).toMatch(
        /fieldKey: "booking_deadline"[\s\S]*?severity: "material"/,
      );
      expect(ADAPTER).toMatch(
        /fieldKey: "bookings_closed"[\s\S]*?severity: "material"/,
      );
    });
  });

  // ---- 4. Service union extension ----
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

  // ---- 5. Parent reject dialog (single reject path — SC-4, SC-7) ----
  describe("buildRejectDialog exhaustively handles the 4 refund-class reasons", () => {
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

  // ---- 6. Dead-end hint gone + accordion mounted controlled (T-13, SC-1) ----
  describe("read-only snapshot + dead-end hint removed", () => {
    test("the 'use the wizard' dead-end hint is GONE", () => {
      expect(SCREEN).not.toMatch(/Open the wizard from the draft trip menu/);
      expect(SCREEN).not.toMatch(/managed from the trip\s*wizard/);
    });

    test("the case 'settings' renders the controlled accordion", () => {
      expect(SCREEN).toMatch(/<EditPublishedTripSettingsAccordion/);
      expect(SCREEN).toMatch(/onRefundPolicyChange=\{handleRefundPolicyChange\}/);
      expect(SCREEN).toMatch(
        /onBookingDeadlineChange=\{handleBookingDeadlineChange\}/,
      );
      expect(SCREEN).toMatch(
        /onBookingsClosedChange=\{handleBookingsClosedChange\}/,
      );
      expect(SCREEN).toMatch(/affectedOrderCount=\{totalConfirmedOrders\}/);
      // No more onDirtyChange / onReject wiring on the accordion (single path).
      expect(SCREEN).not.toMatch(/onDirtyChange=\{setSettingsDirty\}/);
    });

    test("the dead settings styles are removed", () => {
      expect(SCREEN).not.toMatch(/settingsHint:\s*\{/);
      expect(SCREEN).not.toMatch(/settingsField:\s*\{/);
      expect(SCREEN).not.toMatch(/settingsValue:\s*\{/);
    });
  });
});
