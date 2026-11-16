/**
 * #4420 journey (new host, Host web at 1440).
 *
 * 1. The venue wizard drew the inline web stepper edge to edge on desktop, so
 *    the first ("Address") and last ("Review") labels were clipped and the
 *    step heading sat on the labels. Desktop now uses the wizard template the
 *    experience wizard uses: the clickable step list in a rail beside the
 *    form pane, sized from the desktop layout tokens. Phones keep the
 *    inline stepper.
 * 2. The experience price card stacked label, field, helper and the next
 *    label with no space between them. The card's CONTENT node now carries a
 *    space-scale gap (GlassCard `style` cannot reach children, #1532).
 *
 * FAILS ON REVERT: the venue wizard stops branching on isWideDesktop, drops
 * the list stepper / template tokens, or the price card loses its gap.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";

const read = (rel: string): string => readFileSync(join(__dirname, rel), "utf8");

describe("#4420 journey — venue wizard desktop template", () => {
  const src = read("../VenueCreatorWizard.tsx");

  test("desktop renders the step list in a rail beside the form pane", () => {
    expect(src).toMatch(/const \{ isWideDesktop \} = useResponsiveLayout\(\);/);
    expect(src).toMatch(/isWideDesktop \? \([\s\S]*?<Stepper\s+layout="list"[\s\S]*?testID="venue-wizard-stepper"/);
    expect(src).toMatch(/<View style=\{styles\.desktopFormPane\}>\{pane\}<\/View>/);
  });

  test("phones keep the inline stepper above the same pane", () => {
    const phoneBranch = src.slice(src.indexOf(") : (\n        <>"));
    expect(phoneBranch).toMatch(/<Stepper\s+steps=\{stepperSteps\}/);
    expect(phoneBranch).not.toMatch(/layout="list"/);
    expect(phoneBranch).toMatch(/\{pane\}/);
  });

  test("the template is sized from the desktop layout tokens", () => {
    expect(src).toMatch(/width: DESKTOP_WIZARD_RAIL_WIDTH/);
    expect(src).toMatch(/maxWidth: DESKTOP_WIZARD_FORM_MAX_WIDTH/);
    expect(src).toMatch(/paddingHorizontal: DESKTOP_BEZEL_MARGIN/);
  });
});

describe("#4420 journey — experience price card breathing room", () => {
  const src = read("../../experience/ExperiencePricingStep.tsx");

  test("the price option card spaces its children through contentStyle", () => {
    expect(src).toMatch(/testID=\{`experience-price-option-\$\{index\}`\}/);
    expect(src).toMatch(/contentStyle=\{styles\.optionContent\}\s*\n\s*testID=\{`experience-price-option-/);
    expect(src).toMatch(/optionContent: \{\s*gap: space\[2\],\s*\}/);
  });
});
