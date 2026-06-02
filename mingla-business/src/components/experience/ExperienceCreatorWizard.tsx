import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
// orch-strict-grep-allow orch-0892 — META-ORCH-1059 Sub-A rebuilds the experience
// wizard onto a multi-stop itinerary + lifted CreatorStep2When + two-mode pricing.
// Keyboard-input fields sit in a single ScrollView with keyboardShouldPersistTaps;
// SmartScrollView migration deferred to a dedicated keyboard-hygiene follow-up.
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  accent,
  canvas,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useAuth } from "../../context/AuthContext";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useExperienceVenueDefault } from "../../hooks/useExperienceVenueDefault";
import { useExperienceDraftAdapter } from "../../hooks/useExperienceDraftAdapter";
import { supabase } from "../../services/supabase";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { Stepper } from "../ui/Stepper";
import { Toast } from "../ui/Toast";
import { CreatorStep2When } from "../event/CreatorStep2When";
import { DEFAULT_TAKE_RATE_BPS } from "../../constants/pricing";
import type { PricingSwitchOverrides } from "../../services/pricingSwitchesService";
import { useBrandTaxRegistration } from "../../hooks/useBrandTaxRegistration";
import { ExperienceStopsStep } from "./ExperienceStopsStep";
import { ExperiencePricingStep } from "./ExperiencePricingStep";
import {
  emptyStop,
  stopHasValidatedLocation,
  type ExperienceLocationMode,
  type ExperiencePricingMode,
  type ExperienceStopDraft,
} from "./experienceWizardTypes";

export interface ExperienceCreatorWizardProps {
  brandId: string;
  onComplete: (newExperienceId: string) => void;
  onCancel?: () => void;
  /** Optional AI-proposal / draft prefill (Layer 6 "Set up & publish"). */
  prefill?: { title?: string; description?: string; wholePriceMajor?: string };
}

type StepIndex = 1 | 2 | 3 | 4 | 5;

const STEPS = [
  { id: "identity", label: "Identity" },
  { id: "stops", label: "Stops" },
  { id: "when", label: "When" },
  { id: "pricing", label: "Pricing" },
  { id: "cover", label: "Cover" },
];

const RPC_ERROR_COPY: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  brand_not_found: "We couldn't find your brand.",
  insufficient_event_permission: "You don't have permission to publish for this brand.",
  experience_title_required: "Give your experience a title.",
  experience_description_invalid: "Description must be 10–500 characters.",
  event_currency_unsupported: "That currency isn't supported yet.",
  invalid_mode: "Something went wrong with the pricing/location setup. Try again.",
  experience_stop_count_invalid: "An experience needs 2–5 stops.",
  stop_name_required: "Every stop needs a name.",
  stop_address_unvalidated: "Pick each stop's address from the suggestions.",
  stop_too_many_images: "Each stop can have up to 5 photos.",
  experience_price_invalid: "Set a valid price, or mark the experience free.",
  event_date_required: "Pick at least one date.",
  slug_taken: "An experience with that name already exists. Try a small variation.",
};

const currencySymbolFor = (currency: string): string =>
  currency === "GBP" ? "£" : currency === "EUR" ? "€" : currency === "USD" ? "$" : `${currency} `;

