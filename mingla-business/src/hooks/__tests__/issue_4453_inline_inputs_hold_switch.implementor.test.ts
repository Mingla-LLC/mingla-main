/**
 * #4453 (contract section I, rule 6) — the second audit pass. Beyond the six
 * forms, these places kept typed input that a brand switch could drop without
 * a word: small forms that sit IN the page (not in a sheet, which covers the
 * switcher), and three screens whose own save runs a moment after the last
 * change. Each now either holds the switch while it has unsaved input
 * (`useUnsavedChangesGuard`) or hands the switcher its own save to run first
 * (`unsavedWork.flushers`).
 *
 * What this file pins is the wiring in each source file: that the hold is
 * registered, and on which condition. The mechanism itself (a registered hold
 * stops the switch; a flusher is run and can hold it) is exercised for real in
 * issue_4453_workspace_brand_switch, issue_4453_trip_wizard_saves_before_switch
 * and the per-screen suites; the Website address form is rendered in
 * issue_4453_address_holds_switch.
 *
 * FAILS-ON-REVERT: remove any one of these registrations and its case fails.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/hooks/__tests__/issue_4453_inline_inputs_hold_switch.implementor.test.ts
 */
import { describe, expect, test } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.join(__dirname, "../../..");
const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), "utf8");
/** The guard call in a file whose `dirty:` expression contains `needle`, squeezed to one line. */
const holdOn = (file: string, needle: string): string | null => {
  const src = read(file);
  for (const match of src.matchAll(/useUnsavedChangesGuard\(\{([\s\S]*?)\}\);/g)) {
    const body = match[1].replace(/\s+/g, " ").trim();
    if (body.includes(needle)) return body;
  }
  return null;
};

