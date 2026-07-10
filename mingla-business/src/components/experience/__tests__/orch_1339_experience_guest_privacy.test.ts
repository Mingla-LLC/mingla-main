/**
 * ORCH-1339 [momentum-card-cross-entity] — experience-side guest-privacy
 * regression (implementor-owned; SPEC §7 T-8-source / T-12-source, §9
 * business-side safeguard). SOURCE-STRUCTURAL under the default node/ts-jest
 * config (RTL render harnesses exist only under dedicated per-ORCH configs —
 * see jest.config.cjs; the runtime/sim half of T-8 is the tester's).
 *
 * Pins: (1) the D5 Guest-privacy accordion on the Pricing step (single home
 * for create AND edit) + §4.8 byte-exact copy; (2) wizard persistence via the
 * setEventGuestPrivacy LEAF-WRITE RPC on publish/save AND live-edit save;
 * (3) edit-mode hydration (the wizard's owner-scoped events.theme read);
 * (4) the When-adapter threads the wizard state instead of hard-coded false;
 * (5) the experiences list mapper surfaces the two flags.
 *
 * FAILS-ON-REVERT: deleting the accordion rows, either setEventGuestPrivacy
 * call, the hydration effect, or re-hard-coding the adapter literals makes a
 * named assertion FAIL.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string): string =>
  readFileSync(path.resolve(__dirname, rel), "utf8");

const pricingStep = read("../ExperiencePricingStep.tsx");
const wizard = read("../ExperienceCreatorWizard.tsx");
const adapter = read("../../../hooks/useExperienceDraftAdapter.ts");
const experiencesService = read("../../../services/experiencesService.ts");

describe("ORCH-1339 (D5) — ExperiencePricingStep Guest-privacy accordion", () => {
  test("props extend with the two controlled value+callback pairs", () => {
    expect(pricingStep).toContain("privateGuestList: boolean;");
    expect(pricingStep).toContain("setPrivateGuestList: (v: boolean) => void;");
    expect(pricingStep).toContain("hideRemainingCount: boolean;");
    expect(pricingStep).toContain("setHideRemainingCount: (v: boolean) => void;");
  });

  test("the accordion section renders BOTH rows via the file's OWN ToggleRow, after the pricing sections", () => {
    expect(pricingStep).toContain(">GUEST PRIVACY</Text>");
    expect(pricingStep).toContain('testID="experience-pricing-private-guestlist"');
    expect(pricingStep).toContain('testID="experience-pricing-hide-count"');
    // Appended AFTER WhoCoversCostsSection (the last pricing section).
    const who = pricingStep.indexOf("<WhoCoversCostsSection");
    const privacy = pricingStep.indexOf("GUEST PRIVACY");
    expect(who).toBeGreaterThan(-1);
    expect(privacy).toBeGreaterThan(who);
  });

  test("SPEC §4.8 byte-exact copy — experience accordion rows", () => {
    expect(pricingStep).toContain('label="Private guest list"');
    expect(pricingStep).toContain(
      'sub="Hide who\'s booked. Guests still see the booked count."',
    );
    expect(pricingStep).toContain('label="Hide remaining count"');
    expect(pricingStep).toContain(
      "sub={'Don\\'t show \"X spots left\" or how full it is.'}",
    );
  });
});

describe("ORCH-1339 — ExperienceCreatorWizard persistence + hydration", () => {
  test("wizard owns the guest-privacy state and threads it into the Pricing step + the When-adapter", () => {
    expect(wizard).toContain("useState<ExperienceGuestPrivacyState>");
    expect(wizard).toContain("privateGuestList={guestPrivacy.privateGuestList}");
    expect(wizard).toContain("hideRemainingCount={guestPrivacy.hideRemainingCount}");
    // Third adapter arg (replaces the old hard-coded false pair).
    expect(wizard).toMatch(
      /useExperienceDraftAdapter\(\s*brandId,\s*initialDraft\?\.when,\s*guestPrivacy,\s*\)/,
    );
  });

  test("edit-mode hydration — ONE owner-scoped events.theme read seeds the toggles", () => {
    expect(wizard).toContain('.from("events")');
    expect(wizard).toContain('.select("theme")');
    expect(wizard).toContain(".eq(\"id\", existingExperienceId)");
    expect(wizard).toContain("s.privateGuestList === true");
    expect(wizard).toContain("s.hideRemainingCount === true");
  });

  test("persists via setEventGuestPrivacy on publish/draft-save AND on live-edit save (never inside the big RPCs' payloads)", () => {
    expect(wizard).toContain(
      'import { setEventGuestPrivacy } from "../../services/businessEvents"',
    );
    const calls = wizard.match(/setEventGuestPrivacy\(savedId, \{/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2); // handleSubmit + handleLiveSave
    // NON-BLOCKING contract: failure → toast, flow continues.
    expect(wizard).toContain(
      "Couldn't save guest privacy — check Settings after publishing.",
    );
    // The two keys never ride the big-RPC payloads (COMMS-0029 class).
    const buildPayload = wizard.slice(
      wizard.indexOf("buildPayload"),
      wizard.indexOf("const handleSubmit"),
    );
    expect(buildPayload).not.toContain("privateGuestList");
    expect(buildPayload).not.toContain("hideRemainingCount");
  });
});

describe("ORCH-1339 — adapter + mapper hydration", () => {
  test("useExperienceDraftAdapter threads guestPrivacy instead of hard-coded false", () => {
    expect(adapter).toContain("export interface ExperienceGuestPrivacyState");
    // Scope the hard-coded-false ban to the synthDraft BODY (the defaults
    // object above it legitimately carries false for create mode).
    const synthBody = adapter.slice(
      adapter.indexOf("function synthDraft("),
      adapter.indexOf("export interface UseExperienceDraftAdapterResult"),
    );
    expect(synthBody).toContain("hideRemainingCount: guestPrivacy.hideRemainingCount");
    expect(synthBody).toContain("privateGuestList: guestPrivacy.privateGuestList");
    expect(synthBody).not.toContain("hideRemainingCount: false");
    expect(synthBody).not.toContain("privateGuestList: false");
    // Create-mode defaults stay false via the defaults object.
    expect(adapter).toContain("GUEST_PRIVACY_DEFAULTS");
  });

  test("experiencesService surfaces guestPrivacy from theme.business_event.settings (false defaults)", () => {
    expect(experiencesService).toContain("guestPrivacy?: {");
    expect(experiencesService).toContain("function readExperienceGuestPrivacy(");
    expect(experiencesService).toContain("s.privateGuestList === true");
    expect(experiencesService).toContain("s.hideRemainingCount === true");
    expect(experiencesService).toContain(
      "guestPrivacy: readExperienceGuestPrivacy(row.theme)",
    );
  });
});