export const ExperienceCreatorWizard: React.FC<ExperienceCreatorWizardProps> = ({
  brandId,
  onComplete,
  onCancel,
  prefill,
}) => {
  const { user } = useAuth();
  const brand = useCurrentBrand();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const taxRegistration = useBrandTaxRegistration(brand?.id ?? null);
  const venueDefault = useExperienceVenueDefault(brandId);
  const scrollRef = useRef<ScrollView>(null);

  const currency = brand?.defaultCurrency ?? "USD";
  const currencySymbol = currencySymbolFor(currency);

  const [step, setStep] = useState<StepIndex>(1);
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");

  // Stops + modes
  const [locationMode, setLocationMode] = useState<ExperienceLocationMode>("single");
  const [pricingMode, setPricingMode] = useState<ExperiencePricingMode>("whole");
  const [stops, setStops] = useState<ExperienceStopDraft[]>([emptyStop(), emptyStop()]);

  // Pricing
  const [wholePriceMajor, setWholePriceMajor] = useState(prefill?.wholePriceMajor ?? "0.00");
  const [isFree, setIsFree] = useState(false);
  const [capacity, setCapacity] = useState("20");
  const [unlimited, setUnlimited] = useState(false);
  const [pricingSwitches, setPricingSwitches] = useState<PricingSwitchOverrides>({
    passTax: null,
    passMinglaFee: null,
    passServiceFee: null,
  });

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showStepErrors, setShowStepErrors] = useState(false);

  // When-step adapter (feeds the lifted CreatorStep2When).
  const whenAdapter = useExperienceDraftAdapter(brandId);

  // Seed stop 1 from the brand venue default (design §2.7): name/address text
  // only; placeId stays null so the brand must confirm a real Mapbox pick.
  useEffect(() => {
    if (venueDefault.hasPrefill && venueDefault.defaultVenue.trim().length > 0) {
      setStops((prev) => {
        if (prev.length === 0) return prev;
        if (prev[0].address.trim().length > 0 || prev[0].placeName.trim().length > 0) return prev;
        const seeded = [...prev];
        seeded[0] = { ...seeded[0], address: venueDefault.defaultVenue.trim() };
        return seeded;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueDefault.hasPrefill, venueDefault.defaultVenue]);

  const resolvedTotalMajor = useMemo(() => {
    if (isFree) return 0;
    if (pricingMode === "whole") {
      const v = parseFloat(wholePriceMajor);
      return Number.isFinite(v) && v >= 0 ? v : 0;
    }
    return stops.reduce((sum, s) => {
      const v = parseFloat(s.priceMajor);
      return sum + (Number.isFinite(v) && v >= 0 ? v : 0);
    }, 0);
  }, [isFree, pricingMode, stops, wholePriceMajor]);

  // Per-step Continue gate.
  const stopsValid = useMemo(() => {
    if (stops.length < 2 || stops.length > 5) return false;
    return stops.every((s, i) => {
      if (s.placeName.trim().length === 0) return false;
      const needsAddress = locationMode === "per_stop" || i === 0;
      if (needsAddress && !stopHasValidatedLocation(s)) return false;
      return true;
    });
  }, [stops, locationMode]);

  const pricingValid = useMemo(() => {
    if (!unlimited && (parseInt(capacity, 10) || 0) <= 0) return false;
    if (isFree) return true;
    if (pricingMode === "whole") return resolvedTotalMajor > 0;
    // per-stop: every stop must have an explicit non-empty price entry
    return stops.every((s) => s.priceMajor.trim().length > 0);
  }, [unlimited, capacity, isFree, pricingMode, resolvedTotalMajor, stops]);

  const canContinue = useMemo(() => {
    if (step === 1) return title.trim().length > 0 && description.trim().length >= 10;
    if (step === 2) return stopsValid;
    if (step === 3) return whenAdapter.isValid;
    if (step === 4) return pricingValid;
    return true;
  }, [step, title, description, stopsValid, whenAdapter.isValid, pricingValid]);

  const goBack = useCallback((): void => {
    if (step === 1) onCancel?.();
    else setStep((prev) => Math.max(1, prev - 1) as StepIndex);
  }, [onCancel, step]);

  const goNext = useCallback((): void => {
    if (!canContinue) {
      setShowStepErrors(true);
      if (step === 3) whenAdapter.setShowErrors(true);
      return;
    }
    setShowStepErrors(false);
    setStep((prev) => Math.min(5, prev + 1) as StepIndex);
  }, [canContinue, step, whenAdapter]);

  const buildPayload = useCallback(
    (publish: boolean) => {
      const whenPayload = whenAdapter.toPayloadWhen();
      return {
        title: title.trim(),
        description: description.trim(),
        currency,
        location_mode: locationMode,
        pricing_mode: pricingMode,
        whole_price_cents: Math.round(resolvedTotalMajor * 100),
        is_free: isFree,
        capacity: unlimited ? null : parseInt(capacity, 10) || null,
        pass_tax: pricingSwitches.passTax,
        pass_mingla_fee: pricingSwitches.passMinglaFee,
        pass_service_fee: pricingSwitches.passServiceFee,
        stops: stops.map((s, i) => ({
          stop_order: i,
          place_id: s.placeId,
          place_name: s.placeName.trim(),
          address: s.address.trim(),
          city: s.city,
          region: s.region,
          country_code: s.countryCode,
          lat: s.lat,
          lng: s.lng,
          image_urls: s.imageUrls,
          start_time: s.startTime,
          price_cents:
            pricingMode === "per_stop"
              ? Math.round((parseFloat(s.priceMajor) || 0) * 100)
              : 0,
          ai_description: "",
        })),
        whenMode: whenPayload.whenMode,
        when: whenPayload.when,
        multiDates: whenPayload.multiDates,
        recurrence_rules: whenPayload.recurrence_rules,
        timezone: whenPayload.timezone,
      };
    },
    [
      whenAdapter,
      title,
      description,
      currency,
      locationMode,
      pricingMode,
      resolvedTotalMajor,
      isFree,
      unlimited,
      capacity,
      pricingSwitches,
      stops,
    ],
  );

  const handleSubmit = useCallback(
    async (publish: boolean): Promise<void> => {
      if (brand === null || user?.id === undefined) return;
      if (publish && (!stopsValid || !pricingValid || !whenAdapter.isValid)) {
        setShowStepErrors(true);
        whenAdapter.setShowErrors(true);
        setToast("Finish the required fields before publishing.");
        return;
      }
      setSubmitting(true);
      try {
        const { data, error } = await supabase.rpc("biz_create_experience", {
          p_brand_id: brandId,
          p_payload: buildPayload(publish),
          p_publish: publish,
        });
        if (error !== null) {
          const code = error.message ?? "";
          throw new Error(RPC_ERROR_COPY[code] ?? "Couldn't save experience. Tap to retry.");
        }
        const result = data as { event?: { id?: string } } | null;
        const newId = result?.event?.id;
        if (typeof newId !== "string") {
          throw new Error("Couldn't save experience. Tap to retry.");
        }
        onComplete(newId);
      } catch (e) {
        setToast(e instanceof Error ? e.message : "Couldn't save experience. Tap to retry.");
      } finally {
        setSubmitting(false);
      }
    },
    [brand, brandId, buildPayload, onComplete, pricingValid, stopsValid, user?.id, whenAdapter],
  );

  return (
    <View style={styles.host}>
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={step === 1 ? "Cancel experience creation" : "Back"}
          style={styles.backTouch}
        >
          <Icon name={step === 1 ? "close" : "chevL"} size={18} color={textTokens.secondary} />
        </Pressable>
        <Stepper steps={STEPS} currentIndex={step - 1} />
      </View>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {step === 1 ? (
          <View style={styles.stepBody}>
            <Text style={styles.title}>Create experience</Text>
            <Text style={styles.label}>Experience title</Text>
            <Input
              variant="text"
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Friday Night Jazz Crawl"
              accessibilityLabel="Experience title"
              clearable
            />
            <Text style={styles.label}>What&apos;s it about?</Text>
            <TextInput
              value={description}
              onChangeText={(value) => setDescription(value.slice(0, 500))}
              placeholder="10–500 characters."
              placeholderTextColor={textTokens.quaternary}
              accessibilityLabel="Experience description"
              multiline
              style={styles.textArea}
            />
          </View>
        ) : null}

        {step === 2 ? (
          <ExperienceStopsStep
            brandId={brandId}
            currencySymbol={currencySymbol}
            stops={stops}
            setStops={setStops}
            locationMode={locationMode}
            setLocationMode={setLocationMode}
            pricingMode={pricingMode}
            showErrors={showStepErrors}
            onToast={setToast}
          />
        ) : null}

        {step === 3 ? (
          <View style={styles.stepBody}>
            <Text style={styles.title}>When does it happen?</Text>
            <CreatorStep2When
              draft={whenAdapter.draftEvent}
              updateDraft={whenAdapter.updateDraft}
              errors={whenAdapter.errors}
              showErrors={whenAdapter.showErrors}
              onShowToast={setToast}
              scrollToBottom={() => scrollRef.current?.scrollToEnd({ animated: true })}
            />
          </View>
        ) : null}

        {step === 4 && brand !== null ? (
          <ExperiencePricingStep
            currencySymbol={currencySymbol}
            currency={currency}
            pricingMode={pricingMode}
            setPricingMode={setPricingMode}
            stops={stops}
            setStops={setStops}
            wholePriceMajor={wholePriceMajor}
            setWholePriceMajor={setWholePriceMajor}
            isFree={isFree}
            setIsFree={setIsFree}
            capacity={capacity}
            setCapacity={setCapacity}
            unlimited={unlimited}
            setUnlimited={setUnlimited}
            pricingSwitches={pricingSwitches}
            setPricingSwitches={setPricingSwitches}
            brandDefaults={{
              passTax: brand.defaultPassTax ?? false,
              passMinglaFee: brand.defaultPassMinglaFee ?? false,
              passServiceFee: brand.defaultPassServiceFee ?? false,
            }}
            takeRateBps={brand.takeRateBpsOverride ?? DEFAULT_TAKE_RATE_BPS}
            vatRegistered={taxRegistration.data?.hasActiveRegistration === true}
            onEditDefaults={() => router.push(`/brand/${brand.id}/pricing-defaults` as never)}
            onSetupVat={() => router.push("/connect-tax-registrations" as never)}
            showErrors={showStepErrors}
          />
        ) : null}

        {step === 5 ? (
          <View style={styles.stepBody}>
            <Text style={styles.title}>Cover</Text>
            <GlassCard variant="elevated" padding={spacing.lg}>
              <Text style={styles.body}>
                Add cover art later from the edit screen. Publish now to make this experience
                bookable, or save it as a draft to finish later.
              </Text>
            </GlassCard>
          </View>
        ) : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        {step < 5 ? (
          <Button label="Continue" onPress={goNext} variant="primary" size="lg" />
        ) : (
          <View style={styles.footerRow}>
            <Button
              label="Save as draft"
              onPress={() => void handleSubmit(false)}
              variant="secondary"
              size="lg"
              loading={submitting}
              style={styles.footerButton}
            />
            <Button
              label="Publish"
              onPress={() => void handleSubmit(true)}
              variant="primary"
              size="lg"
              loading={submitting}
              style={styles.footerButton}
            />
          </View>
        )}
      </View>
      <Toast visible={toast !== null} kind="error" message={toast ?? ""} onDismiss={() => setToast(null)} />
    </View>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: canvas.discover },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  backTouch: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
  },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  stepBody: { gap: spacing.md },
  title: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    color: textTokens.primary,
  },
  body: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
  },
  label: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  textArea: {
    minHeight: 120,
    padding: spacing.md,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    textAlignVertical: "top",
  },
  footer: { padding: spacing.lg },
  footerRow: { flexDirection: "row", gap: spacing.sm },
  footerButton: { flex: 1 },
});

export default ExperienceCreatorWizard;
