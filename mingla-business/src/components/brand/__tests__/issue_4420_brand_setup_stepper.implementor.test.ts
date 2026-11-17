/**
 * #4420 B7 (spec 3.5) — BrandCreationFlow (the 4-step brand setup) uses the
 * shared clickable Stepper instead of its own 220 rail: desktop = the 280
 * step list, phone = segments + chips + the Steps sheet. Only the flow's
 * existing back path is reachable (Get paid → Bank country while payments
 * have not started, the "Change" rule); passed steps it cannot reopen are
 * locked "Saved", never dead taps. Forward stays on Continue (server writes).
 *
 * FAILS-ON-REVERT: the old rail, a new reachability rule, or a forward jump
 * fails this suite.
 */
import { describe, expect, jest, test } from "@jest/globals";

// The pure Stepper helpers only; its UI imports are never rendered here.
jest.mock("react-native-reanimated", () => ({ __esModule: true, default: {} }));
jest.mock("../../ui/Button", () => ({ Button: () => null }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Sheet", () => ({ Sheet: () => null }));
import fs from "fs";
import path from "path";

import { isStepReachable, resolveStepState } from "../../ui/Stepper";
import { brandSetupStepperSteps, brandSetupStepperTarget } from "../brandSetupStepper";

const reachable = (steps: ReturnType<typeof brandSetupStepperSteps>, current: number): number[] =>
  steps.flatMap((s, i) => (isStepReachable(s, i, current, current) && i !== current ? [i] : []));

describe("#4420 brand setup stepper", () => {
  test("Get paid with payments not started: Bank country reopens, Name is saved", () => {
    const steps = brandSetupStepperSteps("pay", "none");
    expect(steps.map((s) => resolveStepState(s, steps.indexOf(s), 2))).toEqual(["locked", "done", "current", "todo"]);
    expect(steps[0].lockedReason).toBe("Saved");
    expect(reachable(steps, 2)).toEqual([1]);
    expect(brandSetupStepperTarget("pay", "none", 1)).toBe("country");
  });

  test("payments started: Bank country is locked like the Change button", () => {
    for (const state of ["started", "submitted", "action_needed"] as const) {
      const steps = brandSetupStepperSteps("pay", state);
      expect(reachable(steps, 2)).toEqual([]);
      expect(brandSetupStepperTarget("pay", state, 1)).toBeNull();
    }
  });

  test("no forward jumps and nothing reopens from Name, Bank country or Done", () => {
    for (const [step, idx] of [["name", 0], ["country", 1], ["done", 3]] as const) {
      const steps = brandSetupStepperSteps(step, "none");
      expect(reachable(steps, idx)).toEqual([]);
      for (let i = 0; i < 4; i += 1) expect(brandSetupStepperTarget(step, "none", i)).toBeNull();
    }
    expect(brandSetupStepperTarget("pay", "none", 3)).toBeNull();
  });

  test("the flow renders the shared Stepper (list on desktop, chips on phone), not the old rail", () => {
    const flow = fs.readFileSync(path.resolve(__dirname, "../BrandCreationFlow.tsx"), "utf8");
    expect(flow).toMatch(/<Stepper[\s\S]{0,400}layout=\{isWideDesktop \? "list" : "chips"\}/);
    expect(flow).toContain('setBackTo("country")');
    expect(flow).not.toMatch(/railDot|width: 220/);
    expect(flow).toContain("rail: { width: 280");
  });
});
