/**
 * TripBrandWizard — trip-planner brand creation flow (ORCH-0855 Tr1).
 *
 * Mounted INSIDE the parent BrandSwitcherSheet TopSheet (sub-sheet-inside-parent
 * rule per feedback_rn_sub_sheet_must_render_inside_parent). Does NOT mount a
 * separate Sheet/Modal at the root layer.
 *
 * Submit sequence (SPEC §4.5.2 — exact steps):
 *   1. createBrand({kind:'trip_planner', name, slug, bio, address:null, coverHue:25})
 *   2. open BrandCoverPickerSheet with new brand.id; on picked → updateBrand patch
 *      (cover is prompted, not blocking — SC-13: brand persists even if cover skipped/fails)
 *   3. updateCreatorAccount default_brand_id (fire-and-forget per existing pattern)
 *   4. setCurrentBrand zustand
 *   5. onBrandCreated parent callback
 *   6. onClose parent sheet
 *   7. router.push(`/brand/${id}/payments`) — BrandOnboardView handles Stripe Connect
 *      country picker + Account Link flow (P1-2 resolution: do NOT duplicate that 300-line
 *      state machine inline; delegate to existing component).
 *
 * Spec: Mingla_Artifacts/specs/SPEC_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING.md §4.5.2
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
// ORCH-0892-B v2: ScrollView routed through SmartScrollView wrapper. On
// native, resolves to KeyboardAwareScrollView (library) which scrolls the
// focused TextInput exactly 12pt above the keyboard. On web, plain RN
// ScrollView (passthrough). Keyboard import retained for Keyboard.dismiss().
// KeyboardAvoidingView wrapper from ORCH-0892-A DELETED — KAS supersedes.
// Per SPEC_ORCH-0892-B_v2 §7.D.
import { ScrollView } from "../../wrappers/SmartScrollView";
import { useRouter } from "expo-router";
import {
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useCurrentBrandStore, type Brand } from "../../store/currentBrandStore";
import { useCreateBrand, useUpdateBrand, SlugCollisionError } from "../../hooks/useBrands";
import { useUpdateCreatorAccount } from "../../hooks/useCreatorAccount";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { BrandCoverPickerSheet } from "./BrandCoverPickerSheet";
import { joinBrandDescription } from "../../services/brandsService";

const BIO_MAX_LENGTH = 200;
const DEFAULT_COVER_HUE = 25;

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 32) || `trip${Date.now().toString(36)}`;

type WizardStatus =
  | "idle"
  | "creating-brand"
  | "cover-picking"
  | "saving-cover"
  | "routing-to-stripe"
  | "error-slug-collision"
  | "error-network";

export interface TripBrandWizardProps {
  /** auth.uid() of the creating user. */
  accountId: string;
  /** Closes the parent BrandSwitcherSheet TopSheet after wizard success/route. */
  onClose: () => void;
  /** Back chevron — returns to persona picker. */
  onBack: () => void;
  /** Fires after successful brand insert — parent surfaces a confirmation Toast. */
  onBrandCreated?: (brand: Brand) => void;
  /** Fires if default-brand save fails (non-fatal). Parent surfaces a Toast. */
  onDefaultBrandSaveError?: (message: string) => void;
  testID?: string;
}

