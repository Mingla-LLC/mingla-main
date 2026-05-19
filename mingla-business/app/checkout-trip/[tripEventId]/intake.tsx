/**
 * ORCH-0880 [Tr5 Traveler Intake Forms] — buyer-fill intake route.
 *
 * Route: /checkout-trip/{tripEventId}/intake
 *
 * Position in chain: buyer.tsx → intake.tsx (when schemas exist) → payment.tsx
 *
 * ANON-TOLERANT per `feedback_anon_buyer_routes.md` — NO useAuth import,
 * NO sign-in redirect. Buyer email arrives via cart.buyer from buyer.tsx.
 *
 * Multi-tier flow: when buyer's cart contains 2+ tiers with schemas, the
 * page steps through one tier's form at a time. Internal section eyebrow
 * shows "{TIER_NAME} TICKET · FORM N OF TOTAL" + progress dots. Continue
 * advances to next tier OR /payment when last tier complete. Header pill
 * stays at "3 OF 4" regardless of internal tier count.
 *
 * Validation:
 *   - On Continue tap: validateAnswerAgainstSchema for the active tier;
 *     if any required questions missing → validation summary banner at top
 *     + per-question inline error + scroll to first missing question.
 *   - On Continue success: commit answers to CartContext.intakeFormData[tier]
 *     + persist to AsyncStorage 7-day TTL draft + advance.
 *
 * AsyncStorage draft key per tier per buyer-email:
 *   `tr5_intake_draft_${eventId}_${ticketTypeId}_${buyerEmail}`
 *
 * Abandonment recovery: on mount, scan AsyncStorage for any draft matching
 * the current eventId + buyer.email + ANY active-cart tier-id; if found
 * + not expired, restore into local state + show recovery toast.
 *
 * Header is inline (NOT CheckoutHeader from ORCH-0876 V2) because that
 * primitive's stepIndex prop is locked to 0|1|2 + totalSteps:3 — Tr5 needs
 * "3 OF 4". Inline header mirrors CheckoutHeader's visual structure exactly.
 *
 * Composes IntakeFormRenderer + IntakeQuestionShell + GlassCard + Icon +
 * IconChrome + Pill + Toast. No new primitives.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { KeyboardEvent } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { useCart, useCartTotals } from "../../../src/components/checkout/CartContext";
import { useTripIntakeSchemasByEvent } from "../../../src/hooks/useIntakeSchema";
import { usePublicTripById } from "../../../src/hooks/usePublicTripById";
import { projectInstallmentSchedule } from "../../../src/utils/installmentScheduleProjection";
import { InstallmentScheduleDisplay } from "../../../src/components/trip/InstallmentScheduleDisplay";
import {
  uploadIntakeFile,
  validateAnswerAgainstSchema,
  type IntakeAnswerValue,
  type IntakeFormData,
  type IntakeSchema,
} from "../../../src/services/intakeSchemaService";
import { Button } from "../../../src/components/ui/Button";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Icon } from "../../../src/components/ui/Icon";
import { IconChrome } from "../../../src/components/ui/IconChrome";
import { Toast } from "../../../src/components/ui/Toast";
import {
  IntakeFormRenderer,
} from "../../../src/components/checkout/intake/IntakeQuestionRenderers";

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface DraftEnvelope {
  schema_version_id: string;
  answers: Record<string, IntakeAnswerValue>;
  saved_at: number;
}

function draftKey(eventId: string, ticketTypeId: string, buyerEmail: string): string {
  return `tr5_intake_draft_${eventId}_${ticketTypeId}_${buyerEmail.toLowerCase()}`;
}

export default function TripIntakeScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ tripEventId?: string }>();
  const tripEventId =
    typeof params.tripEventId === "string" ? params.tripEventId : null;

  const { lines, buyer, intakeFormData, setIntakeTierData } = useCart();
  const totals = useCartTotals();

  const schemasQuery = useTripIntakeSchemasByEvent(tripEventId ?? "", {
    enabled: tripEventId !== null,
  });

  // ORCH-0882 [Render Payment Plan Disclosure on Trip Buyer + Planner
  // Surfaces] — surface the deposit + installment schedule above the
  // intake forms so buyers see what they'll be agreeing to pay while
  // they fill required questions. Per SPEC Q3: aggregate = FIRST
  // plan-active tier in cart. Component returns null when no cart line
  // has a plan.
  const publicTripQuery = usePublicTripById(tripEventId);
  const projectedSchedule = useMemo(() => {
    const trip = publicTripQuery.data?.trip;
    if (trip === undefined) return null;
    for (const line of lines) {
      const sourceTier = trip.pricingTiers.find(
        (t) => t.ticketTypeId === line.ticketTypeId,
      );
      if (
        sourceTier !== undefined &&
        sourceTier.installmentSchedule !== null &&
        line.quantity >= 1
      ) {
        // ORCH-0882 hotfix-2 — pass line.quantity so disclosure scales
        // with cart (€500/tier × qty=2 → €250 deposit, not €125).
        return projectInstallmentSchedule(
          sourceTier,
          new Date(),
          line.quantity,
        );
      }
    }
    return null;
  }, [publicTripQuery.data, lines]);

  // Determine which cart tiers have schemas. Stable order matching cart line order.
  const tiersWithSchemas = useMemo<
    Array<{ ticketTypeId: string; tierName: string; schema: IntakeSchema }>
  >(() => {
    if (schemasQuery.data === undefined) return [];
    const out: Array<{
      ticketTypeId: string;
      tierName: string;
      schema: IntakeSchema;
    }> = [];
    for (const line of lines) {
      const schema = schemasQuery.data.get(line.ticketTypeId);
      if (schema !== undefined && schema.questions.length > 0) {
        out.push({
          ticketTypeId: line.ticketTypeId,
          tierName: line.ticketName,
          schema,
        });
      }
    }
    return out;
  }, [schemasQuery.data, lines]);

  const totalTiers = tiersWithSchemas.length;
  const [tierIdx, setTierIdx] = useState<number>(0);
  const activeTier = tiersWithSchemas[tierIdx] ?? null;

  // Per-tier local answer state. Keyed by ticketTypeId so switching tiers
  // doesn't lose in-progress answers.
  const [answersByTier, setAnswersByTier] = useState<
    Record<string, Record<string, IntakeAnswerValue>>
  >({});
  const [validationByTier, setValidationByTier] = useState<
    Record<string, Record<string, string>>
  >({});
  const [showValidationBanner, setShowValidationBanner] =
    useState<boolean>(false);
  const [recoveryToast, setRecoveryToast] = useState<boolean>(false);

  // ---- AsyncStorage draft restore ---------------------------------------
  const restoredRef = useRef<boolean>(false);
  useEffect(() => {
    if (restoredRef.current) return;
    if (tiersWithSchemas.length === 0 || tripEventId === null) return;
    if (buyer.email.length === 0) return;

    void (async (): Promise<void> => {
      let anyRestored = false;
      const restored: Record<string, Record<string, IntakeAnswerValue>> = {};
      for (const t of tiersWithSchemas) {
        try {
          const raw = await AsyncStorage.getItem(
            draftKey(tripEventId, t.ticketTypeId, buyer.email),
          );
          if (raw === null) continue;
          const env = JSON.parse(raw) as DraftEnvelope;
          if (Date.now() - env.saved_at > DRAFT_TTL_MS) {
            // Expired — clean up.
            await AsyncStorage.removeItem(
              draftKey(tripEventId, t.ticketTypeId, buyer.email),
            );
            continue;
          }
          if (env.schema_version_id !== t.schema.schema_version_id) {
            // Schema changed since draft saved — drop the draft and let
            // the buyer re-fill against the current schema.
            await AsyncStorage.removeItem(
              draftKey(tripEventId, t.ticketTypeId, buyer.email),
            );
            continue;
          }
          restored[t.ticketTypeId] = env.answers;
          anyRestored = true;
        } catch {
          // Corrupted draft — drop silently.
        }
      }
      if (anyRestored) {
        setAnswersByTier(restored);
        setRecoveryToast(true);
        setTimeout(() => setRecoveryToast(false), 4000);
      }
      restoredRef.current = true;
    })();
  }, [tiersWithSchemas, tripEventId, buyer.email]);

  // ---- Keyboard pattern -------------------------------------------------
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);
  const scrollViewRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (e: KeyboardEvent): void => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, (): void => {
      setKeyboardHeight(0);
    });
    return (): void => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // ---- Defensive guard: cart empty / no tiers with schemas --------------
  useEffect(() => {
    if (tripEventId === null) return;
    if (lines.length === 0) {
      router.replace(`/checkout-trip/${tripEventId}` as never);
      return;
    }
    // If query loaded and there are zero tiers with schemas, this route
    // shouldn't have been reached — bounce to payment.
    if (
      schemasQuery.data !== undefined &&
      tiersWithSchemas.length === 0 &&
      buyer.email.length > 0
    ) {
      router.replace(`/checkout-trip/${tripEventId}/payment` as never);
    }
  }, [tripEventId, lines.length, schemasQuery.data, tiersWithSchemas.length, buyer.email.length, router]);

  // ---- Handlers ---------------------------------------------------------
  const handleBack = useCallback((): void => {
    if (tierIdx > 0) {
      setTierIdx(tierIdx - 1);
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else if (tripEventId !== null) {
      router.replace(`/checkout-trip/${tripEventId}/buyer` as never);
    }
  }, [tierIdx, router, tripEventId]);

  const handleUploadForActiveTier = useCallback(
    async (file: {
      filename: string;
      mime_type: string;
      size_bytes: number;
      body: Blob | ArrayBuffer | Uint8Array;
    }) => {
      if (tripEventId === null || activeTier === null) {
        throw new Error("Trip or tier not ready.");
      }
      // Use a placeholder order_id (we don't have a real order yet — checkout
      // hasn't created it). The signed-URL edge fn accepts the eventId +
      // questionId path and stamps the buyer's email into a per-buyer scoped
      // path. The order_id slot is reserved for post-payment file association.
      return uploadIntakeFile({
        eventId: tripEventId,
        orderId: `pending-${buyer.email.toLowerCase()}-${activeTier.ticketTypeId}`,
        questionId: "pending",
        filename: file.filename,
        mime_type: file.mime_type,
        size_bytes: file.size_bytes,
        body: file.body,
      });
    },
    [tripEventId, activeTier, buyer.email],
  );

  const handleContinue = useCallback(async (): Promise<void> => {
    if (activeTier === null || tripEventId === null) return;
    const answers = answersByTier[activeTier.ticketTypeId] ?? {};
    const errors = validateAnswerAgainstSchema(activeTier.schema, answers);
    if (errors.length > 0) {
      const errorMap: Record<string, string> = {};
      for (const e of errors) errorMap[e.question_id] = e.error;
      setValidationByTier((prev) => ({
        ...prev,
        [activeTier.ticketTypeId]: errorMap,
      }));
      setShowValidationBanner(true);
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    // Clear validation for this tier.
    setValidationByTier((prev) => {
      const next = { ...prev };
      delete next[activeTier.ticketTypeId];
      return next;
    });
    setShowValidationBanner(false);

    // Commit to cart.
    const payload: IntakeFormData = {
      ticket_type_id: activeTier.ticketTypeId,
      schema_version_id: activeTier.schema.schema_version_id,
      answers,
    };
    setIntakeTierData(activeTier.ticketTypeId, payload);

    // Persist to AsyncStorage draft.
    try {
      await AsyncStorage.setItem(
        draftKey(tripEventId, activeTier.ticketTypeId, buyer.email),
        JSON.stringify({
          schema_version_id: activeTier.schema.schema_version_id,
          answers,
          saved_at: Date.now(),
        } satisfies DraftEnvelope),
      );
    } catch {
      // Draft persistence is best-effort; cart commit is the durable path.
    }

    // Advance to next tier OR /payment.
    if (tierIdx < totalTiers - 1) {
      setTierIdx(tierIdx + 1);
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
      return;
    }
    // All tiers complete → /payment (or /confirm if free).
    if (totals.isFree) {
      router.replace(`/checkout-trip/${tripEventId}/buyer` as never);
      // buyer.tsx Continue handler does free-flow finalize; intake answers
      // are already in cart.intakeFormData for the next createTicketCheckout.
      return;
    }
    router.push(`/checkout-trip/${tripEventId}/payment` as never);
  }, [
    activeTier,
    tripEventId,
    answersByTier,
    tierIdx,
    totalTiers,
    totals.isFree,
    setIntakeTierData,
    buyer.email,
    router,
  ]);

  // ---- Loading state ----------------------------------------------------
  if (tripEventId === null || schemasQuery.isLoading) {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top + spacing.sm, backgroundColor: canvas.depth },
        ]}
      >
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      </View>
    );
  }

  if (activeTier === null) {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top + spacing.sm, backgroundColor: canvas.depth },
        ]}
      >
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>Preparing your intake form…</Text>
        </View>
      </View>
    );
  }

  const isLastTier = tierIdx === totalTiers - 1;
  const continueLabel = isLastTier
    ? totals.isFree
      ? "Continue"
      : "Continue to payment"
    : "Continue to next form";
  const activeValidationErrors =
    validationByTier[activeTier.ticketTypeId] ?? undefined;
  const activeAnswers = answersByTier[activeTier.ticketTypeId] ?? {};
  const missingCount =
    activeValidationErrors !== undefined
      ? Object.keys(activeValidationErrors).length
      : 0;

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top + spacing.sm, backgroundColor: canvas.depth },
      ]}
    >
      {/* Inline header — mirrors CheckoutHeader visual exactly but supports
          "3 OF 4" pill that the locked CheckoutHeader can't render. */}
      <View style={styles.headerRow}>
        <IconChrome
          icon="arrowL"
          size={40}
          onPress={handleBack}
          accessibilityLabel="Back"
        />
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Tell us about your trip</Text>
          {totalTiers > 1 ? (
            <Text style={styles.headerSubtitle}>
              {activeTier.tierName} ticket form
            </Text>
          ) : null}
        </View>
        <View style={styles.stepPill}>
          <Text style={styles.stepPillLabel}>
            3 OF {totals.isFree ? 3 : 4}
          </Text>
        </View>
      </View>
      <View style={styles.headerDivider} />

      <ScrollView
        ref={scrollViewRef}
        style={styles.body}
        contentContainerStyle={[
          styles.bodyContent,
          keyboardHeight > 0
            ? { paddingBottom: keyboardHeight + spacing.xl }
            : { paddingBottom: insets.bottom + 120 },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {/* ORCH-0882 — payment plan disclosure above the intake form so
            buyers see the deposit + future-installment schedule while
            filling required questions. Renders null when no cart line
            has a plan. */}
        {projectedSchedule !== null ? (
          <View style={styles.planDisclosureWrap}>
            <InstallmentScheduleDisplay
              schedule={projectedSchedule}
              variant="buyer"
              isProjection={true}
            />
          </View>
        ) : null}

        {/* Validation summary banner */}
        {showValidationBanner && missingCount > 0 ? (
          <GlassCard
            variant="base"
            padding={spacing.md}
            radius="lg"
            style={styles.validationBanner}
          >
            <View
              style={styles.validationRow}
              accessibilityLiveRegion="assertive"
            >
              <Icon
                name="bell"
                size={20}
                color={semantic.error}
                strokeWidth={2}
              />
              <Text style={styles.validationText}>
                Please answer {missingCount} required{" "}
                {missingCount === 1 ? "question" : "questions"} before
                continuing.
              </Text>
            </View>
          </GlassCard>
        ) : null}

        {/* Multi-tier internal eyebrow + progress dots */}
        {totalTiers > 1 ? (
          <View style={styles.tierEyebrowWrap}>
            <Text style={styles.tierEyebrow}>
              {activeTier.tierName.toUpperCase()} TICKET · FORM {tierIdx + 1}{" "}
              OF {totalTiers}
            </Text>
            <View style={styles.tierProgressRow}>
              {tiersWithSchemas.map((_, i) => (
                <View
                  key={`dot-${i}`}
                  style={[
                    styles.tierProgressDot,
                    i === tierIdx && styles.tierProgressDotActive,
                    i < tierIdx && styles.tierProgressDotCompleted,
                  ]}
                />
              ))}
            </View>
          </View>
        ) : null}

        <IntakeFormRenderer
          schema={activeTier.schema}
          ticketTypeId={activeTier.ticketTypeId}
          tierName={activeTier.tierName}
          answers={activeAnswers}
          onAnswersChange={(next) => {
            setAnswersByTier((prev) => ({
              ...prev,
              [activeTier.ticketTypeId]: next,
            }));
            // Clear banner once buyer engages with the form again.
            if (showValidationBanner) setShowValidationBanner(false);
          }}
          validationErrors={activeValidationErrors}
          onUpload={handleUploadForActiveTier}
        />
      </ScrollView>

      {/* Sticky dock with Continue (and Back when multi-tier intermediate) */}
      {keyboardHeight === 0 ? (
        <GlassCard
          variant="elevated"
          padding={6}
          radius="xxl"
          style={[
            styles.dock,
            { marginBottom: insets.bottom + spacing.md },
          ]}
        >
          {totalTiers > 1 && tierIdx > 0 ? (
            <View style={styles.dockRow}>
              <View style={styles.dockBackCell}>
                <Button
                  label="Back"
                  variant="ghost"
                  size="md"
                  leadingIcon="chevL"
                  onPress={() => handleBack()}
                  fullWidth
                />
              </View>
              <View style={styles.dockContinueCell}>
                <Button
                  label={continueLabel}
                  variant="primary"
                  size="md"
                  trailingIcon="chevR"
                  onPress={() => {
                    void handleContinue();
                  }}
                  fullWidth
                  testID="trip-intake-continue"
                />
              </View>
            </View>
          ) : (
            <Button
              label={continueLabel}
              variant="primary"
              size="md"
              trailingIcon="chevR"
              onPress={() => {
                void handleContinue();
              }}
              fullWidth
              testID="trip-intake-continue"
            />
          )}
        </GlassCard>
      ) : null}

      {/* Abandonment recovery toast — wrapped in absolute-positioned wrap per
          feedback_toast_needs_absolute_wrap.md */}
      <View
        style={[
          styles.toastWrap,
          { paddingTop: insets.top + spacing.md },
        ]}
        pointerEvents="box-none"
      >
        <Toast
          visible={recoveryToast}
          kind="success"
          message="Your answers were restored."
          onDismiss={() => setRecoveryToast(false)}
        />
      </View>
    </View>
  );
}

