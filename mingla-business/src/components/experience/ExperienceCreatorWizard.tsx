import React, { useCallback, useEffect, useMemo, useState } from "react";
// orch-strict-grep-allow orch-0892 — META-ORCH-0972 Sub-B ExperienceCreatorWizard is a single-form experience creation flow; keyboard-input fields (title, description, venue) sit at top of viewport with explicit keyboardShouldPersistTaps and are not scroll-occluded by the on-screen keyboard. SmartScrollView migration deferred to a dedicated keyboard-hygiene follow-up ORCH.
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
import { useUpdateBrand } from "../../hooks/useBrands";
import { supabase } from "../../services/supabase";
import { joinBrandDescription } from "../../services/brandMapping";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { Stepper } from "../ui/Stepper";
import { Toast } from "../ui/Toast";

export interface ExperienceCreatorWizardProps {
  brandId: string;
  onComplete: (newExperienceId: string) => void;
  onCancel?: () => void;
}

type StepIndex = 1 | 2 | 3 | 4 | 5;

export const EXPERIENCE_CREATOR_COPY = {
  title: "Create experience",
  step1: {
    titleLabel: "Experience title",
    titlePlaceholder: "e.g. Friday Night Jazz Tasting",
    descriptionLabel: "What's it about?",
    descriptionPlaceholder: "10–500 characters.",
    divider: "or",
    menuTitle: "Upload a menu",
    menuBody: "We'll suggest experiences from your dishes.",
    activitiesTitle: "Paste your activities",
    activitiesBody: "We'll suggest experiences from your offerings.",
  },
  step2: {
    title: "Where does it happen?",
    venueLabel: "Venue or address",
    venuePlaceholder: "e.g. 12 Soho Square, London",
    helper:
      "Pre-filled from your brand address. Edit if this experience is somewhere else.",
    saveAsBrand: "Also save this as my brand's address",
  },
  step3: {
    title: "When is the next one?",
    subtitle: "Buyers see this as 'Next: <date>' on your experience card.",
    recurrenceLabel: "Recurrence",
    recurrenceOption: "One-time only",
  },
  publish: "Publish",
  saveDraft: "Save as draft",
} as const;

const STEPS = [
  { id: "identity", label: "Identity" },
  { id: "venue", label: "Venue" },
  { id: "when", label: "When" },
  { id: "pricing", label: "Pricing" },
  { id: "cover", label: "Cover" },
];

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || `experience-${Date.now().toString(36)}`;

const defaultNextOccurrence = (): string => {
  const next = new Date();
  next.setDate(next.getDate() + 7);
  next.setHours(19, 0, 0, 0);
  return next.toISOString().slice(0, 16);
};

