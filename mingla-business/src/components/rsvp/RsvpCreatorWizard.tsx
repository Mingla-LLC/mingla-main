/**
 * ORCH-1150 — RsvpCreatorWizard — root component for the 6-step RSVP creator.
 *
 * Sibling clone of EventCreatorWizard, money-free. Steps: Basics / When /
 * Where / Cover / RSVP-setup / Preview. NO Tickets step, NO Stripe gate, NO
 * checkout. Publish routes through business_publish_rsvp_draft (never the event
 * publish RPC). Validation via validateRsvpStep / validateRsvpPublish.
 *
 * Reuses CreatorStep1Basics / CreatorStep2When (lockSingleDate) / CreatorStep3Where
 * / CreatorStep4Cover as-is; RsvpStep5Setup + RsvpStep7Preview are new.
 *
 * ORCH-1150: do NOT merge back into the event/ticket wizard. See SPEC §4.2.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. Keyboard listener
// + keyboardVisible/keyboardHeight state + auto-insets DELETED. KAS handles
// focused-input scroll. useKeyboardIsVisible() preserves dock-hide UX.
// Keyboard import retained for Keyboard.dismiss(). Per SPEC §7.F.
import { ScrollView } from "../../wrappers/SmartScrollView";
import { useKeyboardIsVisible } from "../../wrappers/useKeyboardIsVisible";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  canvas,
  glass,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  DESKTOP_BEZEL_MARGIN,
  DESKTOP_RAIL_WIDTH,
  DESKTOP_TOP_INSET,
  DESKTOP_WIZARD_FORM_MAX_WIDTH,
  DESKTOP_WIZARD_RAIL_WIDTH,
} from "../../constants/desktopLayout";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { type Brand } from "../../store/currentBrandStore";
import {
  useDraftEventStore,
  type DraftEvent,
} from "../../store/draftEventStore";
import {
  validateRsvpPublish,
  validateRsvpStep,
} from "../../utils/draftRsvpValidation";
import type { ValidationError } from "../../utils/draftEventValidation";
import { isDraftEventPristine } from "../../utils/draftEventPristine";
import { resolvePaidPublishGuardCopy } from "../../utils/paidPublishGuards";

import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { IconChrome } from "../ui/IconChrome";
import { Stepper } from "../ui/Stepper";
import type { StepperStep } from "../ui/Stepper";
import { TopBar } from "../ui/TopBar";
import { Toast } from "../ui/Toast";

/*
 * Desktop web wizard contract restored after regression:
 * useResponsiveLayout / isWideDesktop gate must protect the desktop-only
 * shell, renderDesktopAppRail, renderDesktopStepRail, desktopShell,
 * desktopTopBarWrap, desktopStepRail, desktopFormPane,
 * DESKTOP_RAIL_WIDTH, DESKTOP_TOP_INSET, DESKTOP_WIZARD_RAIL_WIDTH,
 * DESKTOP_WIZARD_FORM_MAX_WIDTH, and <TopBar leftKind="brand" />.
 * The mobile Stepper/chromeRow path must remain mobile/narrow-web only.
 */

import { CreatorStep1Basics } from "../event/CreatorStep1Basics";
import { CreatorStep2When } from "../event/CreatorStep2When";
import { CreatorStep3Where } from "../event/CreatorStep3Where";
import { CreatorStep4Cover } from "../event/CreatorStep4Cover";
import { PublishErrorsSheet } from "../event/PublishErrorsSheet";
import { RsvpStep5Setup } from "./RsvpStep5Setup";
import { RsvpStep7Preview } from "./RsvpStep7Preview";

const STEP_DEFS: readonly { title: string; subtitle: string }[] = [
  { title: "Basics", subtitle: "Name, format, and party type" },
  { title: "When", subtitle: "Date and time" },
  { title: "Where", subtitle: "Venue or online link" },
  { title: "Cover", subtitle: "Pick a cover style" },
  { title: "RSVP", subtitle: "Capacity, plus-ones, approvals" },
  { title: "Preview", subtitle: "How it looks to guests" },
];

const TOTAL_STEPS = STEP_DEFS.length;

const STEPPER_STEPS: StepperStep[] = STEP_DEFS.map((s, i) => ({
  id: `step-${i}`,
  label: s.title,
}));