// Touch unused-import for lint compatibility.
void Pressable;

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    fontSize: typography.body.fontSize,
    color: textTokens.tertiary,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  headerSubtitle: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  headerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: glass.border.profileBase,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: spacing.md + 8,
    paddingTop: spacing.md,
  },
  validationBanner: {
    borderColor: semantic.error,
    borderWidth: 1,
    backgroundColor: semantic.errorTint,
    marginBottom: spacing.lg,
  },
  // ORCH-0882 — wrap so the schedule card sits with consistent vertical
  // breathing room above the validation banner / tier eyebrow.
  planDisclosureWrap: {
    width: "100%",
    marginBottom: spacing.lg,
  },
  validationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  validationText: {
    flex: 1,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
  },
  tierEyebrowWrap: {
    marginBottom: spacing.lg,
  },
  tierEyebrow: {
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    color: accent.warm,
    textTransform: "uppercase",
    marginBottom: spacing.xs,
  },
  tierProgressRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  tierProgressDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: glass.border.profileElevated,
    backgroundColor: "transparent",
  },
  tierProgressDotActive: {
    backgroundColor: accent.warm,
    borderColor: accent.border,
  },
  tierProgressDotCompleted: {
    backgroundColor: accent.warm,
    borderColor: accent.border,
    opacity: 0.6,
  },
  dock: {
    marginHorizontal: spacing.md,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  dockRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  dockBackCell: {
    flex: 1,
  },
  dockContinueCell: {
    flex: 2,
  },
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    paddingHorizontal: spacing.md,
    zIndex: 100,
  },
  stepPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  stepPillLabel: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    fontWeight: typography.micro.fontWeight,
    letterSpacing: typography.micro.letterSpacing,
    textTransform: "uppercase",
    color: textTokens.secondary,
  },
});
