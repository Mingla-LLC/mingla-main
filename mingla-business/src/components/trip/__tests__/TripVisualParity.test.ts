/**
 * ORCH-0874 [Trip surfaces visual parity with Events] — IMPLEMENTOR
 * source-assertion regression test per ORCH-0840 [Regression-test enforcement
 * + append-only CI] Step 0.5 happy-path requirement.
 *
 * Pins SPEC-locked contracts across all 4 surfaces (trips list, trip detail
 * dashboard, trip creator wizard chrome, public trip page) so downstream
 * refactors can't silently weaken them. Mirrors the
 * PaymentPlanEditor.test.ts implementor-test shape from ORCH-0873.
 *
 * Spec: Mingla_Artifacts/specs/SPEC_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOT = join(__dirname, "..", "..", "..");
const APP_ROOT = join(__dirname, "..", "..", "..", "..", "app");

function read(rel: string): string {
  return readFileSync(join(SRC_ROOT, rel), "utf8");
}
function readApp(rel: string): string {
  return readFileSync(join(APP_ROOT, rel), "utf8");
}

describe("ORCH-0874 Trip surfaces visual parity with Events — implementor", () => {
  // ============================================================
  // TripCreatorWizard chrome (SC-01..SC-09 + SC-19/20)
  // ============================================================
  describe("TripCreatorWizard chrome rewrite", () => {
    const SRC = read("components/trip/TripCreatorWizard.tsx");

    it("SC-01: IconChrome icon='close' size=36 rendered in chrome row (close X always)", () => {
      expect(SRC).toMatch(/<IconChrome[^>]*icon="close"[^>]*size=\{?36/);
      expect(SRC).toMatch(/accessibilityLabel="Close wizard"/);
    });

    it("SC-02/03/04: handleClose branches on isCreateMode + isTripWizardPristine", () => {
      expect(SRC).toMatch(/isCreateMode/);
      expect(SRC).toMatch(/isTripWizardPristine/);
      expect(SRC).toContain('"Discard this trip?"');
      expect(SRC).toContain('"You\'ll lose your changes."');
    });

    it("SC-05: Stepper primitive with named pill chips (replaces 4pt anonymous segments)", () => {
      expect(SRC).toMatch(/<Stepper[^>]*steps=\{?STEPPER_STEPS/);
      expect(SRC).toMatch(/STEPPER_STEPS:\s*StepperStep\[\]/);
      // No more anonymous progress segments
      expect(SRC).not.toMatch(/progressSegment/);
    });

    it("SC-06: body renders eyebrow + 26pt step title + 14pt subtitle (above step content)", () => {
      expect(SRC).toMatch(/STEP_SUBTITLES/);
      // JSX expression: STEP {step} OF {STEP_COUNT}
      expect(SRC).toMatch(/STEP \{step\} OF \{STEP_COUNT\}/);
      // eyebrow style — 11pt accent.warm uppercase
      expect(SRC).toMatch(/eyebrow:[^}]*fontSize:\s*11[^}]*color:\s*accent\.warm/s);
      // stepTitle — 26pt fontWeight 700
      expect(SRC).toMatch(/stepTitle:[^}]*fontSize:\s*26[^}]*fontWeight:\s*"700"/s);
    });

    it("SC-07: dock uses GlassCard variant='elevated' radius='xxl' floating; hides when keyboard up", () => {
      expect(SRC).toMatch(/<GlassCard[^>]*variant="elevated"[^>]*radius="xxl"/);
      expect(SRC).toMatch(/keyboardVisible\s*\?\s*null\s*:/);
    });

    it("SC-08: subtitle row shows brand name + Step N of 5 + autosave-state text", () => {
      expect(SRC).toMatch(/\{brand\.name\}\s*·\s*Step\s+\{step\}\s+of\s+\{STEP_COUNT\}/);
      expect(SRC).toContain("autosaveStateText");
      expect(SRC).toContain('"Saving…"');
      expect(SRC).toContain('"Saved"');
      expect(SRC).toContain('"Unsaved changes — retrying"');
    });

    it("SC-09: Publish ConfirmDialog with 'Publish trip?' title before mutation", () => {
      expect(SRC).toContain('"Publish trip?"');
      expect(SRC).toMatch(/publishConfirmVisible/);
      expect(SRC).toMatch(/handlePublishTap[\s\S]*setPublishConfirmVisible\(true\)/);
    });

    it("SC-19: IconChrome close uses size=36 (44pt effective via internal hitSlop)", () => {
      // IconChrome at 36pt with internal hitSlop reaches 44pt I-38 compliance.
      expect(SRC).toMatch(/<IconChrome[^>]*size=\{?36/);
    });

    it("SC-20: accessibilityLabel on every interactive element", () => {
      expect(SRC).toMatch(/accessibilityLabel="Close wizard"/);
    });

    it("keyboard listener pattern replaces KeyboardAvoidingView", () => {
      // ORCH-0874 §3.3.5 — replace KeyboardAvoidingView with explicit
      // Keyboard.addListener + dynamic paddingBottom.
      expect(SRC).toMatch(/Keyboard\.addListener\(\s*showEvent/);
      expect(SRC).toMatch(/Keyboard\.addListener\(\s*hideEvent/);
      expect(SRC).not.toMatch(/<KeyboardAvoidingView/);
    });

    it("isCreateMode + onDiscardTrip props declared (route wires useSoftDeleteTrip)", () => {
      expect(SRC).toMatch(/isCreateMode\?:\s*boolean/);
      expect(SRC).toMatch(/onDiscardTrip\?:\s*\(\)\s*=>\s*Promise<void>/);
    });

    it("isTripWizardPristine guards all 4 step drafts", () => {
      expect(SRC).toMatch(/function\s+isTripWizardPristine/);
      // Must compare all 4 draft objects to trip-derived initials
      expect(SRC).toMatch(/tripToStep1Draft\(trip\)/);
      expect(SRC).toMatch(/tripToDaysDraft\(trip\)/);
      expect(SRC).toMatch(/tripToInclusionsDraft\(trip\)/);
      expect(SRC).toMatch(/tripToStep4Draft\(trip\)/);
    });
  });

  // ============================================================
  // app/trip/[id]/edit.tsx — isCreateMode derivation + onDiscardTrip wire
  // ============================================================
  describe("app/trip/[id]/edit.tsx — wizard mount", () => {
    const SRC = readApp("trip/[id]/edit.tsx");

    it("imports useSoftDeleteTrip + derives isCreateMode", () => {
      expect(SRC).toContain("useSoftDeleteTrip");
      expect(SRC).toMatch(/const\s+isCreateMode\s*=/);
      expect(SRC).toMatch(/trip\.status\s*===\s*"draft"/);
      expect(SRC).toMatch(/trip\.title\.length\s*===\s*0/);
    });

    it("passes isCreateMode + onDiscardTrip props to TripCreatorWizard", () => {
      expect(SRC).toMatch(/isCreateMode=\{isCreateMode\}/);
      expect(SRC).toMatch(/onDiscardTrip=\{[^}]*softDeleteMutation\.mutateAsync/s);
    });
  });

  // ============================================================
  // TripListCard (SC-10)
  // ============================================================
  describe("TripListCard component", () => {
    const SRC = read("components/trip/TripListCard.tsx");

    it("SC-10: uses glass.tint.profileBase background + 76×92 cover (mirror EventListCard)", () => {
      expect(SRC).toMatch(/backgroundColor:\s*glass\.tint\.profileBase/);
      expect(SRC).toMatch(/COVER_W\s*=\s*76/);
      expect(SRC).toMatch(/COVER_H\s*=\s*92/);
    });

    it("SC-10: uses EventCoverMedia primitive (content-agnostic)", () => {
      expect(SRC).toMatch(/import\s*\{\s*EventCoverMedia\s*\}/);
      expect(SRC).toMatch(/<EventCoverMedia/);
    });

    it("uses Pill primitive for status (live/upcoming/draft variants)", () => {
      expect(SRC).toMatch(/import\s*\{\s*Pill\s*\}/);
      expect(SRC).toContain('variant="live"');
      expect(SRC).toContain('variant="accent"');
      expect(SRC).toContain('variant="draft"');
    });

    it("manage icon uses glass.tint.chrome.idle (correct token-shape per ORCH-0873 hotfix lesson)", () => {
      // P1 lesson from ORCH-0873: never use bare glass.tint.chrome (object).
      expect(SRC).toMatch(/backgroundColor:\s*glass\.tint\.chrome\.idle/);
      expect(SRC).not.toMatch(/backgroundColor:\s*glass\.tint\.chrome,/);
    });
  });

  // ============================================================
  // hub/trips.tsx — filter pills + TripListCard mount + flexGrow:0
  // ============================================================
  describe("app/(tabs)/hub/trips.tsx — list page", () => {
    const SRC = readApp("(tabs)/hub/trips.tsx");

    it("SC-11: filter pill row above trips list with 4 pills (All / Upcoming / Past / Drafts)", () => {
      expect(SRC).toMatch(/key:\s*"all"/);
      expect(SRC).toMatch(/key:\s*"upcoming"/);
      expect(SRC).toMatch(/key:\s*"past"/);
      expect(SRC).toMatch(/key:\s*"draft"/);
      // Live pill NOT included per Q1=A
      expect(SRC).not.toMatch(/key:\s*"live"/);
    });

    it("SC-11: filter ScrollView uses flexGrow:0 (sibling-ScrollView footgun)", () => {
      expect(SRC).toMatch(/pillsScroll:[^}]*flexGrow:\s*0/s);
    });

    it("SC-10: TripListCard rendered per trip; routeForEventRowDefensive used", () => {
      expect(SRC).toMatch(/<TripListCard/);
      expect(SRC).toMatch(/routeForEventRowDefensive/);
      expect(SRC).toMatch(/event_type:\s*"trip"/);
    });

    it("empty state uses GlassCard variant='elevated'", () => {
      expect(SRC).toMatch(/<GlassCard\s+variant="elevated"/);
    });
  });

  // ============================================================
  // app/trip/[id]/index.tsx — hero + action grid + header + cancel CTA + ORCH-0867 fold
  // ============================================================
  describe("app/trip/[id]/index.tsx — detail dashboard", () => {
    const SRC = readApp("trip/[id]/index.tsx");

    it("SC-12: hero section with cover + gradient overlay + 24pt title + subline", () => {
      expect(SRC).toMatch(/<EventCoverMedia[\s\S]*height=\{?200/);
      expect(SRC).toMatch(/heroOverlay:[^}]*backgroundColor:\s*"rgba\(12,\s*14,\s*18,\s*0\.35\)"/s);
      expect(SRC).toMatch(/heroTitle:[^}]*fontSize:\s*24[^}]*fontWeight:\s*"700"/s);
    });

    it("SC-13: action grid with 4 tiles including View public page (ORCH-0867 fold)", () => {
      expect(SRC).toMatch(/<ActionTile[^>]*label="View public page"/);
      expect(SRC).toMatch(/<ActionTile[^>]*label="Brand page"/);
      expect(SRC).toMatch(/<ActionTile[^>]*label="Marketing blasts"/);
      expect(SRC).toMatch(/<ActionTile[^>]*label=\{trip\.status === "draft"/);
      expect(SRC).toMatch(/<ActionTile[^>]*primary/);
    });

    it("SC-14: header right slot has share + moreH IconChromes; inline Edit Pressable removed", () => {
      expect(SRC).toMatch(/<IconChrome[^>]*icon="share"[^>]*size=\{?36/);
      expect(SRC).toMatch(/<IconChrome[^>]*icon="moreH"[^>]*size=\{?36/);
      expect(SRC).toMatch(/accessibilityLabel="Share trip"/);
      expect(SRC).toMatch(/accessibilityLabel="Trip options"/);
      // The "Edit" pill (line 250 in old version) is no longer rendered as inline header text.
      expect(SRC).not.toMatch(/<Text style=\{styles\.editBtnText\}>Edit<\/Text>/);
    });

    it("SC-21 (ORCH-0867 fold): View-public-page tile navigates to /t/{brandSlug}/{slug}", () => {
      expect(SRC).toMatch(/router\.push\(`\/t\/\$\{trip\.brandSlug\}\/\$\{trip\.slug\}`/);
    });

    it("Cancel-trip ConfirmDialog (typeToConfirm) wired to softDeleteMutation", () => {
      expect(SRC).toContain('"Cancel this trip?"');
      expect(SRC).toMatch(/variant="typeToConfirm"/);
      expect(SRC).toMatch(/softDeleteMutation\.mutateAsync/);
    });

    it("TripManageMenu mounted at root", () => {
      expect(SRC).toMatch(/<TripManageMenu/);
      expect(SRC).toMatch(/import\s*\{\s*TripManageMenu\s*\}/);
    });

    it("ShareModal mounted (only when brandSlug present)", () => {
      expect(SRC).toMatch(/<ShareModal/);
      expect(SRC).toMatch(/business\.usemingla\.com\/t\/\$\{trip\.brandSlug\}\/\$\{trip\.slug\}/);
    });

    it("Money tab content + retry logic UNCHANGED (no regression on ORCH-0873)", () => {
      // ORCH-0874 hard guard: PRESERVE all ORCH-0873 Money tab functionality.
      // Pin the key invariants from ORCH-0873 SC-11.
      expect(SRC).toMatch(/inst\.status\s*===\s*"failed"/);
      expect(SRC).toContain("retryMutation.mutate(inst.id)");
      expect(SRC).toContain("Refund · coming in Tr4");
    });
  });

  // ============================================================
  // TripManageMenu component
  // ============================================================
  describe("TripManageMenu component", () => {
    const SRC = read("components/trip/TripManageMenu.tsx");

    it("Q5=A: 4 rows (View public page / Share / Edit / Cancel destructive)", () => {
      expect(SRC).toContain('label="View public page"');
      expect(SRC).toContain('label="Share trip link"');
      expect(SRC).toContain('label="Edit trip"');
      expect(SRC).toContain('label="Cancel trip"');
      expect(SRC).toMatch(/destructive/);
    });

    it("uses Sheet primitive (correct sub-sheet pattern, not Fragment sibling)", () => {
      expect(SRC).toMatch(/import\s*\{\s*Sheet\s*\}/);
      expect(SRC).toMatch(/<Sheet\s/);
    });

    it("Cancel row hidden via canCancelTrip prop (drafts don't show Cancel)", () => {
      expect(SRC).toMatch(/canCancelTrip/);
    });
  });

  // ============================================================
  // app/t/[brandSlug]/[tripSlug].tsx — public page X-close + share overlays
  // ============================================================
  describe("app/t/[brandSlug]/[tripSlug].tsx — public page", () => {
    const SRC = readApp("t/[brandSlug]/[tripSlug].tsx");

    it("SC-17: X-close + share IconChrome overlays on cover hero", () => {
      expect(SRC).toMatch(/<IconChrome[^>]*icon="close"[^>]*size=\{?36/);
      expect(SRC).toMatch(/<IconChrome[^>]*icon="share"[^>]*size=\{?36/);
      expect(SRC).toMatch(/closeOverlay:[^}]*position:\s*"absolute"/s);
      expect(SRC).toMatch(/shareOverlay:[^}]*position:\s*"absolute"/s);
    });

    it("SC-18: buyer-anon posture preserved (no useAuth, no sign-in redirect)", () => {
      expect(SRC).not.toMatch(/import.*\{\s*useAuth/);
      expect(SRC).not.toMatch(/router\.replace\(["']\/sign-in/);
      expect(SRC).not.toMatch(/router\.replace\(["']\/login/);
    });

    it("SC-18: SafeArea allowlist comment preserved (full-bleed cover under status bar)", () => {
      expect(SRC).toContain("orch-strict-grep-allow safearea-on-fullscreen-routes");
    });

    it("X-close handler uses router.canGoBack() / router.back() / fallback", () => {
      expect(SRC).toMatch(/router\.canGoBack\(\)/);
      expect(SRC).toMatch(/router\.back\(\)/);
    });

    it("share handler uses native Share.share() with platform branch", () => {
      expect(SRC).toMatch(/Share\.share\(/);
      expect(SRC).toMatch(/Platform\.OS\s*===\s*"ios"/);
    });
  });

  // ============================================================
  // Token-shape guard (ORCH-0873 P1 lesson — applies to new files in this ORCH)
  // ============================================================
  describe("Token-shape guard (ORCH-0873 P1 carryover)", () => {
    it("no new file in this ORCH uses bare glass.tint.chrome as backgroundColor", () => {
      const files = [
        "components/trip/TripListCard.tsx",
        "components/trip/TripManageMenu.tsx",
        "components/trip/TripCreatorWizard.tsx",
      ];
      const violations: string[] = [];
      for (const f of files) {
        const content = read(f);
        // Find bare glass.tint.chrome (no .idle/.pressed suffix)
        if (/backgroundColor:\s*glass\.tint\.chrome(?!\.[a-z])/.test(content)) {
          violations.push(f);
        }
      }
      expect(violations).toEqual([]);
    });
  });
});