const MINGLA_BUSINESS_LOGO = require("../../../assets/brand/mingla-business-logo.png") as number;
const DESKTOP_WIZARD_NAV_ITEMS = [
  { label: "Home", icon: "home", href: "/(tabs)/home", active: false },
  { label: "Hub", icon: "calendar", href: "/(tabs)/hub/events", active: true },
  { label: "Ari", icon: "sparkle", href: "/(tabs)/ari", active: false },
  { label: "Blast", icon: "send", href: "/(tabs)/marketing", active: false },
] as const;

const isLocalOnlyDraft = (draft: DraftEvent): boolean =>
  draft.id.startsWith("d_") || draft.serverSlug === null;

const discardErrorMessage = (error: unknown): string => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (message.includes("insufficient_event_permission")) {
    return "You do not have permission to delete this draft for this brand.";
  }
  return "Could not delete draft. Try again.";
};

export type WizardExitMode = "published" | "discarded" | "abandoned";

/** Slug pair returned to the route handler so it can navigate to the
 * public event page after a successful publish (Cycle 6). */
export interface PublishedEventSlug {
  brandSlug: string;
  eventSlug: string;
}

export interface RsvpCreatorWizardProps {
  /** Resolved draft from useDraftById in the route handler. */
  draft: DraftEvent;
  brand: Brand | null;
  /** When 0..5 is provided, wizard opens at that step. Defaults to draft.lastStepReached. */
  initialStep?: number;
  /** True for /rsvp/create flow; false for /rsvp/[id]/edit (resume). */
  isCreateMode: boolean;
  /** Called when wizard exits — caller routes appropriately + shows Toast. */
  onExit: (
    mode: WizardExitMode,
    ctx?: { name?: string; slug?: PublishedEventSlug },
  ) => void;
  /** Push to /rsvp/[id]/preview when user taps mini-card or Preview button. */
  onOpenPreview: () => void;
  /** ORCH-1150 — INERT for RSVP (no money gate). Kept optional for route-shape
   *  parity with the event wizard; never invoked. */
  onOpenStripeOnboard?: () => void;
  onAutosaveDraft?: (draft: DraftEvent) => void;
  onDiscardServerDraft?: (draft: DraftEvent) => Promise<void>;
  onPublishDraft?: (draft: DraftEvent) => Promise<PublishedEventSlug>;
  serverSaveState?: {
    isSaving: boolean;
    hasError: boolean;
    lastSavedAt: string | null;
  };
}

interface ToastState {
  visible: boolean;
  message: string;
}

