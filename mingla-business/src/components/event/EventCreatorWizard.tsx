/**
 * EventCreatorWizard — root component for the 7-step event creator.
 *
 * Composes:
 *   - Custom chrome (back/close + Stepper progress + step counter) per
 *     designer screens-creator.jsx:21-72. Wizard does NOT use TopBar
 *     primitive — designer chrome contract (H-CYCLE3-3 documented in
 *     investigation report). Brand context shown as subtitle below
 *     chrome.
 *   - 7 step body components (CreatorStep1Basics .. CreatorStep7Preview)
 *   - Sticky bottom dock with Continue (Steps 1-6) or
 *     Publish event + Preview public page (Step 7)
 *   - Discard ConfirmDialog (create mode only — edit mode auto-saves)
 *   - Publish ConfirmDialog
 *   - PublishErrorsSheet (J-E12)
 *   - In-page Stripe-missing banner (J-E3)
 *
 * State machine per spec §3.4. Edit-mode-discard lock per dispatch:
 * DISCARD_CONFIRMING is reachable ONLY in create mode; edit-mode close
 * is simple back-nav (auto-save semantics).
 *
 * Overlays mount at wizard root JSX (NOT inside step body ScrollView)
 * to honour I-13 overlay-portal contract.
 *
 * Per Cycle 3 spec §3.4 + dispatch internal-inconsistency lock.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  type KeyboardEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  type Brand,
  type BrandStripeStatus,
} from "../../store/currentBrandStore";
import {
  useDraftEventStore,
  type DraftEvent,
} from "../../store/draftEventStore";
import {
  computePublishability,
  validatePublish,
  validateStep,
  type ValidationError,
} from "../../utils/draftEventValidation";
import { expandRecurrenceToDates } from "../../utils/recurrenceRule";

import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { GlassCard } from "../ui/GlassCard";
import { IconChrome } from "../ui/IconChrome";
import { Stepper } from "../ui/Stepper";
import type { StepperStep } from "../ui/Stepper";
import { Toast } from "../ui/Toast";

import { CreatorStep1Basics } from "./CreatorStep1Basics";
import { CreatorStep2When } from "./CreatorStep2When";
import { CreatorStep3Where } from "./CreatorStep3Where";
import { CreatorStep4Cover } from "./CreatorStep4Cover";
import { CreatorStep5Tickets } from "./CreatorStep5Tickets";
import { CreatorStep6Settings } from "./CreatorStep6Settings";
import { CreatorStep7Preview } from "./CreatorStep7Preview";
import { PublishErrorsSheet } from "./PublishErrorsSheet";

const STEP_DEFS: ReadonlyArray<{ title: string; subtitle: string }> = [
  { title: "Basics", subtitle: "Name, format, and category" },
  { title: "When", subtitle: "Date, time, and recurrence" },
  { title: "Where", subtitle: "Venue or online link" },
  { title: "Cover", subtitle: "Pick a cover style" },
  { title: "Tickets", subtitle: "Types, prices, capacity" },
  { title: "Settings", subtitle: "Visibility, approvals, transfers" },
  { title: "Preview", subtitle: "How it looks to guests" },
];

const TOTAL_STEPS = STEP_DEFS.length;

const STEPPER_STEPS: StepperStep[] = STEP_DEFS.map((s, i) => ({
  id: `step-${i}`,
  label: s.title,
}));

export type WizardExitMode = "published" | "discarded" | "abandoned";

export interface EventCreatorWizardProps {
  /** Resolved draft from useDraftById in the route handler. */
  draft: DraftEvent;
  brand: Brand | null;
  /** When 0..6 is provided, wizard opens at that step. Defaults to draft.lastStepReached. */
  initialStep?: number;
  /** True for /event/create flow; false for /event/[id]/edit (resume). Drives chrome icon + discard semantics. */
  isCreateMode: boolean;
  /** Called when wizard exits — caller routes appropriately + shows Toast. */
  onExit: (mode: WizardExitMode, ctx?: { name?: string }) => void;
  /** Push to /event/[id]/preview when user taps mini-card or Preview button. */
  onOpenPreview: () => void;
  /** Push to /brand/[brandId]/payments/onboard when J-E3 path hit. */
  onOpenStripeOnboard: () => void;
}

