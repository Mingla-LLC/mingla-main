#!/usr/bin/env node
// Issue #3645 — paid drafts stop at Publish, and the small Host fixes that
// shipped with it. STRUCTURAL WIRING ONLY.
//
// WHY THIS IS A GATE AND NOT A JEST FILE. Every rule here is a fact about how
// React Native screens are wired (which handler a button calls, what a route
// reads, in what order). mingla-business jest runs in a node environment and
// cannot mount those screens, and a jest file that only reads source text is
// disallowed as a regression proof (I-PROPOSED-1047-BIZ-NO-SOLE-SOURCE-PIN).
// The BEHAVIOUR behind these rules is executed by jest and pg17 suites, named
// next to each group below; this gate keeps the wiring from drifting away from
// the behaviour those suites prove.
//
// IT FAILS CLOSED AND IS AUDIBLE. A file that cannot be read, an anchor that is
// missing, or a rule it cannot evaluate is a failure. Every rule is printed
// with its verdict. `--self-test` proves no rule is vacuous: each rule is run
// against a copy of the tree with exactly the thing it protects broken, and
// must then fail by its own id.
//
// Usage:
//   node .github/scripts/strict-grep/issue-3645-paid-drafts-stop-at-publish.mjs
//   node .github/scripts/strict-grep/issue-3645-paid-drafts-stop-at-publish.mjs --self-test
// [TEST-MOD-APPROVED #1318] The approved pricing preview says "You keep".

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TAG = "issue-3645-paid-drafts-stop-at-publish";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const B = "mingla-business/";

const F = {
  connectNative: `${B}app/brand/[id]/connect.tsx`,
  onboardRoute: `${B}app/brand/[id]/payments/onboard.tsx`,
  webBody: `${B}src/components/brand/BrandBankConnectBody.web.tsx`,
  onboardView: `${B}src/components/brand/BrandOnboardView.tsx`,
  eventRoute: `${B}app/event/[id]/edit.tsx`,
  rsvpRoute: `${B}app/rsvp/[id]/edit.tsx`,
  tripRoute: `${B}app/trip/[id]/edit.tsx`,
  experienceRoute: `${B}app/experience/[id]/edit.tsx`,
  tripWizard: `${B}src/components/trip/TripCreatorWizard.tsx`,
  tripPricing: `${B}src/components/trip/TripCreatorStep4Pricing.tsx`,
  tripReview: `${B}src/components/trip/TripCreatorStep5Review.tsx`,
  experienceWizard: `${B}src/components/experience/ExperienceCreatorWizard.tsx`,
  experiencePricing: `${B}src/components/experience/ExperiencePricingStep.tsx`,
  eventWizard: `${B}src/components/event/EventCreatorWizard.tsx`,
  rsvpWizard: `${B}src/components/rsvp/RsvpCreatorWizard.tsx`,
  rsvpSetup: `${B}src/components/rsvp/RsvpStep5Setup.tsx`,
  editPublished: `${B}src/components/event/EditPublishedScreen.tsx`,
  autosaveHook: `${B}src/hooks/useServerDraftEvents.ts`,
  ticketSheet: `${B}src/components/event/TicketTierEditSheet.tsx`,
  ticketsStep: `${B}src/components/event/CreatorStep5Tickets.tsx`,
  costBox: `${B}src/components/pricing/WhoCoversCostsSection.tsx`,
  chooser: `${B}src/components/brand/OfferingChooser.tsx`,
  deleteSheet: `${B}src/components/brand/BrandDeleteSheet.tsx`,
  creationFlow: `${B}src/components/brand/BrandCreationFlow.tsx`,
  topSheet: `${B}src/components/ui/TopSheet.tsx`,
  modal: `${B}src/components/ui/Modal.tsx`,
  sheetMobile: `${B}src/components/ui/SheetMobile.tsx`,
  sheetWeb: `${B}src/components/ui/Sheet.web.tsx`,
  countryPicker: `${B}src/components/brand/BrandStripeCountryPicker.tsx`,
  eventManage: `${B}app/event/[id]/index.tsx`,
  rsvpManage: `${B}app/rsvp/[id]/index.tsx`,
  tripManage: `${B}app/trip/[id]/index.tsx`,
  experienceManage: `${B}app/experience/[id]/index.tsx`,
  hubEvents: `${B}app/(tabs)/hub/events.tsx`,
  statusPill: `${B}src/components/event/EventDetailHeroStatusPill.tsx`,
  eventHooks: `${B}src/hooks/useBusinessEvents.ts`,
};

// #3645 (bank setup and truthful copy): the sold-tickets dialog and toast used
// to carry internal wording ("when those wire up (B-cycle)"). They now say what
// the code does: sales stop, paid orders are queued for a full refund, Mingla
// reviews the batch. The rules below pin that the screens use the shared
// helper and that the internal wording cannot come back.
const INTERNAL_WORDING = "B-cycle";

// ---------------------------------------------------------------------------
// Rule constructors. Every rule knows how to BREAK the thing it protects, so
// the self-test can prove it is not vacuous.
// ---------------------------------------------------------------------------

/** `text` must appear in `file`. */
const has = (id, file, text, why) => ({ id, file, why, kind: "has", text });
/** `text` must NOT appear in `file`. */
const lacks = (id, file, text, why) => ({ id, file, why, kind: "lacks", text });
/** `text` must appear exactly `n` times in `file`. */
const count = (id, file, text, n, why) => ({ id, file, why, kind: "count", text, n });
/** Every anchor must appear, each after the previous one. */
const ordered = (id, file, anchors, why) => ({ id, file, why, kind: "ordered", anchors });
/** Between `from` and the next `to`, `text` must NOT appear. */
const sliceLacks = (id, file, from, to, text, why) => ({
  id, file, why, kind: "sliceLacks", from, to, text,
});
/** Between `from` and the next `to`, `text` must appear. */
const sliceHas = (id, file, from, to, text, why) => ({
  id, file, why, kind: "sliceHas", from, to, text,
});

