/**
 * BrandSwitcherSheet — top-anchored drop-down for brand switching + creation.
 *
 * (Filename retains "Sheet" for git-history continuity. Under the hood this
 * uses the TopSheet primitive — drops down from below the topbar with a
 * pinned full-width footer button. Earlier iterations used bottom Sheet
 * (felt heavy) and centered Modal (overflowed with many brands); per
 * Cycle 1 spec lock-in (DEC-080), TopSheet is the right pattern.)
 *
 * Two modes (controlled internally):
 *   - "switch" — header + ScrollView of brand rows + pinned full-width
 *                "Create a new brand" footer. Tapping a row sets it as
 *                current and closes. Footer flips to create mode.
 *   - "create" — header (with optional Back arrow if brands exist) + form
 *                with displayName Input + pinned full-width "Create brand"
 *                submit footer. On submit, Brand is appended to the list,
 *                set as current, modal closes, `onBrandCreated` fires for
 *                parent to surface a confirmation Toast.
 *
 * Initial mode auto-derives: empty list → "create"; non-empty → "switch".
 *
 * Layout pattern (consumer of TopSheet):
 *   host (flex: 1 column)
 *     header (rigid)
 *     body (flex: 1 — ScrollView in switch mode, fixed form in create)
 *     footer (rigid — pinned full-width Button)
 */

import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  useCurrentBrandStore,
  type Brand,
} from "../../store/currentBrandStore";
import { useAuth } from "../../context/AuthContext";
import { useBrandListState } from "../../hooks/useBrandListShim";
import { useUpdateCreatorAccount } from "../../hooks/useCreatorAccount";
import { useCreateBrand, SlugCollisionError } from "../../hooks/useBrands";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { TopSheet } from "../ui/TopSheet";
import { usePoolMatchSearch } from "../../hooks/usePoolMatchSearch";
import { prefillDraftFromPoolMatch } from "../../utils/prefillDraftFromPoolMatch";
import { PersonaPickerCards, type PersonaDef } from "./PersonaPickerCards";
import { PoolMatchCard } from "./PoolMatchCard";
import { TripBrandWizard } from "./TripBrandWizard";
import { useDraftVenueStore } from "../../store/draftVenueStore";

export interface BrandSwitcherSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Fires after a successful create — parent surfaces a confirmation Toast. */
  onBrandCreated?: (brand: Brand) => void;
  onDefaultBrandSaveError?: (message: string) => void;
  /**
   * Cycle 17e-A: Fires when operator taps trash icon on a brand row.
   * Parent opens BrandDeleteSheet pre-populated with the brand to delete.
   */
  onRequestDeleteBrand?: (brand: Brand) => void;
  testID?: string;
}

// ORCH-0855 (Tr1) — Mode union widened from "switch" | "create" to add
// "persona" (3-card brand-type picker) + "trip-create" (TripBrandWizard).
// The original "create" mode is renamed "popup-create" — its render block
// is preserved byte-equivalent so today's "An event" flow has zero regression.
type Mode = "switch" | "persona" | "popup-create" | "trip-create";

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 32) || `brand${Date.now().toString(36)}`;

