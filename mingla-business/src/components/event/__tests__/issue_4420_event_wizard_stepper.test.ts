/**
 * #4420 B7 (spec §3.5) — the Event wizard is wired to the clickable Stepper.
 *
 * Fails when: the wizard stops passing `onStepPress` / `furthestValidIndex`
 * (desktop list or phone chips), the reach limit stops coming from the
 * EXISTING `validateStep` (a new rule, or none), a jump can leave Invite people
 * mid-save or run during the #1780 publish re-read, or "Draft saved" returns.
 */
import fs from "node:fs";
import path from "node:path";

import { isStepReachable } from "../../ui/Stepper";

const wizard = fs.readFileSync(path.join(__dirname, "../EventCreatorWizard.tsx"), "utf8");

describe("#4420 B7 — Event wizard clickable stepper", () => {
  it("renders the 280 step list on desktop and the chips + Steps sheet on phone, both pressable", () => {
    expect(wizard).toMatch(/<Stepper\s+layout="list"[\s\S]{0,260}furthestValidIndex=\{furthestValidOrdinal\}\s+onStepPress=\{handleStepPress\}/);
    expect(wizard).toMatch(/<Stepper\s+layout="chips"[\s\S]{0,260}furthestValidIndex=\{furthestValidOrdinal\}\s+onStepPress=\{handleStepPress\}/);
  });

  it("limits reach with the existing per-step validator, adding no rule", () => {
    expect(wizard).toMatch(
      /const furthestValidOrdinal = useMemo\(\(\): number => \{\s*const firstInvalid = visibleStepDefs\.findIndex\(\s*\(\{ index \}\) => validateStep\(index, liveDraft\)\.length > 0,/,
    );
  });

  it("guards a jump like the dock Back: not mid invite save, not during the publish re-read", () => {
    const handler = wizard.slice(wizard.indexOf("const handleStepPress"), wizard.indexOf("// ---- Publish gate ----"));
    expect(handler).toContain('if (currentStep === 6 && inviteNavigation?.phase !== "ready") return;');
    expect(handler).toContain("if (checkingInvitePublish || isPublishing) return;");
    expect(handler).toContain("setShowStepErrors(false);");
  });

  it("shows the current step's first error on the stepper once errors are revealed", () => {
    expect(wizard).toMatch(/index === currentStep && showStepErrors \? stepErrors\[0\]\?\.message : undefined/);
    expect(wizard).toContain('state: "error" as const, firstError');
  });

  it("names Back after the previous step on phone and says Saved, never Draft saved", () => {
    expect(wizard).toContain('label={isWideDesktop ? "Back" : previousStepLabel ?? "Back"}');
    expect(wizard).not.toContain("Draft saved");
    expect(wizard).toContain('return state.lastSavedAt !== null ? "Saved" : "Not saved yet";');
  });

  it("drops Blast from the wizard's collapsed rail", () => {
    const nav = wizard.slice(wizard.indexOf("const DESKTOP_WIZARD_NAV_ITEMS"), wizard.indexOf("] as const;"));
    expect(nav).not.toContain('label: "Blast"');
  });

  it("the Stepper refuses a step past the furthest valid one and a locked step", () => {
    const step = { id: "s", label: "S" };
    expect(isStepReachable(step, 2, 0, 2)).toBe(true);
    expect(isStepReachable(step, 3, 0, 2)).toBe(false);
    expect(isStepReachable({ ...step, state: "locked" }, 1, 0, 2)).toBe(false);
  });
});