const RULES = [
  // -------------------------------------------------------------------------
  // A. Bank setup returns to the creator that sent the host there.
  //    Executed: mingla-business/src/utils/__tests__/
  //      issue_3645_bank_setup_return.implementor.test.ts
  //    Invariant: I-PROPOSED-3645-BANK-SETUP-RETURN-IS-A-CLOSED-INTERNAL-PATH
  // -------------------------------------------------------------------------
  count("A1-native-alias-reads-param-once", F.connectNative, "params.resume", 1,
    "the return target is a route param; it is read once and only through the sanitiser"),
  has("A1-native-alias-sanitises", F.connectNative, "sanitizeBankSetupReturnPath(params.resume)",
    "the native alias never forwards a raw route param"),
  has("A1-native-alias-forwards", F.connectNative, "withBankSetupReturn(",
    "the native alias carries the validated target on to the onboarding route"),
  count("A2-onboard-route-reads-param-once", F.onboardRoute, "params.resume", 1,
    "read once, through the sanitiser"),
  has("A2-onboard-route-sanitises", F.onboardRoute, "sanitizeBankSetupReturnPath(params.resume)",
    "the onboarding route never navigates to a raw route param"),
  ordered("A2-onboard-route-back-order", F.onboardRoute, [
    "const handleBack = (): void => {",
    "isBrandCreateFunnel && brandId !== null",
    "router.back()",
    "router.replace(resumePath as never)",
    "router.replace(`/brand/${brand.id}/payments`",
  ], "brand creation first, then history, then the creator, then the payments page"),
  has("A2-onboard-route-passes-path-to-view", F.onboardRoute,
    "returnPath={isBrandCreateFunnel ? null : resumePath}",
    "hosted setup's return URL is the creator, never inside the brand-creation funnel"),
  has("A3-view-uses-creator-return", F.onboardView,
    "buildBankSetupWebReturnUrl(window.location.origin, returnPath) ??",
    "on the web, hosted setup returns to the creator when a valid one is known"),
  has("A3-view-keeps-payments-fallback", F.onboardView,
    "buildLegacyWebReturnUrl(window.location.origin, brand.id)",
    "with no usable creator path the payments page is the return, as before"),
  count("A4-web-body-reads-param-once", F.webBody, "params.resume", 1,
    "read once, through the sanitiser"),
  has("A4-web-body-ignores-path-in-funnel", F.webBody,
    "const resumePath = isBrandCreateFunnel\n    ? null\n    : sanitizeBankSetupReturnPath(params.resume);",
    "the brand-creation funnel keeps its own return"),
  count("A4-web-body-returns-to-creator", F.webBody, "router.replace(resumePath as never)", 2,
    "Back with no history, and a finished Nigerian bank form, both return to the creator"),
  has("A4-web-body-hosted-return", F.webBody, "returnPath: resumePath,",
    "hosted setup started from the web body returns to the creator"),
  has("A5-funnel-return-untouched-route", F.onboardRoute,
    "`/brand/new?resume_brand=${encodeURIComponent(brandId)}`",
    "from=brand-create still returns to brand creation"),
  has("A5-funnel-return-untouched-web", F.webBody,
    "`/brand/new?resume_brand=${encodeURIComponent(brandId)}`",
    "from=brand-create still returns to brand creation"),
  has("A6-view-refreshes-on-leave", F.onboardView,
    "refreshBrandPaymentState(queryClient, brandIdForRefresh);",
    "leaving bank setup re-reads the brand's payment state so Publish enables"),
  has("A6-web-body-refreshes-on-leave", F.webBody,
    "refreshBrandPaymentState(bodyQueryClient, brandId);",
    "leaving bank setup re-reads the brand's payment state so Publish enables"),

  // Each creator sends its own kind and the step the host is on.
  has("A7-event-kind", F.eventRoute, 'kind: "event"', "the event creator names itself"),
  has("A7-event-step", F.eventRoute, "step: draft.lastStepReached ?? initialStep ?? null",
    "the event creator returns to the step the host reached"),
  has("A7-rsvp-kind", F.rsvpRoute, 'kind: "rsvp"', "the RSVP creator names itself"),
  has("A7-rsvp-step", F.rsvpRoute, "step: step ?? draft.lastStepReached ?? initialStep ?? null",
    "the RSVP creator returns to the step the host is on"),
  lacks("A7-rsvp-no-bare-route", F.rsvpRoute,
    "router.push(`/brand/${draft.brandId}/payments/onboard` as never)",
    "the RSVP creator no longer opens bank setup with nowhere to come back to"),
  has("A7-trip-kind-and-step", F.tripWizard,
    'buildBankSetupReturnPath({ kind: "trip", id: trip.id, step })',
    "the trip creator names itself and its current step"),
  has("A7-trip-opens-on-step", F.tripWizard, "resolveTripWizardInitialStep(initialStep)",
    "a full-page return reopens the trip wizard on a step it can open cold"),
  has("A7-trip-route-passes-step", F.tripRoute, "initialStep={initialStep}",
    "the trip route reads ?step= and hands it to the wizard"),
  has("A7-experience-kind", F.experienceWizard, 'kind: "experience"',
    "the experience creator names itself"),
  has("A7-experience-opens-on-step", F.experienceWizard,
    "resolveExperienceWizardInitialStep(initialStep)",
    "a full-page return reopens the experience wizard on a step it can open cold"),
  has("A7-experience-route-passes-step", F.experienceRoute,
    "initialStep={isLive ? undefined : initialStep}",
    "the experience route reads ?step= for drafts only"),

  // The experience draft is saved before the host leaves (its later steps are
  // only written on save or publish; a full-page return would lose them).
  ordered("A8-experience-saves-before-leaving", F.experienceWizard, [
    "const handleConnectStripe = useCallback((): void => {",
    "if (isLiveEdit) {",
    '"issue_1719_publish_experience_with_poster",',
    "p_payload: buildPayload(false),",
    "p_publish: false,",
    "setToast(EXPERIENCE_SAVE_BEFORE_BANK_FAILED_COPY);",
    "kind: \"experience\",",
  ], "live edits only navigate; drafts are saved (never published) and a failed save keeps the host here"),
  sliceLacks("A8-experience-never-publishes-here", F.experienceWizard,
    "const handleConnectStripe = useCallback((): void => {",
    "// ORCH-1075 — surface the two paid-publish guard reasons",
    "p_publish: true",
    "leaving for bank setup must never publish"),

  // -------------------------------------------------------------------------
  // B. Trips: a priced draft saves; the stop is at Publish.
  //    Executed: supabase/migrations/__tests__/
  //      issue_3645_trip_draft_saves_priced_packages.*.pg17.test.sql and
  //      mingla-business/src/components/trip/__tests__/
  //      issue_3801_trip_step_save_failure.implementor.test.tsx
  // -------------------------------------------------------------------------
  sliceLacks("B1-continue-never-navigates-push", F.tripWizard,
    "const handleNext = useCallback(async (): Promise<void> => {",
    "const handleStepBack = useCallback(",
    "router.push", "a step save never sends the host to bank setup"),
  sliceLacks("B1-continue-never-navigates-replace", F.tripWizard,
    "const handleNext = useCallback(async (): Promise<void> => {",
    "const handleStepBack = useCallback(",
    "router.replace", "a step save never navigates"),
  sliceLacks("B1-back-never-navigates-push", F.tripWizard,
    "const handleStepBack = useCallback(async (): Promise<void> => {",
    "// ----- ORCH-0874 handleClose",
    "router.push", "Back is never a detour to bank setup"),
  sliceLacks("B1-back-never-navigates-replace", F.tripWizard,
    "const handleStepBack = useCallback(async (): Promise<void> => {",
    "// ----- ORCH-0874 handleClose",
    "router.replace", "Back never navigates"),
  count("B2-two-ways-to-bank-setup", F.tripWizard, "router.push(bankSetupRoute as never)", 2,
    "bank setup is reachable from the Review card and a refused publish, nowhere else"),
  has("B3-pricing-card-title", F.tripPricing,
    'export const TRIP_PRICING_KEEP_BUILDING_TITLE = "You can keep building";',
    "approved copy"),
  has("B3-pricing-card-body", F.tripPricing,
    '"This trip saves as a draft. You\'ll need a bank connected before you publish it with a price.";',
    "approved copy"),
  has("B3-pricing-card-gated", F.tripPricing, "{needsBankToPublish ? (",
    "the card shows only when the trip needs a bank to publish"),
  sliceLacks("B3-pricing-card-has-no-button", F.tripPricing,
    "{needsBankToPublish ? (", ") : null}", "onPress",
    "the pricing card informs; nothing on the pricing step leaves the wizard"),
  has("B4-payment-plan-counts-on-pricing", F.tripWizard,
    "needsBankToPublish={tripNeedsStripe || tripNeedsBankForInstallments}",
    "a payment plan is treated like a price"),
  has("B4-payment-plan-counts-on-review", F.tripWizard,
    "needsStripe={tripNeedsStripe || tripNeedsBankForInstallments}",
    "a payment plan shows the same Review card"),
  has("B5-review-card-body", F.tripReview,
    'body="Connect a bank to publish this paid trip. Your draft is saved and you\'ll come straight back here."',
    "approved copy"),
  ordered("B6-publish-still-stops", F.tripWizard, [
    "const handlePublishTap = useCallback(async (): Promise<void> => {",
    "if (tripNeedsStripe) {",
    "if (tripNeedsBankForInstallments) {",
    "const handleConfirmPublish = useCallback(",
  ], "Publish itself still refuses a paid trip and a payment plan without a bank"),

  // -------------------------------------------------------------------------
  // C. RSVPs: chip-ins save in a draft; a choice at Publish.
  //    Executed: supabase/migrations/__tests__/
  //      issue_3645_rsvp_draft_saves_chip_ins.*.pg17.test.sql and
  //      mingla-business/src/components/rsvp/__tests__/
  //      issue_3645_rsvp_chip_in_choice_at_publish.implementor.test.tsx
  // -------------------------------------------------------------------------
  ordered("C1-choice-before-publish-dialog", F.rsvpWizard, [
    "const handlePublishTap = useCallback(async (): Promise<void> => {",
    "validateRsvpPublish(liveDraft)",
    "liveDraft.rsvpContributionEnabled &&",
    "chipInReadinessKnown &&",
    "!chipInPayoutReady",
    "openChipInChoice();",
    "setPublishConfirmVisible(true);",
  ], "validation first, then the chip-in choice, then the normal publish dialog"),
  has("C1-readiness-must-have-loaded", F.rsvpWizard, "!chipInStripeStatus.isLoading &&",
    "the choice is only shown on readiness that has actually loaded"),
  has("C1-readiness-must-not-have-failed", F.rsvpWizard, "!chipInStripeStatus.isError;",
    "a failed readiness read leaves the decision to the server"),
  ordered("C2-server-refusal-opens-choice", F.rsvpWizard, [
    "const code = readRpcFailureMessage(error);",
    'detectPaidPublishGuardReason(code) === "stripe_charges_disabled"',
    "setTimeout(openChipInChoice, CHIP_IN_CHOICE_SETTLE_MS);",
    'guardCopy !== null && guardCopy.action === "stripe_onboarding"',
  ], "a server refusal for chip-ins opens the choice before the legacy toast-and-navigate branch"),
  sliceLacks("C2-server-refusal-does-not-navigate", F.rsvpWizard,
    'detectPaidPublishGuardReason(code) === "stripe_charges_disabled"',
    "const guardCopy = resolvePaidPublishGuardCopy(code);",
    "onOpenStripeOnboard", "the refusal never sends the host to bank setup unasked"),
  has("C3-dialog-is-lazy", F.rsvpWizard, '() => import("./RsvpChipInBankChoiceDialog"),',
    "the dialog loads the first time it opens"),
  lacks("C3-dialog-not-imported-eagerly", F.rsvpWizard, 'from "./RsvpChipInBankChoiceDialog"',
    "an eager import would put the dialog in the wizard's own chunk"),
  has("C3-dialog-connect-wired", F.rsvpWizard, "onConnectBank={handleChipInChoiceConnectBank}",
    "primary action"),
  has("C3-dialog-publish-without-wired", F.rsvpWizard,
    "void handleChipInChoicePublishWithout();", "secondary action"),
  has("C3-dialog-shows-working", F.rsvpWizard, "working={chipInChoiceWorking}",
    "the dialog shows a working state while chip-ins are being switched off"),
  has("C3-dialog-shows-error", F.rsvpWizard, "errorMessage={chipInChoiceError}",
    "a failed save is said on the dialog, which stays open"),
  sliceHas("C4-connect-returns-to-this-step", F.rsvpWizard,
    "const handleChipInChoiceConnectBank = useCallback((): void => {",
    "}, [onOpenStripeOnboard, currentStep]);",
    "onOpenStripeOnboard?.(currentStep);", "bank setup comes back to the step the host is on"),
  // The order (off locally, AWAIT the save, stored draft off, only then the
  // publish flow), the failure path and the restore are executed in
  // mingla-business/src/utils/__tests__/
  //   issue_3645_rsvp_publish_without_chip_ins_awaits_save.implementor.test.ts
  ordered("C5-chip-ins-off-is-saved-before-publish", F.rsvpWizard, [
    "const handleChipInChoicePublishWithout = useCallback(async (): Promise<void> => {",
    "await switchChipInsOffThenProceed<DraftEvent>({",
    "handleUpdate({ rsvpContributionEnabled: enabled });",
    "saveNow: onSaveDraftNow,",
    "resumePublishRef.current()",
    "}, [handleUpdate, onSaveDraftNow]);",
  ], "the publish flow continues only from the awaited save's own proceed step"),
  sliceLacks("C5-secondary-never-navigates", F.rsvpWizard,
    "const handleChipInChoicePublishWithout = useCallback(async (): Promise<void> => {",
    "}, [handleUpdate, onSaveDraftNow]);",
    "onOpenStripeOnboard", "publishing without chip-ins never sends the host to bank setup"),
  sliceLacks("C5-secondary-never-publishes-itself", F.rsvpWizard,
    "const handleChipInChoicePublishWithout = useCallback(async (): Promise<void> => {",
    "}, [handleUpdate, onSaveDraftNow]);",
    "onPublishDraft", "the secondary action never calls publish; it hands over to the normal flow"),
  lacks("C5-fire-and-forget-save-gone", F.rsvpWizard,
    "handleUpdate({ rsvpContributionEnabled: false });\n    setChipInChoiceVisible(false);",
    "switching chip-ins off and moving on without waiting for the save is the race this closes"),
  has("C5-route-supplies-awaited-save", F.rsvpRoute, "onSaveDraftNow={handleSaveDraftNow}",
    "the route gives the wizard an awaited save"),
  has("C5-awaited-save-is-the-real-one", F.rsvpRoute,
    "return autosave.saveDraftAsync(draftToSave);",
    "the awaited save resolves with the draft as the server stored it"),
  lacks("C5-server-refusal-ignores-local-flag", F.rsvpWizard,
    "latestDraftRef.current.rsvpContributionEnabled &&\n        detectPaidPublishGuardReason",
    "a refusal for chip-ins re-shows the choice even when the screen thinks they are off"),
  has("C5-publish-reads-latest-draft", F.rsvpWizard,
    "const draftToPublish = latestDraftRef.current;",
    "the publish that follows uses the draft after chip-ins were switched off"),
  has("C6-callout-copy", F.rsvpSetup,
    '"Your draft saves either way. Connect now, or choose when you publish.";', "approved copy"),
  has("C6-callout-button", F.rsvpSetup, "onPress={onConnectChipInBank}",
    "the callout's Connect bank button"),
  has("C6-callout-only-in-draft-wizard", F.rsvpSetup, "{onConnectChipInBank !== undefined ? (",
    "the draft claim is only made where there is a draft"),
  lacks("C6-published-edit-screen-untouched", F.editPublished, "onConnectChipInBank",
    "a published RSVP must not be told its draft saves"),
  sliceLacks("C6-other-steps-props-stay-stable", F.rsvpWizard,
    "const baseProps = {", "};", "onConnectChipInBank",
    "only the Setup step receives the action"),
  has("C7-route-truthful-promote-failure", F.rsvpRoute, "message: rsvpDraftSaveFailureCopy(error),",
    "a refused save says why, not 'check your connection'"),
  has("C7-route-truthful-autosave-failure", F.rsvpRoute,
    "if (!isRsvpChipInBankRefusal(autosaveLastError)) return;",
    "an autosave refused for chip-ins says so"),
  has("C7-autosave-exposes-failure", F.autosaveHook,
    "lastError: hasError ? mutation.error ?? null : null,",
    "the autosave hook exposes the failure it already tracked"),

  // -------------------------------------------------------------------------
  // D. Experience Review step bank card; Organiser Terms resume.
  //    Executed: mingla-business/src/hooks/__tests__/
  //      issue_3645_organiser_terms_resumes_publish.implementor.test.tsx
  // -------------------------------------------------------------------------
  ordered("D1-review-card", F.experienceWizard, [
    "<InvitePlanReviewSummary plan={invitePlan} quote={inviteQuote} />",
    "inviteEnabled && step === 7 && experienceNeedsStripe",
    'title="Bank required for paid experiences"',
    'body="Connect a bank to publish this paid experience. You\'ll come straight back here."',
    'testID="experience-review-stripe-blocked"',
    "{step < finalStep ? (",
  ], "the Review step shows the bank card, with the approved copy, above the footer"),
  has("D1-pricing-card-still-there", F.experienceWizard, "step === 4 && experienceNeedsStripe",
    "the Pricing step card is unchanged"),
  has("D1-cover-card-still-there", F.experienceWizard, "step === 5 && experienceNeedsStripe",
    "the Cover step card is unchanged"),
  has("D1-publish-still-disabled", F.experienceWizard,
    "disabled={experienceNeedsStripe || !invitePublishReady || checkingInvitePublish}",
    "Publish stays disabled until the bank is connected"),
  ordered("D1-return-lands-on-review", F.experienceWizard, [
    "if (inviteEnabled && resumeReviewRef.current) {",
    "resumeReviewRef.current = false;",
    "setStep(7);",
  ], "a host returning to Review lands on Review once the invite step is known"),
  count("D2-experience-resumes-publish", F.experienceWizard,
    "() => resumePublishRef.current(),", 3,
    "both Organiser Terms checks, and the server's own terms refusal, hand over the publish to resume"),
  lacks("D2-experience-no-retry-toast", F.experienceWizard, "ORGANISER_TERMS_PUBLISH_RETRY_TOAST",
    "no 'tap Publish again' after accepting"),
  has("D2-trip-resumes-publish", F.tripWizard, "resumePublishRef.current()",
    "the trip wizard hands over its publish to resume"),
  lacks("D2-trip-no-retry-toast", F.tripWizard, "ORGANISER_TERMS_PUBLISH_RETRY_TOAST",
    "no 'tap Publish again' after accepting"),
  has("D2-event-resumes-publish", F.eventWizard, "resumePublishRef.current()",
    "the event wizard hands over its publish to resume"),
  lacks("D2-event-no-retry-toast", F.eventWizard, "ORGANISER_TERMS_PUBLISH_RETRY_TOAST",
    "no 'tap Publish again' after accepting"),

  // -------------------------------------------------------------------------
  // E. Small Host fixes (live test, 2026-10-13).
  //    Executed: the issue_3645_* jest suites named in each group.
  // -------------------------------------------------------------------------
  // E-a. Escape closes only the top overlay.
  //      (src/components/ui/__tests__/issue_3645_escape_closes_only_the_top_overlay…)
  count("Ea-topsheet-asks-the-stack", F.topSheet,
    'if (event.key === "Escape" && isEscapeTop()) onClose();', 2,
    "both TopSheet bodies close on Escape only when they are the top layer"),
  lacks("Ea-topsheet-no-unconditional-escape", F.topSheet,
    'if (event.key === "Escape") onClose();', "an unconditional Escape closes every stacked overlay"),
  count("Ea-modal-asks-the-stack", F.modal, 'event.key === "Escape" && isEscapeTop()', 2,
    "both Modal bodies close on Escape only when they are the top layer"),
  has("Ea-mobile-sheet-registers", F.sheetMobile, "useEscapeLayer(visible);",
    "a platform-modal sheet registers so the overlay under it stays open"),
  has("Ea-web-sheet-registers", F.sheetWeb, "useEscapeLayer(visible);",
    "a platform-modal sheet registers so the overlay under it stays open"),
  has("Ea-country-list-is-such-a-sheet", F.countryPicker,
    '<Sheet visible={visible} onClose={onClose} snapPoint="full">',
    "the payout country list is one of those sheets"),

  // E-b. The experience price field starts empty.
  //      (src/components/experience/__tests__/issue_3645_experience_price_field…)
  has("Eb-price-seeded-through-helper", F.experienceWizard, "initialWholePriceInput(",
    "the field's starting text goes through the helper"),
  lacks("Eb-price-no-literal-zero", F.experienceWizard, 'prefill?.wholePriceMajor ?? "0.00"',
    "a literal 0.00 in the field turns a typed 30 into 0.0030"),
  // #3281 R2 — whole-price field is the lead option row (option.priceMajor),
  // still empty-seeded with placeholder 0.00 and the same accessibility label.
  ordered("Eb-zero-is-the-placeholder", F.experiencePricing, [
    "value={option.priceMajor}",
    'placeholder="0.00"',
    'accessibilityLabel={',
    '"Whole experience price"',
  ], "0.00 is the placeholder of the whole-price field"),
  has("Eb-validation-unchanged", F.experienceWizard,
    'if (pricingMode === "whole") return resolvedTotalMajor > 0;',
    "a paid whole-price experience still needs a price above zero"),

  // E-c. The payout country prompt inside the ticket sheet.
  ordered("Ec-slot-under-price", F.ticketSheet, [
    "{/* Price (when not free)",
    "{renderUnderPrice?.(ticketPriceTextIsPriced(isFree, priceText))}",
    "{/* Unlimited toggle",
  ], "the prompt renders directly under the Price field, as the price is typed"),
  ordered("Ec-priced-means-above-zero", F.ticketSheet, [
    "export const ticketPriceTextIsPriced = (",
    "if (isFree) return false;",
    "return Number.isFinite(value) && value > 0;",
  ], "'priced' is the live text of the field, above zero, on a ticket that is not free"),
  has("Ec-step-passes-prompt", F.ticketsStep,
    "renderUnderPrice={renderTicketSheetPayoutCountryPrompt}",
    "the Tickets step passes the prompt into the sheet"),
  sliceHas("Ec-it-is-the-same-prompt", F.ticketsStep,
    "const renderTicketSheetPayoutCountryPrompt = useCallback(", "[brand],",
    "<PayoutCountryInlinePrompt", "the sheet shows the same prompt the step shows"),

  // E-d. The cost box with no currency.
  has("Ed-copy", F.costBox, '"Choose a payout country to see what you keep.";', "approved copy"),
  ordered("Ed-replaces-the-figures", F.costBox, [
    "{hasPrice && currency === null ? (",
    "{COST_PREVIEW_NEEDS_CURRENCY_COPY}",
    ") : hasPrice ? (",
    "<Text style={styles.previewHead}>You keep</Text>",
  ], "with no currency the sentence replaces the Buyer pays / You keep figures"),
  sliceLacks("Ed-no-bare-amount", F.costBox,
    "{hasPrice && currency === null ? (", ") : hasPrice ? (", "money(",
    "no amount is shown without a currency"),

  // E-e. The experience tile's label. (issue_2719_brand_payout_first.happy…)
  has("Ee-experience-label", F.chooser,
    'experience: "Free experiences need a payout country first; no bank needed.",',
    "approved copy"),
  lacks("Ee-old-claim-gone", F.chooser, "A free experience can be published now.",
    "a free experience cannot be published until the brand has a payout country"),

  // E-f. The delete-brand sheet names no payment provider.
  has("Ef-payment-account", F.deleteSheet,
    "<Text style={styles.previewLabel}>Payment account</Text>", "approved copy"),
  lacks("Ef-no-provider-name", F.deleteSheet,
    "<Text style={styles.previewLabel}>Stripe Connect</Text>",
    "host-facing copy never names a payment provider"),

  // E-g / E-l. The published banner follows the truth; Share only from a press.
  //      (src/hooks/__tests__/issue_3645_published_banner_withdraws…)
  has("Eg-event-passes-status", F.eventManage, "resolvedLiveEvent?.status,\n  );",
    "the event manage screen tells the banner the item's status"),
  has("Eg-rsvp-passes-status", F.rsvpManage, "resolvedLiveEvent?.status,\n  );",
    "the RSVP manage screen tells the banner the item's status"),
  has("Eg-trip-passes-status", F.tripManage, "tripQuery.data?.status,\n  );",
    "the trip manage screen tells the banner the item's status"),
  has("Eg-experience-passes-status", F.experienceManage, "experience?.status,\n  );",
    "the experience manage screen tells the banner the item's status"),
  ...[
    ["event", F.eventManage, "if (isPublishArrivalPress()) return;"],
    ["rsvp", F.rsvpManage, "if (isPublishArrivalPress()) return;"],
    ["trip", F.tripManage, "if (publishedArrival.isArrivalPress()) return;"],
    ["experience", F.experienceManage, "if (publishedArrival.isArrivalPress()) return;"],
  ].flatMap(([name, file, guard]) => [
    count(`El-${name}-one-share-opener`, file, "setShareModalVisible(true)", 1,
      "the share sheet opens from one place: the Share press handler"),
    ordered(`El-${name}-opener-behind-arrival-guard`, file, [
      "const handleShareOpen = ",
      guard,
      "setShareModalVisible(true)",
    ], "a press carried over from the publish tap never opens the share sheet"),
  ]),

  // E-h. Payouts card on the Nigerian rail. (issue_3645_sell_before_bank_copy…)
  has("Eh-copy", F.creationFlow,
    'consequenceSellBeforeBank: "You can start selling now. Your money waits until you add a bank.",',
    "approved copy"),
  // The line was first chosen from the brand row alone. Straight after the host
  // picks Nigeria that row does not carry the server's stamp yet, so the generic
  // line stayed on screen (seen live, 2026-10-14). The country picked in the
  // step decides first; the brand row decides when nothing was picked.
  ordered("Eh-picked-from-the-chosen-country-then-the-brand-row", F.creationFlow, [
    "{payoutStepSellsBeforeBank(",
    "pickedPayoutRail,",
    "payoutCanonicalBrand,",
    "? BRAND_CREATION_COPY.step4.consequenceSellBeforeBank",
    ": BRAND_CREATION_COPY.step4.consequence}",
  ], "the line follows the country just picked, then the canonical brand row; other brands keep the existing copy"),
  count("Eh-not-from-the-brand-row-alone", F.creationFlow,
    "brandSellsBeforeBank(payoutCanonicalBrand)", 0,
    "the brand row alone does not know Nigeria was just picked"),

  // E-i. Event publish confirmation by visibility.
  ordered("Ei-copy-by-visibility", F.eventWizard, [
    "export const eventPublishConfirmDescription = (",
    'if (visibility === "unlisted") {',
    '"Anyone with the link can buy straight away. You can edit details after publishing."',
    'if (visibility === "private") {',
    'return "You can edit details after publishing.";',
    'return "Public sale starts immediately. You can edit details after publishing.";',
  ], "Unlisted is not on public sale; Private makes no claim about who can buy"),
  has("Ei-dialog-reads-visibility", F.eventWizard,
    "description={eventPublishConfirmDescription(liveDraft.visibility)}",
    "the dialog reads the draft's own visibility"),
  count("Ei-public-sentence-in-one-place", F.eventWizard,
    "Public sale starts immediately. You can edit details after publishing.", 1,
    "the Public sentence is not hard-coded on the dialog any more"),

  // E-j. Cancel-event copy. (issue_3645_cancel_event_copy…)
  ordered("Ej-event-screen-knows-before-it-says", F.eventManage, [
    "const nothingSold = nothingSoldIsKnown({",
    "ordersStatus: eventOrdersQuery.status,",
    "onlineSoldCount: totalSoldCount,",
    "doorSalesEnabled: event?.inPersonPaymentsEnabled === true,",
  ], "'nothing to refund' is only said when it is known"),
  has("Ej-event-screen-dialog", F.eventManage,
    "description={cancelDialogDescription({\n          nothingSold,",
    "the dialog uses the rule"),
  has("Ej-event-screen-sold-dialog-is-the-reviewed-refund-copy", F.eventManage,
    "nothingToRefund,\n          paidOrderCount,\n        })}",
    "with sales, the dialog says what the cancel does; free tickets are never 'queued for refund'"),
  has("Ej-event-screen-sold-toast-is-known-before-said", F.eventManage,
    "showToast(cancelDoneToast(paidOrderCountRef.current));",
    "'Refunds are with Mingla' is only said when paid orders are known to exist"),
  lacks("Ej-event-screen-no-internal-wording", F.eventManage,
    `(${INTERNAL_WORDING})`,
    "internal wording is never shown to a host"),
  ordered("Ej-hub-knows-before-it-says", F.hubEvents, [
    "const cancelEventOrders = useEventOrders(",
    "cancelEvent !== null && serverBackedEventIds.has(cancelEvent.id)",
    "onlineSoldCount: countSoldTickets(cancelEventOrders.data ?? []),",
    "doorSalesEnabled: cancelEvent.inPersonPaymentsEnabled === true,",
  ], "the hub reads the event's orders while its cancel dialog is open"),
  has("Ej-hub-dialog", F.hubEvents,
    "cancelDialogDescription({\n              nothingSold: cancelNothingSold,\n              nothingToRefund: cancelNothingToRefund,\n              paidOrderCount: cancelPaidOrderCount,",
    "the hub dialog uses the rule, and with sales says what the cancel does"),
  has("Ej-hub-rsvp-dialog-never-says-nothing-to-refund", F.hubEvents,
    "? cancelRsvpDescription(null)",
    "the hub does not read chip-ins, so an RSVP's dialog never claims there is nothing to refund"),
  has("Ej-hub-sold-toast-is-known-before-said", F.hubEvents,
    ": cancelDoneToast(cancelPaidOrderCount),",
    "'Refunds are with Mingla' is only said when paid orders are known to exist"),
  has("Ej-hub-rsvp-dialog-says-rsvp", F.hubEvents,
    'title={cancellingRsvp ? "Cancel this RSVP?" : "Cancel this event?"}',
    "an RSVP row's cancel dialog says RSVP, not event"),
  has("Ej-hub-rsvp-toast-says-rsvp", F.hubEvents,
    '? cancelDoneToast(null, "RSVP")',
    "an RSVP row's cancel toast says RSVP, not event"),
  lacks("Ej-hub-no-internal-wording", F.hubEvents,
    `(${INTERNAL_WORDING})`,
    "internal wording is never shown to a host"),

  // E-k. A cancelled event says CANCELLED and keeps its date.
  //      (issue_3645_cancelled_event_keeps_date_and_badge…)
  has("Ek-pill-label", F.statusPill, 'if (cancelled) return "CANCELLED";',
    "a cancelled event is not an ended one"),
  ordered("Ek-pill-cancelled-first", F.statusPill, [
    "> = ({ status, cancelled = false }) => {",
    "if (cancelled) {",
    'if (status === "live") {',
  ], "cancelled wins over every other state"),
  has("Ek-event-screen-tells-pill", F.eventManage, 'cancelled={event.status === "cancelled"}',
    "the event manage screen tells the pill"),
  has("Ek-rsvp-screen-tells-pill", F.rsvpManage, 'cancelled={event.status === "cancelled"}',
    "the RSVP manage screen tells the pill"),
  count("Ek-lifecycle-writes-keep-dates", F.eventHooks,
    "withKnownDates(queryClient, published, input.brandId),", 2,
    "cancel and end-ticket-sales answer without dates; the cached date is kept"),
  has("Ek-date-keeper-used", F.eventHooks,
    "const event = keepEventDatesAcrossLifecycleWrite(published.event, previous);",
    "the cache write goes through the date keeper"),
];

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const occurrences = (source, text) => (text.length === 0 ? 0 : source.split(text).length - 1);

