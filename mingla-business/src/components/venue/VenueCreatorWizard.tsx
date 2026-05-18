/**
 * Ve1 — 7-step venue onboarding wizard (after category selection).
 */

import React, { useCallback, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  canvas,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useAuth } from "../../context/AuthContext";
import {
  useCreateVenueBrand,
  useUpdateBrand,
  SlugCollisionError,
} from "../../hooks/useBrands";
import { joinBrandDescription } from "../../services/brandMapping";
import { uploadBrandCover } from "../../services/brandCoverService";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import { venueStepError } from "./venueWizardValidation";
import { Button } from "../ui/Button";
import { IconChrome } from "../ui/IconChrome";
import { Stepper, type StepperStep } from "../ui/Stepper";
import { VenueStep1Address } from "./VenueStep1Address";
import { VenueStep2NameSlug } from "./VenueStep2NameSlug";
import { VenueStep3Photos } from "./VenueStep3Photos";
import { VenueStep4Hours } from "./VenueStep4Hours";
import { VenueStep5Contact } from "./VenueStep5Contact";
import { VenueStep6Description } from "./VenueStep6Description";
import { VenueStep7Review } from "./VenueStep7Review";

const TOTAL = 7;
const STEPPER_STEPS: StepperStep[] = [
  { id: "s0", label: "Address" },
  { id: "s1", label: "Name" },
  { id: "s2", label: "Photos" },
  { id: "s3", label: "Hours" },
  { id: "s4", label: "Contact" },
  { id: "s5", label: "Story" },
  { id: "s6", label: "Review" },
];

export interface VenueCreatorWizardProps {
  onDone: () => void;
  onClose: () => void;
}

export const VenueCreatorWizard: React.FC<VenueCreatorWizardProps> = ({
  onDone,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const createVenue = useCreateVenueBrand();
  const updateBrandMutation = useUpdateBrand();

  const [step, setStep] = useState(0);
  const [showErr, setShowErr] = useState(false);
  const [slugCollision, setSlugCollision] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const draft = useDraftVenueStore();

  const goNext = useCallback((): void => {
    const e = venueStepError(step, draft);
    if (e !== null) {
      setShowErr(true);
      return;
    }
    setShowErr(false);
    setSlugCollision(null);
    setStep((s) => Math.min(TOTAL - 1, s + 1));
  }, [draft, step]);

  const goBack = useCallback((): void => {
    setShowErr(false);
    setSlugCollision(null);
    setStep((s) => Math.max(0, s - 1));
  }, []);

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (user?.id === undefined) return;
    setSubmitErr(null);
    const st = useDraftVenueStore.getState();
    const last = venueStepError(TOTAL - 1, st);
    if (last !== null) {
      setShowErr(true);
      return;
    }
    if (
      st.googlePlaceId === null ||
      st.lat === null ||
      st.lng === null ||
      st.venueCategory === null
    ) {
      setSubmitErr("Some required fields are missing. Go back and check.");
      return;
    }
    try {
      for (let i = 0; i < TOTAL - 1; i++) {
        const e = venueStepError(i, st);
        if (e !== null) {
          setSubmitErr(e);
          setStep(i);
          setShowErr(true);
          return;
        }
      }
      setShowErr(false);
      const existingDesc = joinBrandDescription(st.tagline, st.description);
      const brand = await createVenue.mutateAsync({
        accountId: user.id,
        name: st.displayName.trim(),
        slug: st.slug.trim(),
        tagline: st.tagline.trim() || undefined,
        bio: st.description.trim(),
        googlePlaceId: st.googlePlaceId,
        lat: st.lat,
        lng: st.lng,
        city: st.city,
        countryCode: st.countryCode,
        address: st.formattedAddress.trim(),
        venueCategory: st.venueCategory,
        contact: {
          email: st.contactEmail.trim() || undefined,
          phone: st.contactPhone.trim() || undefined,
        },
        coverMediaUrl: null,
        coverMediaType: null,
        hours: st.hours,
      });

      const firstUri = st.photoUris[0];
      if (firstUri !== undefined) {
        const up = await uploadBrandCover(
          brand.id,
          { uri: firstUri },
          {},
        );
        await updateBrandMutation.mutateAsync({
          brandId: brand.id,
          accountId: user.id,
          existingDescription: existingDesc,
          patch: {
            coverMediaUrl: up.publicUrl,
            coverMediaType: up.mediaType === "gif" ? "gif" : "image",
          },
        });
      }
      onDone();
    } catch (e) {
      if (e instanceof SlugCollisionError) {
        setSlugCollision(
          "This URL slug is taken. Go back to Name and adjust it.",
        );
        setStep(1);
        return;
      }
      if (e instanceof Error && e.message.includes("Google location")) {
        setSubmitErr(e.message);
        return;
      }
      setSubmitErr(
        e instanceof Error ? e.message : "Could not submit. Try again.",
      );
    }
  }, [createVenue, onDone, updateBrandMutation, user?.id]);

  const body = ((): React.ReactElement => {
    switch (step) {
      case 0:
        return <VenueStep1Address showErrors={showErr} />;
      case 1:
        return (
          <VenueStep2NameSlug
            showErrors={showErr}
            slugError={slugCollision}
          />
        );
      case 2:
        return <VenueStep3Photos showErrors={showErr} />;
      case 3:
        return <VenueStep4Hours showErrors={showErr} />;
      case 4:
        return <VenueStep5Contact showErrors={showErr} />;
      case 5:
        return <VenueStep6Description showErrors={showErr} />;
      case 6:
        return (
          <VenueStep7Review
            submitting={createVenue.isPending}
            submitError={submitErr}
            onSubmit={() => void handleSubmit()}
          />
        );
      default:
        return <View />;
    }
  })();

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.chrome}>
        <IconChrome
          icon="x"
          accessibilityLabel="Close venue setup"
          onPress={onClose}
        />
        <View style={styles.chromeMid}>
          <Text style={styles.chromeTitle}>List your venue</Text>
          <Text style={styles.chromeSub}>
            Step {step + 1} of {TOTAL}
          </Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <Stepper steps={STEPPER_STEPS} currentIndex={step} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingBottom: insets.bottom + spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {body}
      </ScrollView>

      {step < TOTAL - 1 ? (
        <View
          style={[
            styles.dock,
            { paddingBottom: insets.bottom + spacing.md },
          ]}
        >
          <View style={styles.dockRow}>
            {step > 0 ? (
              <Button
                label="Back"
                variant="ghost"
                size="lg"
                onPress={goBack}
              />
            ) : (
              <View style={{ width: 88 }} />
            )}
            <Button label="Continue" variant="primary" size="lg" onPress={goNext} />
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  chrome: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  chromeMid: {
    flex: 1,
    alignItems: "center",
  },
  chromeTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  chromeSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  scroll: {
    flex: 1,
  },
  dock: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.12)",
  },
  dockRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
});

export default VenueCreatorWizard;