export const TripBrandWizard: React.FC<TripBrandWizardProps> = ({
  accountId,
  onClose,
  onBack,
  onBrandCreated,
  onDefaultBrandSaveError,
  testID,
}) => {
  const router = useRouter();
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const createBrandMutation = useCreateBrand();
  const updateBrandMutation = useUpdateBrand();
  const updateCreatorAccountMutation = useUpdateCreatorAccount();

  const [name, setName] = useState<string>("");
  const [bio, setBio] = useState<string>("");
  const [status, setStatus] = useState<WizardStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdBrand, setCreatedBrand] = useState<Brand | null>(null);
  const [coverPickerVisible, setCoverPickerVisible] = useState<boolean>(false);

  // Clear errors when user retypes name (fresh attempt).
  useEffect(() => {
    if (status === "error-slug-collision" || status === "error-network") {
      setStatus("idle");
      setErrorMessage(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const trimmedName = name.trim();
  const trimmedBio = bio.trim();
  const canSubmit = useMemo(
    () => trimmedName.length > 0 && status === "idle",
    [trimmedName, status],
  );
  const isSubmitting =
    status === "creating-brand" ||
    status === "cover-picking" ||
    status === "saving-cover" ||
    status === "routing-to-stripe";

  // Step 7 — final navigation to Stripe Connect entry (existing BrandOnboardView).
  const routeToPayments = (brand: Brand): void => {
    setCurrentBrand(brand);
    setStatus("routing-to-stripe");
    // Fire-and-forget — error surfaces via callback, doesn't block routing.
    void updateCreatorAccountMutation
      .mutateAsync({ default_brand_id: brand.id })
      .catch(() => {
        onDefaultBrandSaveError?.(
          "Brand created. Couldn't save it as your default.",
        );
      });
    onBrandCreated?.(brand);
    onClose();
    router.push(`/brand/${brand.id}/payments` as never);
  };

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return;
    Keyboard.dismiss();
    setStatus("creating-brand");
    setErrorMessage(null);
    try {
      const newBrand = await createBrandMutation.mutateAsync({
        accountId,
        name: trimmedName,
        slug: slugify(trimmedName),
        address: null,
        coverHue: DEFAULT_COVER_HUE,
        bio: trimmedBio.length > 0 ? trimmedBio : undefined,
      });
      setCreatedBrand(newBrand);
      setStatus("cover-picking");
      setCoverPickerVisible(true);
    } catch (error) {
      if (error instanceof SlugCollisionError) {
        setStatus("error-slug-collision");
        setErrorMessage(
          `This brand name is taken. Try a small variation (e.g. "${trimmedName} Trips").`,
        );
      } else {
        setStatus("error-network");
        setErrorMessage("Couldn't create brand. Tap Continue to try again.");
      }
    }
  };

  // Cover picker fires onPicked with the upload result; we patch the brand row
  // and continue. If updateBrand fails, brand still persists with no cover —
  // surface banner per SC-13 but continue routing.
  const handleCoverPicked = async (result: {
    publicUrl: string;
    mediaType: "image" | "gif";
  }): Promise<void> => {
    if (createdBrand === null) return;
    setCoverPickerVisible(false);
    setStatus("saving-cover");
    try {
      const updated = await updateBrandMutation.mutateAsync({
        brandId: createdBrand.id,
        patch: {
          coverMediaUrl: result.publicUrl,
          coverMediaType: result.mediaType,
        },
        existingDescription: joinBrandDescription(
          createdBrand.tagline,
          createdBrand.bio,
        ),
        accountId,
      });
      routeToPayments(updated);
    } catch {
      // SC-13 — brand persists, cover failed. Continue to Stripe; user can
      // re-add cover from brand profile later.
      setErrorMessage(
        "Brand created, but cover couldn't save. You can add it from brand profile.",
      );
      routeToPayments(createdBrand);
    }
  };

  // User dismissed cover picker without picking — brand exists, route anyway.
  const handleCoverPickerClose = (): void => {
    setCoverPickerVisible(false);
    if (createdBrand !== null) {
      routeToPayments(createdBrand);
    } else {
      // Defensive — should never happen (picker only opens after createdBrand set).
      setStatus("idle");
    }
  };

  const submitLabel =
    status === "creating-brand"
      ? "Creating brand…"
      : status === "cover-picking"
        ? "Choose cover…"
        : status === "saving-cover"
          ? "Saving cover…"
          : status === "routing-to-stripe"
            ? "Opening Stripe…"
            : "Continue to Stripe";

  return (
    <View style={styles.host} testID={testID}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          disabled={isSubmitting}
          accessibilityRole="button"
          accessibilityLabel="Back to brand type picker"
          style={styles.backTouch}
        >
          <Icon name="chevL" size={18} color={textTokens.tertiary} />
        </Pressable>
        <Text style={styles.headerTitle}>Create a trip planner</Text>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.helper}>
          Tell travelers who you are. You can edit any of this later from brand profile.
        </Text>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Brand name</Text>
          <Input
            variant="text"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Wandering Soul Retreats"
            clearable
            disabled={isSubmitting}
            accessibilityLabel="Brand name"
            testID="trip-wizard-name-input"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>
            Short bio <Text style={styles.fieldLabelOptional}>(optional)</Text>
          </Text>
          <TextInput
            value={bio}
            onChangeText={setBio}
            placeholder="Small group retreats in Mexico and Costa Rica"
            placeholderTextColor={textTokens.tertiary}
            multiline
            numberOfLines={3}
            maxLength={BIO_MAX_LENGTH}
            editable={!isSubmitting}
            accessibilityLabel="Short bio"
            testID="trip-wizard-bio-input"
            style={styles.bioInput}
          />
          <Text style={styles.bioCounter}>
            {bio.length}/{BIO_MAX_LENGTH}
          </Text>
        </View>

        {errorMessage !== null ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{errorMessage}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={submitLabel}
          onPress={handleSubmit}
          variant="primary"
          size="lg"
          loading={isSubmitting}
          disabled={!canSubmit}
          testID="trip-wizard-submit"
        />
      </View>

      {createdBrand !== null && accountId !== null ? (
        <BrandCoverPickerSheet
          visible={coverPickerVisible}
          brandId={createdBrand.id}
          accountId={accountId}
          existingDescription={joinBrandDescription(
            createdBrand.tagline,
            createdBrand.bio,
          )}
          currentMediaUrl={null}
          onClose={handleCoverPickerClose}
          onPicked={handleCoverPicked}
          onErrorToast={(msg) => {
            setErrorMessage(msg);
          }}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  backTouch: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -spacing.xs,
  },
  headerTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    letterSpacing: typography.h3.letterSpacing,
    color: textTokens.primary,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  fieldGroup: {
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
    fontWeight: "600",
  },
  fieldLabelOptional: {
    fontWeight: "400",
    color: textTokens.tertiary,
  },
  bioInput: {
    minHeight: 80,
    maxHeight: 140,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    textAlignVertical: "top",
  },
  bioCounter: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    alignSelf: "flex-end",
  },
  errorBanner: {
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.4)",
  },
  errorBannerText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: "#EF4444",
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
});

export default TripBrandWizard;