/** Returns null when the rule holds, or a sentence saying why it does not. */
export function evaluateRule(rule, read) {
  const source = read(rule.file);
  if (typeof source !== "string") return `cannot read ${rule.file}`;
  switch (rule.kind) {
    case "has":
      return source.includes(rule.text) ? null : `missing: ${JSON.stringify(rule.text)}`;
    case "lacks":
      return source.includes(rule.text) ? `must not contain: ${JSON.stringify(rule.text)}` : null;
    case "count": {
      const found = occurrences(source, rule.text);
      return found === rule.n
        ? null
        : `expected ${rule.n} of ${JSON.stringify(rule.text)}, found ${found}`;
    }
    case "ordered": {
      let from = 0;
      for (const anchor of rule.anchors) {
        const at = source.indexOf(anchor, from);
        if (at === -1) {
          return source.includes(anchor)
            ? `out of order: ${JSON.stringify(anchor)}`
            : `missing: ${JSON.stringify(anchor)}`;
        }
        from = at + anchor.length;
      }
      return null;
    }
    case "sliceLacks":
    case "sliceHas": {
      const start = source.indexOf(rule.from);
      if (start === -1) return `missing start anchor: ${JSON.stringify(rule.from)}`;
      const end = source.indexOf(rule.to, start + rule.from.length);
      if (end === -1) return `missing end anchor: ${JSON.stringify(rule.to)}`;
      const slice = source.slice(start, end);
      const present = slice.includes(rule.text);
      if (rule.kind === "sliceLacks") {
        return present ? `must not contain between its anchors: ${JSON.stringify(rule.text)}` : null;
      }
      return present ? null : `missing between its anchors: ${JSON.stringify(rule.text)}`;
    }
    default:
      return `unknown rule kind: ${rule.kind}`;
  }
}