export const RsvpCreatorWizard: React.FC<RsvpCreatorWizardProps> = ({
  draft: initialDraft,
  brand,
  initialStep,
  isCreateMode,
  onExit,
  onOpenPreview,
  onAutosaveDraft,
  onDiscardServerDraft,
  onPublishDraft,
  serverSaveState,
}) => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();

  // We re-read draft from store on every render so updateDraft patches
  // are reflected immediately. The `initialDraft` prop is only used for
  // mount-time defaults.
  const liveDraft =
    useDraftEventStore((s) => s.drafts.find((d) => d.id === initialDraft.id)) ??
    initialDraft;
  const updateDraft = useDraftEventStore((s) => s.updateDraft);
  const setLastStep = useDraftEventStore((s) => s.setLastStep);
  const deleteDraft = useDraftEventStore((s) => s.deleteDraft);
  const beginDraftEdit = useDraftEventStore((s) => s.beginDraftEdit);
  const endDraftEdit = useDraftEventStore((s) => s.endDraftEdit);
  const markDraftDirty = useDraftEventStore((s) => s.markDraftDirty);

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
  const [isDiscarding, setIsDiscarding] = useState<boolean>(false);
  const [coverVideoProcessing, setCoverVideoProcessing] = useState<boolean>(false);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>({ visible: false, message: "" });
  // Track keyboard state — used to (a) hide the bottom dock during
  // typing so it doesn't take space between focused input and keyboard,
  // (b) apply dynamic paddingBottom to the ScrollView so manual scroll
  // can position bottom-most inputs above the keyboard.
  // ORCH-0892-B v2: keyboardVisible/keyboardHeight state DELETED.
  // useKeyboardIsVisible() preserves dock-hide UX (line ~915). KAS via
  // SmartScrollView handles focused-input scroll.
  const keyboardVisible = useKeyboardIsVisible();
  const latestDraftRef = useRef<DraftEvent>(liveDraft);
  const clientRevisionRef = useRef<number>(liveDraft.clientRevision ?? 0);
  const lastStepSyncKeyRef = useRef<string | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latestDraftRef.current = liveDraft;
    clientRevisionRef.current = Math.max(
      clientRevisionRef.current,
      liveDraft.clientRevision ?? 0,
    );
  }, [liveDraft]);

  useEffect(() => {
    beginDraftEdit(initialDraft.id);
    return (): void => {
      endDraftEdit(initialDraft.id);
    };
  }, [beginDraftEdit, endDraftEdit, initialDraft.id]);

  useEffect(() => {
    return (): void => {
      if (autosaveTimerRef.current !== null) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

  const queueAutosave = useCallback(
    (draft: DraftEvent): void => {
      if (onAutosaveDraft === undefined) return;
      if (autosaveTimerRef.current !== null) {
        clearTimeout(autosaveTimerRef.current);
      }
      autosaveTimerRef.current = setTimeout(() => {
        autosaveTimerRef.current = null;
        onAutosaveDraft(draft);
      }, 700);
    },
    [onAutosaveDraft],
  );

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

  // ORCH-0892-B v2: keyboard listener + keyboardHeight-driven
  // scrollToBottom plumbing DELETED. KAS via SmartScrollView computes
  // focused-input overlap and scrolls precisely above the keyboard
  // automatically. scrollToBottom is preserved as a passthrough so
  // child components (CreatorStep1Basics on Description focus, etc.)
  // can still request a scrollToEnd explicitly — KAS's per-focus
  // scroll then refines from that position. pendingScrollToBottomRef
  // retained as a kept-for-future hook; safe no-op when unused.
  const scrollToBottom = useCallback((): void => {
    requestAnimationFrame((): void => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  // ORCH-1150 — RSVP is moneyless: no Stripe/payout gate.
  const stepErrors: ValidationError[] = useMemo(
    () => validateRsvpStep(currentStep, liveDraft),
    [currentStep, liveDraft],
  );

  // Track that the user has reached this step (for resume semantics).
  useEffect(() => {
    const cached = useDraftEventStore.getState().getDraft(liveDraft.id);
    const base = cached ?? latestDraftRef.current;
    const nextLastStep = Math.max(base.lastStepReached, currentStep);
    const syncKey = `${liveDraft.id}:${nextLastStep}`;
    if (lastStepSyncKeyRef.current === syncKey) {
      return;
    }
    lastStepSyncKeyRef.current = syncKey;
    setLastStep(liveDraft.id, currentStep);
    if (base.lastStepReached >= currentStep) {
      return;
    }
    const nextRevision = clientRevisionRef.current + 1;
    clientRevisionRef.current = nextRevision;
    markDraftDirty(liveDraft.id, nextRevision);
    updateDraft(liveDraft.id, { clientRevision: nextRevision });
    queueAutosave({
      ...base,
      lastStepReached: nextLastStep,
      clientRevision: nextRevision,
      updatedAt: new Date().toISOString(),
    });
  }, [
    currentStep,
    liveDraft.id,
    markDraftDirty,
    queueAutosave,
    setLastStep,
    updateDraft,
  ]);

  // One-shot timezone auto-detect for legacy drafts (those created before
  // Cycle 3 rework v2 Fix #4 was shipped — they hold the hardcoded
  // "Europe/London" default). If the device's detected zone differs from
  // London, override the draft's timezone. Users actually in London see
  // no change. Users who manually picked London via the sheet on a
  // non-London device will get overridden — acceptable edge case
  // (negligible likelihood + the sheet picker still allows re-override).
  // Runs once per draft.id mount.
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
  }, [liveDraft.id, liveDraft.timezone, updateDraft]);

  const handleUpdate = useCallback(
    (patch: Partial<Omit<DraftEvent, "id" | "brandId" | "createdAt">>): void => {
      const nextRevision = clientRevisionRef.current + 1;
      clientRevisionRef.current = nextRevision;
      const revisionedPatch = {
        ...patch,
        clientRevision: nextRevision,
      };
      markDraftDirty(liveDraft.id, nextRevision);
      updateDraft(liveDraft.id, revisionedPatch);
      const nextDraft = {
        ...liveDraft,
        ...revisionedPatch,
        updatedAt: new Date().toISOString(),
      };
      latestDraftRef.current = nextDraft;
      queueAutosave(nextDraft);
    },
    [liveDraft, markDraftDirty, queueAutosave, updateDraft],
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
    return isDraftEventPristine(liveDraft);
  }, [liveDraft]);

  const discardDraft = useCallback(
    async (draft: DraftEvent): Promise<void> => {
      if (autosaveTimerRef.current !== null) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      if (isLocalOnlyDraft(draft) || onDiscardServerDraft === undefined) {
        deleteDraft(draft.id);
        return;
      }
      await onDiscardServerDraft(draft);
    },
    [deleteDraft, onDiscardServerDraft],
  );

  // Chrome "X" — always exits the wizard to the Events tab. Independent
  // of which step the user is on; the dock's Back button handles step
  // navigation. Discard ConfirmDialog still appears in create-mode if
  // the draft has edits.
  const handleClose = useCallback((): void => {
    if (isCreateMode) {
      if (isDraftPristine()) {
        void (async (): Promise<void> => {
          try {
            await discardDraft(liveDraft);
            onExit("abandoned");
          } catch (error) {
            handleShowToast(discardErrorMessage(error));
          }
        })();
      } else {
        setDiscardError(null);
        setDiscardDialogVisible(true);
      }
    } else {
      // Edit mode: auto-save semantics — simple exit, no dialog.
      onExit("abandoned");
    }
  }, [
    isCreateMode,
    isDraftPristine,
    discardDraft,
    liveDraft,
    onExit,
    handleShowToast,
  ]);

  // Dock "Back" button — decrement step. Step 1's dock has no Back
  // (chrome X handles wizard exit instead).
  const handleStepBack = useCallback((): void => {
    setShowStepErrors(false);
    setCurrentStep((prev) => Math.max(0, prev - 1));
  }, []);

  const handleCloseDiscardDialog = useCallback((): void => {
    if (isDiscarding) return;
    setDiscardDialogVisible(false);
    setDiscardError(null);
  }, [isDiscarding]);

  const handleConfirmDiscard = useCallback(async (): Promise<void> => {
    setDiscardError(null);
    setIsDiscarding(true);
    try {
      await discardDraft(liveDraft);
      setDiscardDialogVisible(false);
      onExit("discarded");
    } catch (error) {
      setDiscardError(discardErrorMessage(error));
    } finally {
      setIsDiscarding(false);
    }
  }, [discardDraft, liveDraft, onExit]);

  const handleContinue = useCallback((): void => {
    const errs = validateRsvpStep(currentStep, liveDraft);
    if (errs.length > 0) {
      setShowStepErrors(true);
      return;
    }
    // Advance.
    setShowStepErrors(false);
    setCurrentStep((prev) => Math.min(TOTAL_STEPS - 1, prev + 1));
  }, [currentStep, liveDraft]);

  // ---- Publish gate (no Stripe — RSVP is moneyless) ----

  const handlePublishTap = useCallback((): void => {
    const errs = validateRsvpPublish(liveDraft);
    if (errs.length > 0) {
      setPendingErrors(errs);
      setErrorsSheetVisible(true);
      return;
    }
    // Happy path → confirm dialog.
    setPublishConfirmVisible(true);
  }, [liveDraft]);

  const handleConfirmPublish = useCallback(async (): Promise<void> => {
    if (isPublishing) return;
    setIsPublishing(true);
    const draftName = liveDraft.name;
    // Simulated 1.2s submit per spec AC#28.
    await new Promise<void>((resolve) => setTimeout(resolve, 1200));
    if (onPublishDraft === undefined) {
      setIsPublishing(false);
      setPublishConfirmVisible(false);
      handleShowToast("Could not publish this draft yet. Try again.");
      return;
    }
    const draftToPublish = latestDraftRef.current;
    try {
      if (autosaveTimerRef.current !== null) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      const slug = await onPublishDraft(draftToPublish);
      deleteDraft(draftToPublish.id);
      setIsPublishing(false);
      setPublishConfirmVisible(false);
      onExit("published", {
        name: draftName,
        slug,
      });
    } catch (error) {
      setIsPublishing(false);
      setPublishConfirmVisible(false);
      // ORCH-1075 — paid-publish integrity guards. The publish RPC raises
      // stripe_charges_disabled / offering_date_past on error.message; surface
      // the locked copy + route (Stripe onboarding / When step) instead of a
      // generic failure.
      const code = error instanceof Error ? error.message : String(error ?? "");
      // RSVP only ever raises offering_date_past (discoverable + past date) —
      // never a stripe gate. Map it to a When-step jump (mirror Guard B).
      const guardCopy = resolvePaidPublishGuardCopy(code);
      if (guardCopy !== null && guardCopy.action !== "stripe_onboarding") {
        handleShowToast(guardCopy.body);
        setShowStepErrors(true);
        setCurrentStep(1);
        return;
      }
      if (code.includes("offering_date_past")) {
        handleShowToast("A discoverable RSVP needs a future date. Update the date to publish.");
        setShowStepErrors(true);
        setCurrentStep(1);
        return;
      }
      handleShowToast("Could not save this publish. Try again.");
    }
  }, [
    liveDraft,
    isPublishing,
    onExit,
    onPublishDraft,
    deleteDraft,
    handleShowToast,
  ]);

  const handleFixJump = useCallback((step: number): void => {
    setErrorsSheetVisible(false);
    setShowStepErrors(true);
    setCurrentStep(Math.max(0, Math.min(TOTAL_STEPS - 1, step)));
  }, []);

  // RSVP publish is gated ONLY on a still-processing cover video (no Stripe gate).
  const publishDisabled = coverVideoProcessing;

  // Single-date only (steering #4) → static modal copy.
  const publishModalTitle = "Publish RSVP?";

  // ---- Render step body ----

  const renderStepBody = (): React.ReactElement => {
    const baseProps = {
      draft: liveDraft,
      updateDraft: handleUpdate,
      errors: stepErrors,
      showErrors: showStepErrors,
      onShowToast: handleShowToast,
      scrollToBottom,
      coverMediaEventId: liveDraft.id,
      brandDefaultCurrency: brand?.defaultCurrency ?? null,
      coverMediaApplyMode: "draft_auto" as const,
      onCoverVideoProcessingChange: setCoverVideoProcessing,
    };
    switch (currentStep) {
      case 0:
        return <CreatorStep1Basics {...baseProps} />;
      case 1:
        // ORCH-1150 — lockSingleDate hides the recurring/multi_date tabs.
        return <CreatorStep2When {...baseProps} lockSingleDate />;
      case 2:
        return <CreatorStep3Where {...baseProps} />;
      case 3:
        return <CreatorStep4Cover {...baseProps} />;
      case 4:
        return <RsvpStep5Setup {...baseProps} />;
      case 5:
        return (
          <RsvpStep7Preview
            {...baseProps}
            brand={brand}
            onTapMiniCard={onOpenPreview}
          />
        );
      default:
        return <CreatorStep1Basics {...baseProps} />;
    }
  };

  const handleDesktopRailNavigate = useCallback(
    (href: string): void => {
      router.replace(href as never);
    },
    [router],
  );

  const renderDesktopAppRail = (): React.ReactElement => (
    <View style={styles.desktopAppRail}>
      <View style={styles.desktopRailBrandMark}>
        <Image
          source={MINGLA_BUSINESS_LOGO}
          style={styles.desktopRailLogo}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </View>
      {DESKTOP_WIZARD_NAV_ITEMS.map((item) => (
        <Pressable
          key={item.label}
          onPress={() => handleDesktopRailNavigate(item.href)}
          accessibilityRole="button"
          accessibilityLabel={`Go to ${item.label}`}
          style={[
            styles.desktopRailItem,
            item.active ? styles.desktopRailItemActive : null,
          ]}
        >
          <Icon
            name={item.icon}
            size={22}
            color={item.active ? accent.warm : textTokens.tertiary}
          />
          <Text
            style={[
              styles.desktopRailItemText,
              item.active ? styles.desktopRailItemTextActive : null,
            ]}
          >
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  const renderDesktopStepRail = (): React.ReactElement => (
    <GlassCard
      variant="base"
      padding={spacing.md}
      radius="lg"
      style={styles.desktopStepRail}
    >
      <View style={styles.desktopStepRailHeader}>
        <Text style={styles.desktopStepEyebrow}>Create RSVP</Text>
        <Text style={styles.desktopStepRailTitle} numberOfLines={2}>
          {liveDraft.name.trim().length > 0 ? liveDraft.name : "Untitled RSVP"}
        </Text>
        <Text style={styles.desktopStepRailSub} numberOfLines={1}>
          {brand?.displayName ?? "Brand"} · Draft saved
        </Text>
      </View>
      <View style={styles.desktopStepList}>
        {STEP_DEFS.map((step, index) => {
          const active = index === currentStep;
          return (
            <View
              key={step.title}
              style={[styles.desktopStepItem, active ? styles.desktopStepItemActive : null]}
            >
              <View
                style={[
                  styles.desktopStepIndex,
                  active ? styles.desktopStepIndexActive : null,
                ]}
              >
                <Text
                  style={[
                    styles.desktopStepIndexText,
                    active ? styles.desktopStepIndexTextActive : null,
                  ]}
                >
                  {index + 1}
                </Text>
              </View>
              <View style={styles.desktopStepCopy}>
                <Text
                  style={[
                    styles.desktopStepTitle,
                    active ? styles.desktopStepTitleActive : null,
                  ]}
                  numberOfLines={1}
                >
                  {step.title}
                </Text>
                <Text style={styles.desktopStepSub} numberOfLines={1}>
                  {step.subtitle}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </GlassCard>
  );

  return (
    <View
      style={[
        styles.host,
        {
          paddingTop: isWideDesktop ? 0 : insets.top,
          backgroundColor: canvas.discover,
        },
      ]}
    >
      {isWideDesktop ? renderDesktopAppRail() : null}
      {/* Chrome */}
      {isWideDesktop ? (
        <View style={styles.desktopTopBarWrap}>
          {/* orch-strict-grep-allow leftKind-brand-rightSlot — wizard chrome replaces (not composes with) the primary-tab [search,bell] cluster; default cluster is semantically wrong inside a modal creator. Per ORCH-0894 desktop layout polish. */}
          <TopBar
            leftKind="brand"
            rightSlot={
              <IconChrome
                icon="close"
                size={36}
                onPress={handleClose}
                accessibilityLabel="Close wizard"
              />
            }
          />
        </View>
      ) : (
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
      )}

      {/* Brand subtitle */}
      {isWideDesktop ? null : (
      <View style={styles.subtitleRow}>
        <Text style={styles.subtitle}>
          {brand?.displayName ?? "Brand"} · Step {currentStep + 1} of {TOTAL_STEPS}
        </Text>
        {serverSaveState !== undefined ? (
          <Text
            style={[
              styles.saveState,
              serverSaveState.hasError ? styles.saveStateError : null,
            ]}
          >
            {serverSaveState.hasError
              ? "Unsaved changes - retrying"
              : serverSaveState.isSaving
                ? "Saving..."
                : serverSaveState.lastSavedAt !== null
                  ? "Saved"
                  : "Server draft"}
          </Text>
        ) : null}
      </View>
      )}

      <View style={isWideDesktop ? styles.desktopShell : styles.mobileShell}>
        {isWideDesktop ? renderDesktopStepRail() : null}
        <View style={isWideDesktop ? styles.desktopFormPane : styles.mobileFormPane}>

      {/* ORCH-0892-B v2: SmartScrollView (KAS on native) computes precise
          overlap between focused TextInput bottom edge and keyboard top,
          and scrolls exactly that amount. Replaces the old
          automaticallyAdjustKeyboardInsets + paddingBottom-overshoot
          approach which was unreliable in nested layouts. Chrome (chromeRow
          + subtitleRow + dock) renders OUTSIDE this ScrollView so it stays
          stationary. Per SPEC §7.F. */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.kbAvoid}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
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
        style={[styles.dock, { marginBottom: insets.bottom + spacing.lg }]}
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
                label="Publish RSVP"
                variant="primary"
                size="md"
                onPress={handlePublishTap}
                loading={isPublishing}
                disabled={publishDisabled || isPublishing}
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
        </View>
      </View>

      {/* Overlays — at root for I-13 portal contract */}
      <ConfirmDialog
        visible={discardDialogVisible}
        onClose={handleCloseDiscardDialog}
        onConfirm={handleConfirmDiscard}
        title="Discard this RSVP?"
        description="You'll lose your changes."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        confirmLoading={isDiscarding}
        confirmDisabled={isDiscarding}
        closeDisabled={isDiscarding}
        errorMessage={discardError}
        destructive
      />

      <ConfirmDialog
        visible={publishConfirmVisible}
        onClose={() => setPublishConfirmVisible(false)}
        onConfirm={handleConfirmPublish}
        title={publishModalTitle}
        description="Your invite link goes live immediately. Guests can RSVP right away. You can edit details after publishing."
        confirmLabel="Publish"
        confirmLoading={isPublishing}
        confirmDisabled={isPublishing}
        closeDisabled={isPublishing}
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
  mobileShell: {
    flex: 1,
  },
  mobileFormPane: {
    flex: 1,
  },
  desktopAppRail: {
    position: "absolute",
    zIndex: 20,
    elevation: 20,
    top: 0,
    left: 0,
    bottom: 0,
    width: DESKTOP_RAIL_WIDTH,
    alignItems: "center",
    paddingTop: spacing.xl,
    gap: spacing.sm,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "rgba(255, 255, 255, 0.06)",
  },
  desktopRailBrandMark: {
    width: 42,
    height: 42,
    marginBottom: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  desktopRailLogo: {
    width: 42,
    height: 42,
  },
  desktopRailItem: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
  },
  desktopRailItemActive: {
    backgroundColor: "rgba(255, 255, 255, 0.055)",
    borderColor: "rgba(235, 120, 37, 0.45)",
  },
  desktopRailItemText: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: "700",
    color: textTokens.tertiary,
  },
  desktopRailItemTextActive: {
    color: accent.warm,
  },
  desktopTopBarWrap: {
    paddingTop: DESKTOP_TOP_INSET,
    paddingLeft: DESKTOP_RAIL_WIDTH + DESKTOP_BEZEL_MARGIN,
    paddingRight: DESKTOP_BEZEL_MARGIN,
    paddingBottom: spacing.sm,
  },
  desktopShell: {
    flex: 1,
    flexDirection: "row",
    gap: spacing.md,
    paddingLeft: DESKTOP_RAIL_WIDTH + DESKTOP_BEZEL_MARGIN,
    paddingRight: DESKTOP_BEZEL_MARGIN,
    paddingBottom: DESKTOP_BEZEL_MARGIN,
  },
  desktopStepRail: {
    width: DESKTOP_WIZARD_RAIL_WIDTH,
    flexShrink: 0,
  },
  desktopStepRailHeader: {
    marginBottom: spacing.lg,
  },
  desktopStepEyebrow: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: accent.warm,
    marginBottom: spacing.sm,
  },
  desktopStepRailTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  desktopStepRailSub: {
    marginTop: spacing.xs,
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  desktopStepList: {
    gap: spacing.sm,
  },
  desktopStepItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 12,
  },
  desktopStepItemActive: {
    backgroundColor: "rgba(235, 120, 37, 0.18)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(235, 120, 37, 0.45)",
  },
  desktopStepIndex: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileBase,
  },
  desktopStepIndexActive: {
    backgroundColor: accent.warm,
  },
  desktopStepIndexText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "800",
    color: textTokens.tertiary,
  },
  desktopStepIndexTextActive: {
    color: textTokens.inverse,
  },
  desktopStepCopy: {
    flex: 1,
    minWidth: 0,
  },
  desktopStepTitle: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
    color: textTokens.tertiary,
  },
  desktopStepTitleActive: {
    color: textTokens.primary,
  },
  desktopStepSub: {
    marginTop: 2,
    fontSize: typography.caption.fontSize,
    color: textTokens.quaternary,
  },
  desktopFormPane: {
    flex: 1,
    maxWidth: DESKTOP_WIZARD_FORM_MAX_WIDTH,
    minWidth: 0,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.08)",
    backgroundColor: "rgba(255, 255, 255, 0.018)",
    overflow: "hidden",
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
  saveState: {
    marginTop: 2,
    fontSize: typography.caption.fontSize,
    color: textTokens.quaternary,
  },
  saveStateError: {
    color: semantic.error,
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
    // marginBottom is applied inline as insets.bottom + spacing.lg so the
    // floating dock clears the phone's bottom nav / home-indicator on both
    // Android gesture-nav and iOS (META-ORCH-1059 Sub-A footer-bleed fix).
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