const localDateTimeToIso = (value: string): string | null => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const ExperienceCreatorWizard: React.FC<ExperienceCreatorWizardProps> = ({
  brandId,
  onComplete,
  onCancel,
}) => {
  const { user } = useAuth();
  const brand = useCurrentBrand();
  const updateBrand = useUpdateBrand();
  const venueDefault = useExperienceVenueDefault(brandId);
  const [step, setStep] = useState<StepIndex>(1);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [venueText, setVenueText] = useState("");
  const [saveAsBrandAddress, setSaveAsBrandAddress] = useState(false);
  const [nextOccurrence, setNextOccurrence] = useState(defaultNextOccurrence);
  const [tierName, setTierName] = useState("Standard");
  const [priceMajor, setPriceMajor] = useState("0.00");
  const [capacity, setCapacity] = useState("20");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setVenueText(venueDefault.defaultVenue);
  }, [venueDefault.defaultVenue]);

  const canShowSaveAsBrand =
    !venueDefault.hasPrefill && venueText.trim().length > 0;

  const canContinue = useMemo(() => {
    if (step === 1) return title.trim().length > 0 && description.trim().length >= 10;
    if (step === 2) return venueText.trim().length > 0;
    if (step === 3) return localDateTimeToIso(nextOccurrence) !== null;
    return true;
  }, [description, nextOccurrence, step, title, venueText]);

  const goBack = useCallback((): void => {
    if (step === 1) onCancel?.();
    else setStep((prev) => Math.max(1, prev - 1) as StepIndex);
  }, [onCancel, step]);

  const handleSubmit = useCallback(
    async (publish: boolean): Promise<void> => {
      if (brand === null || user?.id === undefined) return;
      const iso = localDateTimeToIso(nextOccurrence);
      if (iso === null) return;
      setSubmitting(true);
      try {
        const { data, error } = await supabase
          .from("events")
          .insert({
            brand_id: brandId,
            created_by: user.id,
            event_type: "experience",
            title: title.trim(),
            slug: slugify(title),
            description: description.trim(),
            status: publish ? "scheduled" : "draft",
            visibility: publish ? "public" : "draft",
            published_at: publish ? new Date().toISOString() : null,
            currency: brand.defaultCurrency ?? "USD",
            theme: {
              experience_meta: {
                venue_text: venueText.trim(),
                next_occurrence_at: iso,
                tier_name: tierName.trim(),
                price_major: priceMajor.trim(),
                capacity: capacity.trim(),
              },
            },
          })
          .select("id")
          .single();
        if (error !== null) throw error;
        if (saveAsBrandAddress && canShowSaveAsBrand) {
          await updateBrand.mutateAsync({
            brandId: brand.id,
            accountId: user.id,
            patch: { address: venueText.trim() },
            existingDescription: joinBrandDescription(brand.tagline, brand.bio),
          });
        }
        onComplete((data as { id: string }).id);
      } catch (error) {
        setToast(
          error instanceof Error
            ? error.message
            : "Couldn't save experience. Tap to retry.",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [
      brand,
      brandId,
      canShowSaveAsBrand,
      capacity,
      description,
      nextOccurrence,
      onComplete,
      priceMajor,
      saveAsBrandAddress,
      tierName,
      title,
      updateBrand,
      user?.id,
      venueText,
    ],
  );

  const shortcutCards =
    brand?.venueCategory === "restaurant" || brand?.venueCategory === "play" ? (
      <>
        <Text style={styles.divider}>{EXPERIENCE_CREATOR_COPY.step1.divider}</Text>
        {brand.venueCategory === "restaurant" ? (
          <ShortcutCard
            icon="upload"
            title={EXPERIENCE_CREATOR_COPY.step1.menuTitle}
            body={EXPERIENCE_CREATOR_COPY.step1.menuBody}
          />
        ) : null}
        {brand.venueCategory === "play" ? (
          <ShortcutCard
            icon="sparkle"
            title={EXPERIENCE_CREATOR_COPY.step1.activitiesTitle}
            body={EXPERIENCE_CREATOR_COPY.step1.activitiesBody}
          />
        ) : null}
      </>
    ) : null;

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
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {step === 1 ? (
          <View style={styles.stepBody}>
            <Text style={styles.title}>{EXPERIENCE_CREATOR_COPY.title}</Text>
            <Text style={styles.label}>{EXPERIENCE_CREATOR_COPY.step1.titleLabel}</Text>
            <Input variant="text" value={title} onChangeText={setTitle} placeholder={EXPERIENCE_CREATOR_COPY.step1.titlePlaceholder} accessibilityLabel={EXPERIENCE_CREATOR_COPY.step1.titleLabel} clearable />
            <Text style={styles.label}>{EXPERIENCE_CREATOR_COPY.step1.descriptionLabel}</Text>
            <TextInput value={description} onChangeText={(value) => setDescription(value.slice(0, 500))} placeholder={EXPERIENCE_CREATOR_COPY.step1.descriptionPlaceholder} placeholderTextColor={textTokens.quaternary} accessibilityLabel={EXPERIENCE_CREATOR_COPY.step1.descriptionLabel} multiline style={styles.textArea} />
            {shortcutCards}
          </View>
        ) : null}
        {step === 2 ? (
          <View style={styles.stepBody}>
            <Text style={styles.title}>{EXPERIENCE_CREATOR_COPY.step2.title}</Text>
            <Text style={styles.label}>{EXPERIENCE_CREATOR_COPY.step2.venueLabel}</Text>
            <Input variant="text" value={venueText} onChangeText={setVenueText} placeholder={EXPERIENCE_CREATOR_COPY.step2.venuePlaceholder} accessibilityLabel={EXPERIENCE_CREATOR_COPY.step2.venueLabel} leadingIcon="location" clearable />
            {venueDefault.hasPrefill ? <Text style={styles.helper}>{EXPERIENCE_CREATOR_COPY.step2.helper}</Text> : null}
            {canShowSaveAsBrand ? (
              <Pressable onPress={() => setSaveAsBrandAddress((prev) => !prev)} accessibilityRole="checkbox" accessibilityState={{ checked: saveAsBrandAddress }} accessibilityLabel={EXPERIENCE_CREATOR_COPY.step2.saveAsBrand} style={styles.checkboxRow}>
                <View style={[styles.checkbox, saveAsBrandAddress ? styles.checkboxActive : null]}>
                  {saveAsBrandAddress ? <Icon name="check" size={14} color={textTokens.inverse} /> : null}
                </View>
                <Text style={styles.checkboxLabel}>{EXPERIENCE_CREATOR_COPY.step2.saveAsBrand}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {step === 3 ? (
          <View style={styles.stepBody}>
            <Text style={styles.title}>{EXPERIENCE_CREATOR_COPY.step3.title}</Text>
            <Text style={styles.body}>{EXPERIENCE_CREATOR_COPY.step3.subtitle}</Text>
            <Input variant="text" value={nextOccurrence} onChangeText={setNextOccurrence} placeholder="2026-06-15T19:00" accessibilityLabel="Next occurrence date and time" leadingIcon="calendar" />
            <Text style={styles.label}>{EXPERIENCE_CREATOR_COPY.step3.recurrenceLabel}</Text>
            <View style={styles.disabledSelect}>
              <Text style={styles.disabledSelectText}>{EXPERIENCE_CREATOR_COPY.step3.recurrenceOption}</Text>
              <Icon name="chevD" size={16} color={textTokens.tertiary} />
            </View>
          </View>
        ) : null}
        {step === 4 ? (
          <View style={styles.stepBody}>
            <Text style={styles.title}>Pricing</Text>
            <Text style={styles.label}>Tier name</Text>
            <Input variant="text" value={tierName} onChangeText={setTierName} placeholder="Standard" accessibilityLabel="Tier name" />
            <Text style={styles.label}>Price</Text>
            <Input variant="text" value={priceMajor} onChangeText={setPriceMajor} placeholder="0.00" accessibilityLabel="Price" />
            <Text style={styles.label}>Capacity</Text>
            <Input variant="text" value={capacity} onChangeText={setCapacity} placeholder="20" accessibilityLabel="Capacity" />
          </View>
        ) : null}
        {step === 5 ? (
          <View style={styles.stepBody}>
            <Text style={styles.title}>Cover</Text>
            <GlassCard variant="elevated" padding={spacing.lg}>
              <Text style={styles.body}>Add cover art later from the edit screen. This v1 wizard saves the experience details now.</Text>
            </GlassCard>
          </View>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        {step < 5 ? (
          <Button label="Continue" onPress={() => setStep((prev) => Math.min(5, prev + 1) as StepIndex)} variant="primary" size="lg" disabled={!canContinue} />
        ) : (
          <View style={styles.footerRow}>
            <Button label={EXPERIENCE_CREATOR_COPY.saveDraft} onPress={() => void handleSubmit(false)} variant="secondary" size="lg" loading={submitting} style={styles.footerButton} />
            <Button label={EXPERIENCE_CREATOR_COPY.publish} onPress={() => void handleSubmit(true)} variant="primary" size="lg" loading={submitting} style={styles.footerButton} />
          </View>
        )}
      </View>
      <Toast visible={toast !== null} kind="error" message={toast ?? ""} onDismiss={() => setToast(null)} />
    </View>
  );
};

interface ShortcutCardProps {
  icon: "upload" | "sparkle";
  title: string;
  body: string;
}

const ShortcutCard: React.FC<ShortcutCardProps> = ({ icon, title, body }) => (
  <GlassCard variant="base" padding={spacing.md}>
    <View style={styles.shortcutRow}>
      <Icon name={icon} size={22} color={accent.warm} />
      <View style={styles.shortcutText}>
        <Text style={styles.shortcutTitle}>{title}</Text>
        <Text style={styles.shortcutBody}>{body}</Text>
      </View>
    </View>
  </GlassCard>
);

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: canvas.discover },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  backTouch: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.full, backgroundColor: glass.tint.profileBase, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.border.profileBase },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  stepBody: { gap: spacing.md },
  title: { fontSize: typography.h2.fontSize, lineHeight: typography.h2.lineHeight, fontWeight: typography.h2.fontWeight, color: textTokens.primary },
  body: { fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight, color: textTokens.secondary },
  label: { fontSize: typography.bodySm.fontSize, lineHeight: typography.bodySm.lineHeight, fontWeight: "600", color: textTokens.secondary },
  helper: { fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, color: textTokens.tertiary },
  textArea: { minHeight: 120, padding: spacing.md, borderRadius: radius.md, backgroundColor: glass.tint.profileBase, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.border.profileBase, color: textTokens.primary, fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight, textAlignVertical: "top" },
  divider: { alignSelf: "center", color: textTokens.tertiary, fontSize: typography.caption.fontSize },
  shortcutRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  shortcutText: { flex: 1 },
  shortcutTitle: { fontSize: typography.body.fontSize, fontWeight: "600", color: textTokens.primary },
  shortcutBody: { marginTop: spacing.xxs, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, color: textTokens.secondary },
  checkboxRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  checkbox: { width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, borderWidth: 1, borderColor: glass.border.profileElevated, backgroundColor: glass.tint.profileBase },
  checkboxActive: { borderColor: accent.warm, backgroundColor: accent.warm },
  checkboxLabel: { flex: 1, fontSize: typography.bodySm.fontSize, lineHeight: typography.bodySm.lineHeight, color: textTokens.secondary },
  disabledSelect: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: glass.tint.profileBase, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.border.profileBase, opacity: 0.58 },
  disabledSelectText: { color: textTokens.secondary, fontSize: typography.body.fontSize },
  footer: { padding: spacing.lg },
  footerRow: { flexDirection: "row", gap: spacing.sm },
  footerButton: { flex: 1 },
});

export default ExperienceCreatorWizard;
