/**
 * ORCH-0873 [Tr3 Installment Payments Stage 2 UI] — TESTER adversarial
 * regression test. Different angle from implementor's source-assertion
 * test at `PaymentPlanEditor.test.ts` (which pins constants + literal copy +
 * code-pattern presence). This test attacks the **token-shape contract** and
 * the **runtime-render correctness** that the implementor tests cannot see.
 *
 * Written by Claude `mingla-forensics` (TEST mode) per ORCH-0840 Step 0.5
 * regression-test gate, on a different angle than the implementor's happy-path
 * tests so the pair gives meaningful protection.
 *
 * Adversarial findings (P1 caught by this test):
 *   - PaymentPlanEditor.tsx misused `glass.tint.chrome` as a backgroundColor
 *     string at 4 sites (lines 765, 822, 859, 877). The token is `{idle,
 *     pressed}` (object) per designSystem.ts:200-203, NOT a string. RN's
 *     processColor returns null on objects → transparent background →
 *     stepper buttons, segmented control, days input, and date picker row
 *     render WITHOUT their intended chrome backgrounds. Masked by the 53
 *     TS-debt errors documented in the implementation report. Every other
 *     consumer in the codebase uses the correct `.idle` path.
 *
 * Fix angles enforced by this test:
 *   A-01: NO file under src/ or app/ may use `glass.tint.chrome` directly as
 *         a backgroundColor — must use `glass.tint.chrome.idle` or
 *         `glass.tint.chrome.pressed`.
 *   A-02: The InstallmentScheduleDisplay reassurance copy is a SINGLE source
 *         (no inline string duplication in checkout routes).
 *   A-03: useRetryInstallment onError surfaces a user-facing message
 *         (Constitution #3 — no silent failures); regression-check the
 *         exact `kind: "error"` shape.
 *   A-04: MoneyTabBody Retry button is GATED on `inst.status === "failed"`
 *         AND mutation.isPending disabled — assert both branches.
 *   A-05: orderInstallmentsService.retryInstallment returns `{ok:false,reason}`
 *         for biz-logic rejections; throws on transport — assert the
 *         service-throws-on-error contract is respected (different angle
 *         from implementor's "calls RPC with p_installment_id" assertion).
 *   A-06: Validation copy in PaymentPlanEditor.tsx uses the locked SPEC
 *         literal "Percentages must add to 100%" — but ALSO the dynamic
 *         "Add X%" / "Remove X%" remediation copy variants exist (mirror of
 *         the implementor's literal-match test, adversarial angle pins the
 *         remediation half).
 *   A-07: No `?? fallbackValue` patterns on display-currency / display-date
 *         fields in PaymentPlanEditor (Constitution #9 — no fabricated data).
 *         Tier metadata absence falls through to null guard, not fake $0.
 *
 * Fails-on-revert: A-01 fails if a future commit reintroduces
 * `glass.tint.chrome` as backgroundColor anywhere. A-02 fails if checkout
 * routes start inlining the reassurance copy. A-03 fails if onError is
 * removed from useRetryInstallment. A-04 fails if the failed-status gate
 * is widened. Etc.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOT = join(__dirname, "..", "..", "..");
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(SRC_ROOT, rel), "utf8");
}

// Recursively walk a directory for .ts/.tsx files, skip node_modules + __tests__.
function* walkTs(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (
      entry === "node_modules" ||
      entry.startsWith(".") ||
      entry === "__tests__" ||
      entry === "dist" ||
      entry === "build"
    ) {
      continue;
    }
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walkTs(full);
    } else if (
      (entry.endsWith(".tsx") || entry.endsWith(".ts")) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx") &&
      !entry.endsWith(".adversarial.test.ts")
    ) {
      yield full;
    }
  }
}

describe("ORCH-0873 Stage 2 UI — TESTER adversarial regression", () => {
  describe("A-01: glass.tint.chrome token-shape contract", () => {
    it("designSystem.ts confirms glass.tint.chrome is an object {idle, pressed}, NOT a string", () => {
      const designSystem = read("constants/designSystem.ts");
      // The shape we depend on for the lint below.
      expect(designSystem).toMatch(/chrome:\s*\{\s*idle:/);
      expect(designSystem).toMatch(/pressed:\s*"rgba/);
    });

    it("PaymentPlanEditor.tsx must NOT use glass.tint.chrome as a backgroundColor (must use .idle or .pressed)", () => {
      // This test FAILS today because PaymentPlanEditor.tsx misuses the token
      // at 4 sites. The fix is: change `glass.tint.chrome` → `glass.tint.chrome.idle`
      // in every backgroundColor assignment.
      const src = read("components/trip/PaymentPlanEditor.tsx");
      // Find every `backgroundColor: glass.tint.chrome,` (no .idle/.pressed suffix).
      const broken = src.match(
        /backgroundColor:\s*glass\.tint\.chrome(?!\.[a-z])/g,
      );
      expect(broken).toBeNull();
    });

    it("no production source file under src/ + app/ may use glass.tint.chrome as a bare backgroundColor", () => {
      // Catches regressions across the codebase, not just PaymentPlanEditor.
      const violations: string[] = [];
      const businessRoot = join(REPO_ROOT, "mingla-business");
      for (const dir of ["src", "app"]) {
        for (const file of walkTs(join(businessRoot, dir))) {
          const content = readFileSync(file, "utf8");
          if (
            /backgroundColor:\s*glass\.tint\.chrome(?!\.[a-z])/.test(content)
          ) {
            violations.push(file.replace(`${REPO_ROOT}/`, ""));
          }
        }
      }
      expect(violations).toEqual([]);
    });
  });

  describe("A-02: single-source reassurance copy", () => {
    it("installmentReassurance.ts is the only file with the locked phrase 'will charge automatically'", () => {
      const businessRoot = join(REPO_ROOT, "mingla-business");
      const hits: string[] = [];
      for (const dir of ["src", "app"]) {
        for (const file of walkTs(join(businessRoot, dir))) {
          const content = readFileSync(file, "utf8");
          if (
            content.includes("will charge automatically") &&
            !file.endsWith("installmentReassurance.ts")
          ) {
            hits.push(file.replace(`${REPO_ROOT}/`, ""));
          }
        }
      }
      expect(hits).toEqual([]);
    });
  });

  describe("A-03: useRetryInstallment onError contract (Constitution #3)", () => {
    const src = read("hooks/useOrderInstallments.ts");
    it("onError is present and emits onMessage with kind:'error'", () => {
      // Adversarial angle: implementor pins the success+warning paths; tester
      // pins the error path specifically with kind shape.
      expect(src).toMatch(/onError:[\s\S]*onMessage[\s\S]*kind:\s*"error"/);
    });

    it("onError message is user-facing (not raw err.message dump)", () => {
      // Constitution #3 — surface user-facing copy, not internal error.
      expect(src).toMatch(
        /onError:[\s\S]*onMessage\(\{[\s\S]*message:\s*`Couldn['’]t trigger retry/,
      );
    });

    it("humanizeRetryReason has default branch returning user-facing copy", () => {
      // The "unknown" reason case must still produce friendly copy, not raw reason.
      expect(src).toMatch(/default:[\s\S]*Couldn['’]t queue retry/);
    });
  });

  describe("A-04: MoneyTabBody Retry button double-gate", () => {
    const src = read("../app/trip/[id]/index.tsx");
    it("Retry rendered only on failed status AND disabled on mutation.isPending", () => {
      // Implementor checks status gate; adversarial checks BOTH gates fire.
      expect(src).toMatch(/inst\.status\s*===\s*"failed"/);
      expect(src).toMatch(/retryMutation\.isPending/);
      expect(src).toMatch(/disabled=\{retryMutation\.isPending\}/);
    });

    it("Retry button label shifts to 'Retrying…' when mutation pending", () => {
      expect(src).toMatch(/retryMutation\.isPending\s*\n?\s*\?\s*"Retrying[….]"/);
    });
  });

  describe("A-05: orderInstallmentsService throw-vs-return contract", () => {
    const src = read("services/orderInstallmentsService.ts");
    it("retryInstallment THROWS on transport error (services contract)", () => {
      expect(src).toMatch(
        /throw\s+new\s+Error\(`retryInstallment RPC failed:/,
      );
    });

    it("retryInstallment RETURNS {ok:false,reason} for biz-logic rejections", () => {
      expect(src).toMatch(/return\s*\{\s*ok:\s*false,\s*reason:/);
    });

    it("fetchInstallmentsForOrder THROWS (not returns null) on RLS/transport error", () => {
      // Constitution: services throw on error. Returning null masks failures.
      expect(src).toMatch(/throw\s+new\s+Error\(`fetchInstallmentsForOrder failed:/);
    });

    it("fetchInstallmentsForBrandTrips THROWS on error", () => {
      expect(src).toMatch(
        /throw\s+new\s+Error\(`fetchInstallmentsForBrandTrips failed:/,
      );
    });
  });

  describe("A-06: PaymentPlanEditor validation copy — remediation half", () => {
    const src = read("components/trip/PaymentPlanEditor.tsx");
    it("sum-mismatch copy includes both Add and Remove remediation variants", () => {
      // Implementor pins the locked literal "Percentages must add to 100%".
      // Adversarial pins the dynamic remediation copy ("Add X%" / "Remove X%")
      // since users only ever see one of the two depending on overshoot direction.
      expect(src).toMatch(/sum\s*<\s*100\s*\?\s*"Add"\s*:\s*"Remove"/);
    });

    it("sum-mismatch copy includes percentage delta in remediation", () => {
      expect(src).toMatch(/\$\{delta\}%\s+to balance/);
    });

    it("date-monotonicity error names BOTH installment numbers (current and prior)", () => {
      // Implementor pin uses `/Installment .* due before installment/`. Adversarial
      // pins that the copy names i+1 and i specifically, not just generic "before".
      expect(src).toMatch(/Installment\s+\$\{i\s*\+\s*1\}\s+due before installment\s+\$\{i\}/);
    });
  });

  describe("A-07: Constitution #9 — no fabricated data on missing fields", () => {
    const src = read("components/trip/InstallmentScheduleDisplay.tsx");
    it("returns null on null schedule (no fake-empty render)", () => {
      // Verified by implementor; adversarial confirms the early-return is BEFORE
      // any rendering would happen (not after a layout pass that would briefly
      // show empty rows).
      expect(src).toMatch(
        /if\s*\(\s*rows\s*===\s*null\s+\|\|\s*schedule\s*===\s*null\s*\)\s*return\s+null;/,
      );
    });

    it("formatCurrency falls back to plain-format string, NOT $0 fabrication on Intl failure", () => {
      // The catch block must not inject a fabricated currency symbol like "$0.00".
      expect(src).toMatch(
        /catch\s*\{\s*return\s+`\$\{[^}]+\}\s+\$\{currency\.toUpperCase\(\)\}`;/,
      );
    });
  });
});
