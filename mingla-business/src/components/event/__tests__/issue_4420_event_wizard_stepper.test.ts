/**
 * #4420 B7 (spec §3.5) — the Event wizard is wired to the clickable Stepper.
 *
 * Fails when: the wizard stops passing `onStepPress` / `furthestValidIndex`
 * (desktop list or phone chips), the reach limit stops coming from the
 * EXISTING `validateStep` (a new rule, or none), a jump can leave Invite people
 * mid-save or run during the #1780 publish re-read, or "Draft saved" returns.
 * The Stepper's own reach rule is pinned by ui/__tests__/issue_4420_stepper.
 */
import fs from "node:fs";
import path from "node:path";


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
    // [TEST-MOD-APPROVED #4420] — wave 6: the footer is the shared StepperFooter.
    expect(wizard).toContain('previousLabel={isFirstStep ? undefined : isWideDesktop ? "Back" : previousStepLabel ?? "Back"}');
    expect(wizard).not.toContain("Draft saved");
    expect(wizard).toContain('return state.lastSavedAt !== null ? "Saved" : "Not saved yet";');
  });

  it("uses the shared StepperFooter, with Back disabled during the #1780 publish re-read", () => {
    // [TEST-MOD-APPROVED #4420] — wave 6 drops the wizard's own footer.
    expect(wizard).toMatch(/<StepperFooter\s+wide=\{isWideDesktop\}/);
    expect(wizard).toMatch(/backDisabled=\{\s*isLastStep\s*\?\s*checkingInvitePublish\s*:\s*currentStep === 6 && inviteNavigation\?\.phase !== "ready"\s*\}/);
    expect(wizard).toContain('continueTestID={isLastStep ? "event-wizard-publish" : "event-wizard-continue"}');
    expect(wizard).not.toMatch(/styles\.footer\b/);
  });

  it("drops Blast from the wizard's collapsed rail", () => {
    const nav = wizard.slice(wizard.indexOf("const DESKTOP_WIZARD_NAV_ITEMS"), wizard.indexOf("] as const;"));
    expect(nav).not.toContain('label: "Blast"');
  });
});
