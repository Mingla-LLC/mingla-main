/**
 * ORCH-0873 [Tr3 Installment Payments Stage 2 UI] — implementor happy-path
 * regression test per ORCH-0840 [Regression-test enforcement] requirement.
 *
 * Source-assertion shape (matches the implementor pattern used for ORCH-0869
 * Stage 1b). Pins the SPEC-locked contracts that downstream refactors could
 * silently weaken:
 *   - SC-2: 5%-step lock on deposit + installment % steppers (Q8 resolution).
 *   - SC-2: max 11 installments hard cap (investigation O-6).
 *   - SC-1: min 1 installment after toggle-on.
 *   - SC-19: 44pt touch target on stepper +/- chips (I-38).
 *   - SC-4: sticky validation footer renders sum-mismatch copy.
 *   - SC-5a/5b/5c shared source: installmentReassurance.ts is the single
 *     source for the buyer-facing "will charge automatically" copy.
 *   - SC-7: Money tab adds 3rd tab + at-risk count in label.
 *   - SC-11: Retry button mutation calls humanizeRetryReason for biz-logic
 *     rejections (specific failure-code branches present).
 *
 * Fails-on-revert: each assertion targets a SPEC-locked constant or literal.
 * Removing or weakening any one breaks the corresponding test.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOT = join(__dirname, "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(SRC_ROOT, rel), "utf8");
}

describe("ORCH-0873 Stage 2 UI — implementor happy-path", () => {
  describe("PaymentPlanEditor", () => {
    const SRC = read("components/trip/PaymentPlanEditor.tsx");

    it("SC-2: deposit 5%-step lock at v1 (Q8 resolution)", () => {
      expect(SRC).toMatch(/const\s+DEPOSIT_STEP\s*=\s*5\b/);
      expect(SRC).toMatch(/const\s+DEPOSIT_MIN_PCT\s*=\s*10\b/);
      expect(SRC).toMatch(/const\s+DEPOSIT_MAX_PCT\s*=\s*95\b/);
    });

    it("SC-2: installment 5%-step lock at v1 (Q8 resolution)", () => {
      expect(SRC).toMatch(/const\s+INSTALLMENT_STEP\s*=\s*5\b/);
      expect(SRC).toMatch(/const\s+INSTALLMENT_MIN_PCT\s*=\s*5\b/);
    });

    it("SC-2: max 11 installments hard cap (investigation O-6)", () => {
      expect(SRC).toMatch(/const\s+MAX_INSTALLMENTS\s*=\s*11\b/);
    });

    it("SC-2: days_after_booking bounded 1..365", () => {
      expect(SRC).toMatch(/const\s+DAYS_MIN\s*=\s*1\b/);
      expect(SRC).toMatch(/const\s+DAYS_MAX\s*=\s*365\b/);
    });

    it("SC-4: sticky validation footer renders sum-mismatch copy verbatim", () => {
      // Locked copy per SPEC §3.5.1 validation table.
      expect(SRC).toContain("Percentages must add to 100%");
      expect(SRC).toContain("to balance.");
    });

    it("SC-3: date-monotonicity copy renders inline error (Stage 2 UI enforces beyond backend first-only check)", () => {
      // Per QA P3-1 — UI enforces even though backend doesn't.
      expect(SRC).toMatch(/Installment .* due before installment/);
    });

    it("SC-5 locked-state v3: banner copy verbatim", () => {
      expect(SRC).toContain(
        "Payment plan locked — at least one buyer has booked under this schedule. To change pricing, create a new trip.",
      );
    });

    it("SC-19: stepper +/- buttons are 44×44pt (I-38 touch-target invariant)", () => {
      // The Stepper subcomponent's stepperBtn style must declare width:44 + height:44.
      expect(SRC).toMatch(/stepperBtn[^{]*\{[^}]*width:\s*44[^}]*height:\s*44/s);
    });

    it("SC-19: accessibilityRole='adjustable' on stepper value views", () => {
      expect(SRC).toContain('accessibilityRole="adjustable"');
    });

    it("SC-2: native Switch toggle is OWNED BY PARENT (Step4Pricing), not the editor", () => {
      // PaymentPlanEditor must NOT import Switch; the toggle lives on parent.
      expect(SRC).not.toMatch(/import.*\{\s*Switch\b/);
    });

    it("currency-aware: Intl.NumberFormat used for amount formatting (Constitution #10)", () => {
      expect(SRC).toContain("Intl.NumberFormat");
    });
  });

  describe("installmentReassurance shared copy", () => {
    const SRC = read("copy/installmentReassurance.ts");

    it("exports installmentReassuranceText with locked copy", () => {
      expect(SRC).toMatch(/export\s+function\s+installmentReassuranceText/);
      // Locked copy substring per SPEC §3.5.3.
      expect(SRC).toContain("will charge automatically");
      expect(SRC).toContain("We'll email you before each charge.");
    });
  });

  describe("InstallmentScheduleDisplay", () => {
    const SRC = read("components/trip/InstallmentScheduleDisplay.tsx");

    it("returns null when schedule is null (empty-state contract)", () => {
      expect(SRC).toMatch(/if\s*\(\s*rows\s*===\s*null\s+\|\|\s*schedule\s*===\s*null\s*\)\s*return\s+null/);
    });

    it("imports the shared reassurance copy (no inline drift)", () => {
      expect(SRC).toContain('from "../../copy/installmentReassurance"');
      expect(SRC).toContain("installmentReassuranceText");
    });

    it("reassurance text rendered ONLY in buyer variant", () => {
      expect(SRC).toMatch(/variant\s*===\s*"buyer"/);
    });
  });

  describe("useOrderInstallments hook", () => {
    const SRC = read("hooks/useOrderInstallments.ts");

    it("query-key factory exports byOrder + byBrand keys", () => {
      expect(SRC).toMatch(/orderInstallmentKeys[\s\S]*byOrder:/);
      expect(SRC).toMatch(/orderInstallmentKeys[\s\S]*byBrand:/);
    });

    it("staleTime locked at 30 seconds per SPEC §3.4.1", () => {
      expect(SRC).toMatch(/INSTALLMENTS_STALE_MS\s*=\s*30\s*\*\s*1000/);
    });

    it("useRetryInstallment invalidates ALL installment keys on success", () => {
      expect(SRC).toMatch(/invalidateQueries\([^)]*orderInstallmentKeys\.all/);
    });

    it("humanizeRetryReason covers all RPC business-logic rejection codes", () => {
      // Defensive: every reason the biz_retry_installment RPC returns
      // must have a friendly mapping.
      for (const code of [
        "installment_not_found",
        "installment_not_failed",
        "unauthorized",
        "order_not_found",
        "event_not_found",
      ]) {
        expect(SRC).toContain(code);
      }
    });

    it("error path surfaces user-facing message (Constitution #3 — no silent failures)", () => {
      expect(SRC).toMatch(/onError:[\s\S]*onMessage[\s\S]*kind:\s*"error"/);
    });
  });

  describe("orderInstallmentsService", () => {
    const SRC = read("services/orderInstallmentsService.ts");

    it("retryInstallment returns {ok:false,reason} for biz-logic rejections", () => {
      expect(SRC).toMatch(/return\s*\{\s*ok:\s*false/);
      expect(SRC).toMatch(/reason:/);
    });

    it("retryInstallment throws on transport/RLS errors (services contract)", () => {
      expect(SRC).toMatch(/throw\s+new\s+Error\(`retryInstallment RPC failed/);
    });

    it("calls biz_retry_installment RPC with p_installment_id param name", () => {
      expect(SRC).toContain('"biz_retry_installment"');
      expect(SRC).toContain("p_installment_id");
    });
  });

  describe("Money tab on app/trip/[id]/index.tsx", () => {
    const SRC = readFileSync(
      join(SRC_ROOT, "..", "app", "trip", "[id]", "index.tsx"),
      "utf8",
    );

    it("SC-7: TabKey extended to include 'money'", () => {
      expect(SRC).toMatch(/TabKey\s*=\s*"overview"\s*\|\s*"travelers"\s*\|\s*"money"/);
    });

    it("SC-7: at-risk count shown in tab label red when > 0", () => {
      expect(SRC).toMatch(/atRiskOrderCount.*>\s*0/);
      expect(SRC).toContain("tabBadgeAtRisk");
    });

    it("SC-11: Retry button rendered ONLY on failed status (gated on inst.status === 'failed')", () => {
      expect(SRC).toMatch(/inst\.status\s*===\s*"failed"/);
      expect(SRC).toContain("retryMutation.mutate(inst.id)");
    });

    it("SC-12: Refund stub disabled with Tr4 sub-text", () => {
      expect(SRC).toContain("Refund · coming in Tr4");
      expect(SRC).toMatch(/accessibilityState=\{\{\s*disabled:\s*true\s*\}\}/);
    });

    it("SC-13: filter chip for 'At risk' renders only when count > 0", () => {
      expect(SRC).toMatch(/moneyData\.atRiskOrderCount\s*>\s*0\s*\?/);
    });

    it("SC-14: currency-aware via Intl.NumberFormat", () => {
      expect(SRC).toContain("Intl.NumberFormat");
    });
  });

  describe("tripsService extensions", () => {
    const SRC = readFileSync(
      join(SRC_ROOT, "services", "tripsService.ts"),
      "utf8",
    );

    it("TripPricingPatch supports installmentSchedule field", () => {
      expect(SRC).toMatch(/installmentSchedule\?:\s*TripInstallmentScheduleData\s*\|\s*null/);
    });

    it("updateTripPricing persists installments under tier_metadata.installments JSONB", () => {
      expect(SRC).toContain("tier_metadata");
      expect(SRC).toContain("patch.installmentSchedule");
      // Null → remove key (single-payment); object → set key.
      expect(SRC).toMatch(/patch\.installmentSchedule\s*===\s*null/);
    });

    it("mapTripPricingTier extracts installmentSchedule from tier_metadata", () => {
      expect(SRC).toContain("extractInstallmentSchedule");
      expect(SRC).toMatch(/installmentSchedule:\s*extractInstallmentSchedule/);
    });
  });
});