export function evaluate(read, rules = RULES) {
  const failures = [];
  const log = [];
  const ids = new Set();
  for (const rule of rules) {
    if (ids.has(rule.id)) failures.push(`duplicate rule id: ${rule.id}`);
    ids.add(rule.id);
    const problem = evaluateRule(rule, read);
    log.push(`  ${problem === null ? "ok  " : "FAIL"} ${rule.id} — ${rule.why}`);
    if (problem !== null) failures.push(`${rule.id} (${rule.file}): ${problem}`);
  }
  return { failures, log };
}

const readFromRepo = (file) => {
  try {
    return fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Self-test: break exactly what each rule protects; that rule must then fail.
// ---------------------------------------------------------------------------

const replaceFirst = (source, text, replacement) => {
  const at = source.indexOf(text);
  return at === -1 ? source : source.slice(0, at) + replacement + source.slice(at + text.length);
};

/** The source of `rule.file` with the protected thing broken. */
export function breakRule(rule, source) {
  switch (rule.kind) {
    case "has":
      return source.split(rule.text).join("");
    case "lacks":
      return `${source}\n${rule.text}\n`;
    case "count":
      return rule.n > 0 ? replaceFirst(source, rule.text, "") : `${source}\n${rule.text}\n`;
    case "ordered":
      // Remove the LAST anchor that follows the chain: the chain cannot complete.
      {
        let from = 0;
        let lastAt = -1;
        for (const anchor of rule.anchors) {
          const at = source.indexOf(anchor, from);
          if (at === -1) return source;
          lastAt = at;
          from = at + anchor.length;
        }
        const last = rule.anchors[rule.anchors.length - 1];
        // Every occurrence at or after the chain's position is removed, so an
        // earlier occurrence cannot stand in for it.
        return source.slice(0, lastAt) + source.slice(lastAt).split(last).join("");
      }
    case "sliceLacks": {
      const start = source.indexOf(rule.from);
      if (start === -1) return source;
      const insertAt = start + rule.from.length;
      return `${source.slice(0, insertAt)}\n${rule.text}\n${source.slice(insertAt)}`;
    }
    case "sliceHas": {
      const start = source.indexOf(rule.from);
      if (start === -1) return source;
      const end = source.indexOf(rule.to, start + rule.from.length);
      if (end === -1) return source;
      return source.slice(0, start) + source.slice(start, end).split(rule.text).join("") + source.slice(end);
    }
    default:
      return source;
  }
}

function runSelfTest() {
  const real = evaluate(readFromRepo);
  let wrong = 0;
  if (real.failures.length > 0) {
    console.error(`${TAG} self-test: the real tree must pass before any rule can be shown to bite`);
    for (const failure of real.failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`  ok   the real tree passes all ${RULES.length} rules`);

  for (const rule of RULES) {
    const original = readFromRepo(rule.file);
    const broken = breakRule(rule, original);
    const read = (file) => (file === rule.file ? broken : readFromRepo(file));
    const problem = broken === original ? null : evaluateRule(rule, read);
    const bites = problem !== null;
    if (!bites) wrong += 1;
    console.log(
      `  ${bites ? "ok  " : "WRONG"} ${rule.id} fails when what it protects is broken` +
        (bites ? "" : " — it did NOT fail (vacuous rule)"),
    );
  }

  // A file that cannot be read is a failure, never a pass.
  const unreadable = evaluate((file) => (file === F.tripWizard ? null : readFromRepo(file)));
  const closed = unreadable.failures.some((failure) => failure.includes("cannot read"));
  if (!closed) wrong += 1;
  console.log(`  ${closed ? "ok  " : "WRONG"} an unreadable file fails closed`);

  // A rule kind the engine does not know is a failure, never a pass.
  const unknown = evaluateRule({ id: "x", file: F.tripWizard, why: "", kind: "nope" }, readFromRepo);
  if (unknown === null) wrong += 1;
  console.log(`  ${unknown !== null ? "ok  " : "WRONG"} an unknown rule kind fails closed`);

  if (wrong > 0) {
    console.error(`${TAG} self-test FAIL: ${wrong} case(s) judged wrongly`);
    process.exit(1);
  }
  console.log(`${TAG} self-test PASS (${RULES.length} rules, each shown to fail when broken, 2 fail-closed cases)`);
}

function main() {
  if (process.argv.slice(2).includes("--self-test")) {
    runSelfTest();
    return;
  }
  const { failures, log } = evaluate(readFromRepo);
  console.log(`${TAG}: ${RULES.length} wiring rules`);
  for (const line of log) console.log(line);
  if (failures.length > 0) {
    console.error(`${TAG} FAIL (${failures.length}):\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`${TAG} PASS: paid drafts stop at Publish and the wiring matches what the suites execute`);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