describe("#4453 small forms in the page hold a brand switch while they hold unsaved input", () => {
  test.each([
    // [what, file, the condition it holds on]
    ["Website: a domain typed and not yet added", "src/components/sites/website/sections/AddressesSection.tsx", 'dirty: domain.trim() !== ""'],
    ["Website: an answer for Ari's draft page not yet saved", "src/components/sites/website/sections/PagesSection.tsx", 'dirty: !readOnly && Object.values(answers).some((text) => text.trim() !== "")'],
    ["Creator contract: a settlement note written on the page", "src/components/creators/screens/HostGigContractScreen.tsx", 'dirty: sheet === null && state === "disputed" && note.trim() !== ""'],
    ["Bank form: an account number not yet connected", "src/components/brand/BrandPaystackOnboardView.tsx", 'dirty: showBankForm && accountNumber.trim() !== "" && accountNumber !== connectedNumber'],
    ["Venue tables: a deposit party size or amount not yet saved", "src/components/venue/VenueCapacityRulesPanel.tsx", "amountDraft !== savedAmountText"],
    ["Venue settings: the details or contact form, changed", "src/components/venue/VenueDetailsEditor.tsx", "dirty: canMutate && (identityChanged || contactChanged)"],
    ["Sale settings changed and not saved", "src/components/discounts/ItemDiscountControls.tsx", "dirty: touched"],
    ["Stay: an unsaved Room or Place (in the page on a wide screen)", "src/components/stay/StayInventoryManager.tsx", "dirty: editor !== null && editorDirty"],
    ["Stay availability: a price or open-rooms number typed and not yet saved", "src/components/stay/StayInventoryManager.tsx", "dirty: overridePrice.trim() !== savedPrice.trim() || quantity.trim() !== savedQuantity.trim()"],
    ["Website: a request typed for Ari on a section", "src/components/sites/website/workspace/SectionAriCard.tsx", 'dirty: text.trim() !== ""'],
    ["Website: words typed for Ari in its panel", "src/components/sites/website/workspace/AriPanel.tsx", 'dirty: draftText.trim() !== ""'],
    ["Website: a request for the Mingla team, written or changed", "src/components/sites/website/workspace/TeamRequestCard.tsx", "dirty: what.trim() !== draft.what.trim()"],
    ["Sale access: a username typed and not yet added", "src/components/event/EventTicketCheckoutAccessCard.tsx", 'dirty: username.trim() !== ""'],
  ])("%s", (_what, file, condition) => {
    const hold = holdOn(file, condition);
    expect(hold).not.toBeNull();
    // Each keeps its own way out: Android back is not taken over.
    expect(hold).toContain("hardwareBack: false");
    expect(read(file)).toMatch(/import \{ useUnsavedChangesGuard \} from "(\.\.\/)+hooks\/useUnsavedChangesGuard";/);
  });

  test("the conditions clear when the input is saved or sent, so nothing stays held after a save", () => {
    // Domain: cleared when it was added.
    expect(read("src/components/sites/website/sections/AddressesSection.tsx")).toMatch(/onSuccess: \(result\) => \{\s*setDomain\(""\);/);
    // Ari answer: cleared for that question when it saved.
    expect(read("src/components/sites/website/sections/PagesSection.tsx")).toContain('setAnswers((current) => ({ ...current, [key]: "" }));');
    // Bank form: the number that connected is remembered as saved.
    expect(read("src/components/brand/BrandPaystackOnboardView.tsx")).toMatch(/await submitMutation\.mutateAsync\(input\);\s*setConnectedNumber\(accountNumber\);/);
    // Deposit: the typed party size is dropped once saved; the amount is compared with the saved amount.
    expect(read("src/components/venue/VenueCapacityRulesPanel.tsx")).toMatch(/onSuccess: \(\) => \{\s*setDepositPendingOn\(false\);\s*setDepositDraft\(""\);/);
    // Sale settings: untouched again when they are read back, and when a save lands.
    const sale = read("src/components/discounts/ItemDiscountControls.tsx");
    expect(sale).toMatch(/useEffect\(\(\) => \{\s*setTouched\(false\);\s*if \(priceRow !== undefined\)/);
    expect(sale).toMatch(/setSaved\(true\);\s*setTouched\(false\);/);
    // Every sale control the host can change marks it touched.
    for (const setter of ["setSaleOn", "setSalePrice", "setEndsAt", "setEndsAfterCount", "setScheduleOn", "setScheduleFrom", "setScheduleTo"]) {
      expect(sale).toContain(`touch(${setter})`);
    }
    expect(sale).toContain("touch(setLimitMode)(value)");
    expect(sale).toMatch(/onPress=\{\(\) => \{\s*setTouched\(true\);\s*setScheduleDays\(/);
    // Stay availability: the saved price is the one the save sent.
    expect(read("src/components/stay/StayInventoryManager.tsx")).toMatch(/onSuccess: \(\{ inventory \}\) => \{\s*setSavedPrice\(overridePrice\);\s*setSavedQuantity\(quantity\);/);
    // Ari's panel clears the box when the request was taken; the access card when the account was added.
    expect(read("src/components/sites/website/workspace/AriPanel.tsx")).toContain('if (!refused) onDraftText("");');
    expect(read("src/components/event/EventTicketCheckoutAccessCard.tsx")).toMatch(/onSuccess: \(\) => \{\s*setUsername\(""\);/);
    // Venue details: closing either form ends its changed-state (mode goes back to "view").
    const details = read("src/components/venue/VenueDetailsEditor.tsx");
    expect(details).toMatch(/const identityChanged =\s*mode === "identity" &&/);
    expect(details).toMatch(/const contactChanged =\s*mode === "contact" &&/);
  });
});

describe("#4453 screens that save a moment after the last change save before a brand switch", () => {
  const REGISTERS = /useEffect\(\(\) => \{\s*const flush = \(\): Promise<boolean> => brandSwitchFlushRef\.current\(\);\s*const flushers = \(unsavedWork\.flushers \?\?= new Set\(\)\);\s*flushers\.add\(flush\);\s*return \(\): void => \{\s*flushers\.delete\(flush\);\s*\};\s*\}, \[\]\);/;

  test("the message composer: what is typed is saved now; held if it could not be", () => {
    const src = read("app/(tabs)/marketing/campaigns/compose.tsx");
    expect(src).toMatch(REGISTERS);
    expect(src).toMatch(/brandSwitchFlushRef\.current = async \(\): Promise<boolean> =>\s*!isDirty \|\| \(await flushDraft\(\)\) !== null;/);
  });

  test("the ad builder: the draft is saved through its one chain; held if that save did not land", () => {
    const src = read("src/screens/hostAds/HostAdCreateScreen.tsx");
    expect(src).toMatch(REGISTERS);
    expect(src).toMatch(/brandSwitchFlushRef\.current = async \(\): Promise<boolean> => \{\s*if \(draftSaveStatus === "saved" \|\| draftSaveStatus === "loading"\) return true;\s*await persistDraft\(\);\s*return draftSaveLandedRef\.current;\s*\};/);
    // The save itself says whether it landed.
    expect(src).toMatch(/draftRevisionRef\.current = draft\.revision;\s*draftSaveLandedRef\.current = true;/);
    expect(src).toMatch(/\} catch \(cause\) \{\s*draftSaveLandedRef\.current = false;/);
  });

  test("the Website design panel: a pick not yet sent is sent; a save on the wire is waited for", () => {
    const src = read("src/components/sites/website/workspace/DesignPanel.tsx");
    expect(src).toMatch(REGISTERS);
    expect(src).toMatch(/brandSwitchFlushRef\.current = async \(\): Promise<boolean> => \{\s*await inFlight\.current;\s*const \{ draft: want, storedLook: have \} = latest\.current;\s*if \(!want \|\| !have \|\| same\(want, have\)\) return true;\s*inFlight\.current = save\(\);\s*await inFlight\.current;\s*return lastSaveLanded\.current;\s*\};/);
    // The timed save is the same one, so a switch can wait for it.
    expect(src).toContain("const timer = setTimeout(() => { inFlight.current = save(); }, AUTOSAVE_IDLE_MS);");
    expect(src).toMatch(/\} catch \(error\) \{\s*lastSaveLanded\.current = false;/);
  });
});