export const BrandSwitcherSheet: React.FC<BrandSwitcherSheetProps> = ({
  visible,
  onClose,
  onBrandCreated,
  onDefaultBrandSaveError,
  onRequestDeleteBrand,
  testID,
}) => {
  const brandList = useBrandListState();
  const brands = brandList.brands;
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
  const { user } = useAuth();
  const createBrandMutation = useCreateBrand();
  const updateCreatorAccountMutation = useUpdateCreatorAccount();
  const resetVenueDraft = useDraftVenueStore((s) => s.reset);
  const patchVenueDraft = useDraftVenueStore((s) => s.patch);
  const router = useRouter();

  const initialMode: Mode = brandList.isTrueEmpty ? "persona" : "switch";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [venueSearchName, setVenueSearchName] = useState("");
  const [displayName, setDisplayName] = useState<string>("Lonely Moth");
  const [submitting, setSubmitting] = useState<boolean>(false);
  // Cycle 17e-A: inline slug-collision error per Decision 11 hybrid UX
  const [slugError, setSlugError] = useState<string | null>(null);

  const {
    match: poolMatch,
    loading: poolSearchLoading,
    error: poolSearchError,
    clearError: clearPoolSearchError,
  } = usePoolMatchSearch(venueSearchName);

  useEffect(() => {
    if (visible) {
      setMode(brandList.isTrueEmpty ? "persona" : "switch");
      setVenueSearchName("");
      setDisplayName("Lonely Moth");
      setSubmitting(false);
      setSlugError(null);
    }
  }, [brandList.isTrueEmpty, visible]);

  // Clear inline error when operator types — fresh attempt
  useEffect(() => {
    if (slugError !== null) setSlugError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayName]);

  const trimmedName = displayName.trim();
  const canSubmit = useMemo(() => trimmedName.length > 0, [trimmedName]);

  const handlePick = (brand: Brand): void => {
    setCurrentBrand(brand);
    onClose();
    if (user === null) return;
    void updateCreatorAccountMutation
      .mutateAsync({ default_brand_id: brand.id })
      .catch(() => {
        onDefaultBrandSaveError?.(
          "Brand selected for now. Couldn't save it as your default.",
        );
      });
  };

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit || submitting) return;
    if (user === null || user.id === undefined) {
      return;
    }
    setSubmitting(true);
    setSlugError(null);
    try {
      const newBrand = await createBrandMutation.mutateAsync({
        accountId: user.id,
        name: trimmedName,
        slug: slugify(trimmedName),
        address: null,
        coverHue: 25, // Cycle 7 FX2 v11 default — warm orange
      });
      setCurrentBrand(newBrand);
      onBrandCreated?.(newBrand);
      onClose();
      void updateCreatorAccountMutation
        .mutateAsync({ default_brand_id: newBrand.id })
        .catch(() => {
          onDefaultBrandSaveError?.(
            "Brand selected for now. Couldn't save it as your default.",
          );
        });
    } catch (error) {
      if (error instanceof SlugCollisionError) {
        // Inline error per Decision 11
        setSlugError(
          "This brand name is taken. Try a small variation (e.g. \"" +
            trimmedName +
            " Events\").",
        );
      } else {
        // Toast handling delegated to parent via thrown error — but here we
        // just surface a generic inline error since the sheet is the boundary.
        setSlugError("Couldn't create brand. Tap Create to try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestDelete = (brand: Brand): void => {
    onRequestDeleteBrand?.(brand);
    onClose();
  };

  // ORCH-0855 (Tr1) — footer "Create a new brand" now opens the persona
  // picker (3-card chooser) rather than dropping straight into popup-create.
  const handleSwitchToPersona = (): void => {
    setMode("persona");
  };

  const handleBackToSwitch = (): void => {
    setMode("switch");
  };

  // ORCH-0855 (Tr1) — return from popup-create or trip-create to the
  // persona picker (chevL back chevron in those modes).
  const handleBackToPersona = (): void => {
    setMode("persona");
    setSlugError(null);
    setSubmitting(false);
  };

  const openVenueCreateFromPool = (): void => {
    resetVenueDraft();
    if (poolMatch !== null) {
      patchVenueDraft(prefillDraftFromPoolMatch(poolMatch));
    } else {
      const n = venueSearchName.trim();
      patchVenueDraft({ workingName: n, displayName: n });
    }
    onClose();
    router.push(
      (poolMatch !== null ? "/venue/create?pool=1" : "/venue/create") as never,
    );
  };

  const handlePoolMatchYes = (): void => {
    openVenueCreateFromPool();
  };

  const handlePoolMatchNo = (): void => {
    const n = venueSearchName.trim();
    resetVenueDraft();
    patchVenueDraft({ workingName: n, displayName: n, placePoolId: null });
    clearPoolSearchError();
  };

  const handlePoolMatchSkip = (): void => {
    handlePoolMatchNo();
  };

  // Ve1+Ve2 — "A place" opens venue onboarding; pool match can skip ahead via card.
  const personas: PersonaDef[] = [
    {
      id: "place",
      title: "A place",
      description: "I run a venue (restaurant, bar, gallery, studio)",
      icon: "location",
      disabled: false,
      onSelect: () => {
        openVenueCreateFromPool();
      },
      testID: "persona-place",
    },
    {
      id: "event",
      title: "An event",
      description: "I host one-off events, parties, or pop-ups",
      icon: "calendar",
      onSelect: () => setMode("popup-create"),
      testID: "persona-event",
    },
    {
      id: "trip",
      title: "A trip",
      description: "I plan curated trips and multi-day experiences",
      icon: "compass",
      onSelect: () => setMode("trip-create"),
      testID: "persona-trip",
    },
  ];

  return (
    <TopSheet visible={visible} onClose={onClose} testID={testID}>
      <View style={styles.host}>
        {mode === "switch" ? (
          <>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Switch brand</Text>
            </View>
            {brandList.isLoading ? (
              <View style={styles.loadingState}>
                <Text style={styles.emptyText}>Loading your brands…</Text>
              </View>
            ) : brandList.status === "error" ? (
              <View style={styles.loadingState}>
                <Text style={styles.emptyText}>Couldn't load your brands.</Text>
              </View>
            ) : (
              <ScrollView
                style={styles.scrollArea}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
              >
                {brands.map((brand) => {
                  const isActive = currentBrandId === brand.id;
                  return (
                    <View key={brand.id} style={styles.brandRowOuter}>
                      <Pressable
                        onPress={() => handlePick(brand)}
                        style={[
                          styles.brandRow,
                          isActive && styles.brandRowActive,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Switch to ${brand.displayName}`}
                        accessibilityState={{ selected: isActive }}
                      >
                        <View style={styles.brandAvatar}>
                          <Text style={styles.brandInitial}>
                            {brand.displayName.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <View style={styles.brandTextCol}>
                          <Text style={styles.brandName} numberOfLines={1}>
                            {brand.displayName}
                          </Text>
                          {isActive ? (
                            <Text style={styles.brandSub} numberOfLines={1}>
                              Current brand
                            </Text>
                          ) : null}
                        </View>
                        {isActive ? (
                          <Icon name="check" size={18} color={accent.warm} />
                        ) : null}
                      </Pressable>
                      {/* Cycle 17e-A — per-row delete affordance */}
                      {onRequestDeleteBrand !== undefined ? (
                        <Pressable
                          onPress={() => handleRequestDelete(brand)}
                          accessibilityRole="button"
                          accessibilityLabel={`Delete ${brand.displayName}`}
                          hitSlop={8}
                          style={styles.rowDeleteBtn}
                        >
                          <Icon name="trash" size={16} color={textTokens.tertiary} />
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </ScrollView>
            )}
            <View style={styles.footer}>
              <Button
                label="Create a new brand"
                onPress={handleSwitchToPersona}
                variant="primary"
                size="lg"
                leadingIcon="plus"
                disabled={brandList.isLoading}
              />
            </View>
          </>
        ) : mode === "persona" ? (
          // ORCH-0855 (Tr1) — 3-card persona picker.
          <>
            <View style={styles.header}>
              {brands.length > 0 ? (
                <Pressable
                  onPress={handleBackToSwitch}
                  accessibilityRole="button"
                  accessibilityLabel="Back to brand switcher"
                  style={styles.backTouch}
                >
                  <Icon name="chevL" size={18} color={textTokens.tertiary} />
                </Pressable>
              ) : null}
              <Text style={styles.headerTitle}>
                {brands.length > 0 ? "Choose a brand type" : "What kind of brand?"}
              </Text>
            </View>
            <ScrollView
              style={styles.personaScroll}
              contentContainerStyle={styles.personaScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.venueSearchBlock}>
                <Text style={styles.venueSearchLabel}>
                  Starting with a venue? Search our directory
                </Text>
                <Input
                  variant="text"
                  value={venueSearchName}
                  onChangeText={setVenueSearchName}
                  placeholder="Venue name"
                  accessibilityLabel="Venue name search"
                  testID="venue-name-search-input"
                />
                {poolSearchLoading ? (
                  <Text style={styles.poolSearchHint}>Searching…</Text>
                ) : null}
                {poolSearchError !== null ? (
                  <Text style={styles.poolSearchError}>{poolSearchError}</Text>
                ) : null}
                {poolMatch !== null ? (
                  <PoolMatchCard
                    match={poolMatch}
                    onYes={handlePoolMatchYes}
                    onNo={handlePoolMatchNo}
                    onSkip={handlePoolMatchSkip}
                  />
                ) : null}
              </View>
              <PersonaPickerCards personas={personas} testID="persona-picker" />
            </ScrollView>
          </>
        ) : mode === "trip-create" ? (
          // ORCH-0855 (Tr1) — trip-planner wizard. Mounted inside this TopSheet
          // per sub-sheet-inside-parent rule.
          <TripBrandWizard
            accountId={user?.id ?? ""}
            onClose={onClose}
            onBack={handleBackToPersona}
            onBrandCreated={onBrandCreated}
            onDefaultBrandSaveError={onDefaultBrandSaveError}
            testID="trip-brand-wizard"
          />
        ) : (
          // mode === "popup-create" — preserved byte-equivalent to pre-Tr1
          // "create" mode. "An event" persona card routes here.
          <>
            <View style={styles.header}>
              <Pressable
                onPress={handleBackToPersona}
                accessibilityRole="button"
                accessibilityLabel="Back to brand type picker"
                style={styles.backTouch}
              >
                <Icon name="chevL" size={18} color={textTokens.tertiary} />
              </Pressable>
              <Text style={styles.headerTitle}>
                {brands.length > 0 ? "Create a new brand" : "Create your first brand"}
              </Text>
            </View>
            <View style={styles.formArea}>
              <Text style={styles.formHelper}>
                Your brand is what attendees see. You can change it any time.
              </Text>
              <Input
                variant="text"
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Brand name"
                clearable
                accessibilityLabel="Brand display name"
              />
              {slugError !== null ? (
                <Text style={styles.slugError}>{slugError}</Text>
              ) : null}
            </View>
            <View style={styles.footer}>
              <Button
                label={submitting ? "Creating…" : "Create brand"}
                onPress={handleSubmit}
                variant="primary"
                size="lg"
                loading={submitting}
                disabled={!canSubmit || submitting}
              />
            </View>
          </>
        )}
      </View>
    </TopSheet>
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
  headerTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    letterSpacing: typography.h3.letterSpacing,
    color: textTokens.primary,
  },
  backTouch: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -spacing.xs,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  formArea: {
    flex: 1,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  loadingState: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  emptyText: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  formHelper: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  slugError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: "#EF4444",
    marginTop: spacing.xs,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  personaScroll: {
    flex: 1,
  },
  personaScrollContent: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  venueSearchBlock: {
    gap: spacing.sm,
  },
  venueSearchLabel: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  poolSearchHint: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  poolSearchError: {
    fontSize: typography.caption.fontSize,
    color: "#EF4444",
  },
  brandRowOuter: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  brandRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radiusTokens.lg,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  rowDeleteBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusTokens.md,
  },
  brandRowActive: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  brandAvatar: {
    width: 40,
    height: 40,
    borderRadius: radiusTokens.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  brandInitial: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: accent.warm,
  },
  brandTextCol: {
    flex: 1,
    minWidth: 0,
  },
  brandName: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  brandSub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: 2,
  },
});

export default BrandSwitcherSheet;
