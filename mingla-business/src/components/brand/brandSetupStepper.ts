/**
 * #4420 B7 (spec 3.5) — brand setup on the shared clickable Stepper.
 * Pure: the steps the Stepper draws and the one step a press may reopen.
 */
import type { StepperStep } from "../ui/Stepper";
import {
  BRAND_SETUP_STEPS,
  type BrandSetupStep,
  type StripeSetupState,
} from "../../services/brandSetupCore";
import { BRAND_SETUP_COPY as C } from "./brandSetupCopy";

export const STEP_INDEX: Record<BrandSetupStep, number> = { name: 1, country: 2, pay: 3, done: 4 };

/**
 * #4420 B7 — the step a press on stepper index `index` may open, or null.
 * Only the flow's existing back path is reachable: Get paid → Bank country
 * while payments have not started (the same rule as Get paid's "Change"
 * button, `stripeState === "none"`). Forward moves stay on Continue; Name
 * is never reopened once the brand exists (Back on Bank country leaves).
 */
export function brandSetupStepperTarget(
  step: BrandSetupStep,
  stripeState: StripeSetupState | null,
  index: number,
): BrandSetupStep | null {
  if (step === "pay" && stripeState === "none" && index === STEP_INDEX.country - 1) return "country";
  return null;
}

/**
 * #4420 B7 — the four steps for the shared Stepper. A passed step the flow
 * cannot reopen is `locked` ("Saved"), so it is never a dead tap; the one
 * reopenable step stays `done` and pressable.
 */
export function brandSetupStepperSteps(
  step: BrandSetupStep,
  stripeState: StripeSetupState | null,
): StepperStep[] {
  const current = STEP_INDEX[step] - 1;
  return BRAND_SETUP_STEPS.map((s, index): StepperStep => {
    const base = { id: s, label: C.stepNames[s] };
    if (index >= current) return base;
    return brandSetupStepperTarget(step, stripeState, index) !== null
      ? { ...base, state: "done" }
      : { ...base, state: "locked", lockedReason: C.common.saved };
  });
}