interface ToastState {
  visible: boolean;
  message: string;
}

export const EventCreatorWizard: React.FC<EventCreatorWizardProps> = ({
  draft: initialDraft,
  brand,
  initialStep,
  isCreateMode,
  onExit,
  onOpenPreview,
  onOpenStripeOnboard,
}) => {
  const insets = useSafeAreaInsets();

  // We re-read draft from store on every render so updateDraft patches
  // are reflected immediately. The `initialDraft` prop is only used for
  // mount-time defaults.
  const liveDraft =
    useDraftEventStore((s) => s.drafts.find((d) => d.id === initialDraft.id)) ??
    initialDraft;
  const updateDraft = useDraftEventStore((s) => s.updateDraft);
  const setLastStep = useDraftEventStore((s) => s.setLastStep);
  const deleteDraft = useDraftEventStore((s) => s.deleteDraft);
  const publishDraft = useDraftEventStore((s) => s.publishDraft);

  const [currentStep, setCurrentStep] = useState<number>(() => {
    const fallback = liveDraft.lastStepReached;
    return initialStep !== undefined && initialStep >= 0 && initialStep < TOTAL_STEPS
      ? initialStep
      : fallback;
  });
  const [showStepErrors, setShowStepErrors] = useState<boolean>(false);
  const [discardDialogVisible, setDiscardDialogVisible] = useState<boolean>(false);
  const [publishConfirmVisible, setPublishConfirmVisible] = useState<boolean>(false);
  const [errorsSheetVisible, setErrorsSheetVisible] = useState<boolean>(false);
  const [pendingErrors, setPendingErrors] = useState<ValidationError[]>([]);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [toast, setToast] = useState<ToastState>({ visible: false, message: "" });
  // Track keyboard state — used to (a) hide the bottom dock during
  // typing so it doesn't take space between focused input and keyboard,
  // (b) apply dynamic paddingBottom to the ScrollView so manual scroll
  // can position bottom-most inputs above the keyboard.
  const [keyboardVisible, setKeyboardVisible] = useState<boolean>(false);
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);

  // ScrollView ref — exposed to step bodies via `scrollToBottom`
  // callback. Bottom-most multiline inputs (Step 1 Description) call
  // this on focus because iOS's `automaticallyAdjustKeyboardInsets`
  // doesn't reliably scroll-to-focused-input for multiline TextInputs
  // in this nested layout (verified by smoke 2026-04-30).
  const scrollViewRef = useRef<ScrollView | null>(null);
  // Deferred scroll-to-bottom — set by step bodies on input focus,
  // consumed in a useEffect once the keyboard has actually risen and
  // the ScrollView's paddingBottom has been applied. Without deferral,
  // scrollToEnd runs against the OLD content height (no padding yet),
  // landing the focused input far above the keyboard with a huge gap.
  const pendingScrollToBottomRef = useRef<boolean>(false);

  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (e: KeyboardEvent): void => {
      setKeyboardVisible(true);
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, (): void => {
      setKeyboardVisible(false);
      setKeyboardHeight(0);
    });
    return (): void => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Mark the wizard's intent to scroll its body to the bottom. The
  // actual scroll runs in a keyboardHeight effect once the keyboard
  // is visible AND the ScrollView's paddingBottom has applied. This
  // avoids a race where scrollToEnd fires before the content has
  // grown to its full keyboard-padded height.
  const scrollToBottom = useCallback((): void => {
    pendingScrollToBottomRef.current = true;
    // If keyboard is already up (rare — e.g. user re-focuses an input
    // while keyboard remains up), scroll immediately.
    if (keyboardHeight > 0) {
      requestAnimationFrame((): void => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      });
    }
  }, [keyboardHeight]);

  // Once the keyboard has risen + paddingBottom has applied, scroll
  // to end if a step body requested it. Reset the flag on keyboard
  // dismiss so a subsequent focus correctly triggers a new scroll.
  useEffect(() => {
    if (keyboardHeight > 0 && pendingScrollToBottomRef.current) {
      // requestAnimationFrame defers one frame so layout has time to
      // recompute against the new paddingBottom; without it, the
      // scrollToEnd uses the previous content height.
      requestAnimationFrame((): void => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      });
    }
    if (keyboardHeight === 0) {
      pendingScrollToBottomRef.current = false;
    }
  }, [keyboardHeight]);

  const stripeStatus: BrandStripeStatus =
    brand?.stripeStatus ?? "not_connected";

  const stepErrors: ValidationError[] = useMemo(
    () => validateStep(currentStep, liveDraft),
    [currentStep, liveDraft],
  );

  // Track that the user has reached this step (for resume semantics).
  useEffect(() => {
    setLastStep(liveDraft.id, currentStep);
  }, [currentStep, liveDraft.id, setLastStep]);

  // One-shot timezone auto-detect for legacy drafts (those created before
  // Cycle 3 rework v2 Fix #4 was shipped — they hold the hardcoded
  // "Europe/London" default). If the device's detected zone differs from
  // London, override the draft's timezone. Users actually in London see
  // no change. Users who manually picked London via the sheet on a
  // non-London device will get overridden — acceptable edge case
  // (negligible likelihood + the sheet picker still allows re-override).
  // Runs once per draft.id mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (liveDraft.timezone !== "Europe/London") return;
    let detected: string | null = null;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      detected = typeof tz === "string" && tz.length > 0 ? tz : null;
    } catch {
      detected = null;
    }
    if (detected !== null && detected !== "Europe/London") {
      updateDraft(liveDraft.id, { timezone: detected });
    }
  }, [liveDraft.id]);

  const handleUpdate = useCallback(
    (patch: Partial<Omit<DraftEvent, "id" | "brandId" | "createdAt">>): void => {
      updateDraft(liveDraft.id, patch);
    },
    [liveDraft.id, updateDraft],
  );

  const handleShowToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const handleDismissToast = useCallback((): void => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  // ---- Navigation handlers ----

  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === TOTAL_STEPS - 1;

  const isDraftPristine = useCallback((): boolean => {
    // "Pristine" = matches DEFAULT_DRAFT_FIELDS apart from id/brand/timestamps.
    return (
      liveDraft.name.length === 0 &&
      liveDraft.description.length === 0 &&
      liveDraft.category === null &&
      liveDraft.date === null &&
      liveDraft.doorsOpen === null &&
      liveDraft.endsAt === null &&
      liveDraft.venueName === null &&
      liveDraft.address === null &&
      liveDraft.onlineUrl === null &&
      liveDraft.tickets.length === 0 &&
      liveDraft.coverHue === 25 &&
      liveDraft.format === "in_person" &&
      liveDraft.visibility === "public" &&
      liveDraft.requireApproval === false &&
      liveDraft.allowTransfers === true &&
      liveDraft.hideRemainingCount === false &&
      liveDraft.passwordProtected === false
    );
  }, [liveDraft]);

  // Chrome "X" — always exits the wizard to the Events tab. Independent
  // of which step the user is on; the dock's Back button handles step
  // navigation. Discard ConfirmDialog still appears in create-mode if
  // the draft has edits.
  const handleClose = useCallback((): void => {
    if (isCreateMode) {
      if (isDraftPristine()) {
        deleteDraft(liveDraft.id);
        onExit("abandoned");
      } else {
        setDiscardDialogVisible(true);
      }
    } else {
      // Edit mode: auto-save semantics — simple exit, no dialog.
      onExit("abandoned");
    }
  }, [isCreateMode, isDraftPristine, deleteDraft, liveDraft.id, onExit]);

  // Dock "Back" button — decrement step. Step 1's dock has no Back
  // (chrome X handles wizard exit instead).
  const handleStepBack = useCallback((): void => {
    setShowStepErrors(false);
    setCurrentStep((prev) => Math.max(0, prev - 1));
  }, []);

  const handleConfirmDiscard = useCallback((): void => {
    deleteDraft(liveDraft.id);
    setDiscardDialogVisible(false);
    onExit("discarded");
  }, [deleteDraft, liveDraft.id, onExit]);

  const handleContinue = useCallback((): void => {
    const errs = validateStep(currentStep, liveDraft);
    if (errs.length > 0) {
      setShowStepErrors(true);
      return;
    }
    // Advance.
    setShowStepErrors(false);
    setCurrentStep((prev) => Math.min(TOTAL_STEPS - 1, prev + 1));
  }, [currentStep, liveDraft]);

  // ---- Publish gate ----

  const handlePublishTap = useCallback((): void => {
    const errs = validatePublish(liveDraft, stripeStatus);
    const stripeBlocking = errs.find((e) => e.fieldKey === "stripeNotConnected");
    const otherErrs = errs.filter((e) => e.fieldKey !== "stripeNotConnected");

    if (otherErrs.length > 0) {
      // J-E12: validation errors path. Sheet opens with full list (Stripe
      // included if also missing — surfaces the full picture, but Fix-jump
      // for stripe routes to step 4 + tickets).
      setPendingErrors(errs);
      setErrorsSheetVisible(true);
      return;
    }
    if (stripeBlocking !== undefined) {
      // J-E3: Stripe-missing path with no other errors. The Step 7 status
      // card already shows the StripeBlockedCard variant; tapping Publish
      // here surfaces the same block as a Toast + leaves the user on Step
      // 7 to tap Connect Stripe via the in-page Step 7 card. We DON'T
      // open the errors sheet for Stripe-only blocking.
      handleShowToast("Connect Stripe to publish paid tickets.");
      return;
    }
    // J-E2: happy path → confirm dialog.
    setPublishConfirmVisible(true);
  }, [liveDraft, stripeStatus, handleShowToast]);

  const handleConfirmPublish = useCallback(async (): Promise<void> => {
    setIsPublishing(true);
    const draftName = liveDraft.name;
    // Simulated 1.2s submit per spec AC#28.
    await new Promise<void>((resolve) => setTimeout(resolve, 1200));
    publishDraft(liveDraft.id);
    setIsPublishing(false);
    setPublishConfirmVisible(false);
    onExit("published", { name: draftName });
  }, [liveDraft.id, liveDraft.name, publishDraft, onExit]);

  const handleFixJump = useCallback((step: number): void => {
    setErrorsSheetVisible(false);
    setShowStepErrors(true);
    setCurrentStep(Math.max(0, Math.min(TOTAL_STEPS - 1, step)));
  }, []);

  const handleConnectStripe = useCallback((): void => {
    onOpenStripeOnboard();
  }, [onOpenStripeOnboard]);

  // Step 7 publishability — drives StripeBlockedCard visibility (in body)
  // and Publish button disabled state (in dock).
  const publishability = useMemo(
    () => computePublishability(liveDraft, stripeStatus),
    [liveDraft, stripeStatus],
  );

  // Cycle 5: Publish button disabled when Stripe is required but not
  // connected. The Stripe-blocked-card in Step 7 body owns the
  // "Connect Stripe" CTA — the dock banner was removed for cleaner UX.
  const publishDisabled = publishability.status === "blocked-stripe";

  // Publish modal copy varies per whenMode (Cycle 4 spec §3.8.2).
  const publishModalTitle = useMemo<string>(() => {
    switch (liveDraft.whenMode) {
      case "single":
        return "Publish event?";
      case "recurring": {
        const count =
          liveDraft.recurrenceRule !== null && liveDraft.date !== null
            ? expandRecurrenceToDates(liveDraft.recurrenceRule, liveDraft.date).length
            : 0;
        return `Publish recurring event? ${count} occurrences will be created.`;
      }
      case "multi_date":
        return `Publish event with ${liveDraft.multiDates?.length ?? 0} dates?`;
    }
  }, [liveDraft.whenMode, liveDraft.recurrenceRule, liveDraft.date, liveDraft.multiDates]);

  // ---- Render step body ----

  const renderStepBody = (): React.ReactElement => {
    const baseProps = {
      draft: liveDraft,
      updateDraft: handleUpdate,
      errors: stepErrors,
      showErrors: showStepErrors,
      onShowToast: handleShowToast,
      scrollToBottom,
    };
    switch (currentStep) {
      case 0:
        return <CreatorStep1Basics {...baseProps} />;
      case 1:
        return <CreatorStep2When {...baseProps} />;
      case 2:
        return <CreatorStep3Where {...baseProps} />;
      case 3:
        return <CreatorStep4Cover {...baseProps} />;
      case 4:
        return <CreatorStep5Tickets {...baseProps} />;
      case 5:
        return <CreatorStep6Settings {...baseProps} />;
      case 6:
        return (
          <CreatorStep7Preview
            {...baseProps}
            brand={brand}
            onTapMiniCard={onOpenPreview}
            onConnectStripe={handleConnectStripe}
          />
        );
      default:
        return <CreatorStep1Basics {...baseProps} />;
    }
  };

  return (
    <View style={[styles.host, { paddingTop: insets.top, backgroundColor: canvas.discover }]}>
      {/* Chrome */}
      <View style={styles.chromeRow}>
        <IconChrome
          icon="close"
          size={36}
          onPress={handleClose}
          accessibilityLabel="Close wizard"
        />
        <View style={styles.stepperWrap}>
          <Stepper
            steps={STEPPER_STEPS}
            currentIndex={currentStep}
            showCaption={false}
          />
        </View>
        <Text style={styles.stepCounter}>
          {currentStep + 1}/{TOTAL_STEPS}
        </Text>
      </View>

      {/* Brand subtitle */}
      <View style={styles.subtitleRow}>
        <Text style={styles.subtitle}>
          {brand?.displayName ?? "Brand"} · Step {currentStep + 1} of {TOTAL_STEPS}
        </Text>
      </View>

      {/* Body — keyboard handling:
          - iOS: relies on the ScrollView's `automaticallyAdjustKeyboardInsets`
            (iOS 14+ native auto-inset). When a TextInput inside the
            ScrollView gains focus, iOS adds a content inset = keyboard
            height and auto-scrolls the focused input into view. No
            KeyboardAvoidingView (which double-padded with this prop and
            left visible bottom space when the keyboard was open).
          - Android: relies on `android:windowSoftInputMode="adjustResize"`
            (Expo default) — system pushes content up natively. */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.kbAvoid}
        contentContainerStyle={[
          styles.body,
          // paddingBottom = keyboard height (no buffer). Combined with
          // a deferred scrollToEnd in the keyboardHeight effect, this
          // lands the focused bottom-most input's bottom edge directly
          // at the keyboard top — no visible gap.
          keyboardHeight > 0 ? { paddingBottom: keyboardHeight } : null,
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        // automaticallyAdjustKeyboardInsets removed — it was adding a
        // SECOND content inset = keyboard height on top of the manual
        // paddingBottom, which doubled the visible space below the
        // focused input. Manual control alone is sufficient now that
        // scrollToEnd is correctly deferred to fire after the
        // paddingBottom applies.
      >
        <Text style={styles.eyebrow}>
          Step {currentStep + 1} of {TOTAL_STEPS}
        </Text>
        <Text style={styles.stepTitle}>{STEP_DEFS[currentStep].title}</Text>
        <Text style={styles.stepSub}>{STEP_DEFS[currentStep].subtitle}</Text>
        <View style={styles.stepBodyWrap}>{renderStepBody()}</View>
      </ScrollView>

      {/* Dock — sleek + compact (rework v3). Tight vertical padding,
          radius xxl for the rounded float, button size md (44 — the
          minimum touch target).
          Hidden when the keyboard is open so the focused input sits
          immediately above the keyboard with no dock occupying space
          between them. Reappears the instant the keyboard dismisses. */}
      {keyboardVisible ? null : (
      <GlassCard
        variant="elevated"
        padding={0}
        radius="xxl"
        style={styles.dock}
      >
        {isLastStep ? (
          // Step 7 — uniform Back + Publish dock. The Stripe-blocked
          // banner was removed from the dock in Cycle 5; the Connect
          // Stripe CTA now lives inside the body's StripeBlockedCard.
          // Publish button is disabled when blocked-stripe so the user
          // is forced to use the body-side CTA before publishing.
          <View style={styles.dockButtonRow}>
            <View style={styles.dockBackCell}>
              <Button
                label="Back"
                variant="ghost"
                size="md"
                leadingIcon="chevL"
                onPress={handleStepBack}
                fullWidth
              />
            </View>
            <View style={styles.dockPublishCell}>
              <Button
                label="Publish event"
                variant="primary"
                size="md"
                onPress={handlePublishTap}
                loading={isPublishing}
                disabled={publishDisabled}
                fullWidth
              />
            </View>
          </View>
        ) : isFirstStep ? (
          // Step 1 has no in-wizard back — chrome close X handles exit.
          <Button
            label="Continue"
            variant="primary"
            size="md"
            onPress={handleContinue}
            fullWidth
          />
        ) : (
          // Step 2-6 — Back + Continue side by side.
          <View style={styles.dockButtonRow}>
            <View style={styles.dockBackCell}>
              <Button
                label="Back"
                variant="ghost"
                size="md"
                onPress={handleStepBack}
                fullWidth
              />
            </View>
            <View style={styles.dockPrimaryCell}>
              <Button
                label="Continue"
                variant="primary"
                size="md"
                onPress={handleContinue}
                fullWidth
              />
            </View>
          </View>
        )}
      </GlassCard>
      )}

      {/* Overlays — at root for I-13 portal contract */}
      <ConfirmDialog
        visible={discardDialogVisible}
        onClose={() => setDiscardDialogVisible(false)}
        onConfirm={handleConfirmDiscard}
        title="Discard this event?"
        description="You'll lose your changes."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
      />

      <ConfirmDialog
        visible={publishConfirmVisible}
        onClose={() => setPublishConfirmVisible(false)}
        onConfirm={handleConfirmPublish}
        title={publishModalTitle}
        description="Public sale starts immediately. You can edit details after publishing."
        confirmLabel="Publish"
      />

      <PublishErrorsSheet
        visible={errorsSheetVisible}
        errors={pendingErrors}
        onClose={() => setErrorsSheetVisible(false)}
        onFix={handleFixJump}
      />

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={handleDismissToast}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  kbAvoid: {
    flex: 1,
  },
  chromeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  stepperWrap: {
    flex: 1,
  },
  stepCounter: {
    fontSize: 12,
    color: textTokens.tertiary,
    fontVariant: ["tabular-nums"],
    minWidth: 28,
    textAlign: "right",
  },
  subtitleRow: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  subtitle: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  body: {
    paddingHorizontal: spacing.md + 8,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: accent.warm,
    marginBottom: 6,
  },
  stepTitle: {
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: textTokens.primary,
    marginBottom: 6,
  },
  stepSub: {
    fontSize: 14,
    color: textTokens.secondary,
    marginBottom: spacing.lg,
  },
  stepBodyWrap: {
    // step body content
  },
  dock: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.lg,
    // Sleek + compact: tight vertical padding, generous horizontal.
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  dockButtonRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  dockBackCell: {
    flex: 1,
  },
  dockPrimaryCell: {
    flex: 1,
  },
  dockPublishCell: {
    flex: 2,
  },
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  // suppress unused
  _unused: {
    color: glass.tint.profileBase,
  },
});
