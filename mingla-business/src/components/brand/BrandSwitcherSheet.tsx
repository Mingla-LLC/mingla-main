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
import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  useBrandList,
  useCurrentBrandStore,
  type Brand,
} from "../../store/currentBrandStore";
import { useAuth } from "../../context/AuthContext";
import { useCreateBrand, SlugCollisionError } from "../../hooks/useBrands";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { TopSheet } from "../ui/TopSheet";

export interface BrandSwitcherSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Fires after a successful create — parent surfaces a confirmation Toast. */
  onBrandCreated?: (brand: Brand) => void;
  /**
   * Cycle 17e-A: Fires when operator taps trash icon on a brand row.
   * Parent opens BrandDeleteSheet pre-populated with the brand to delete.
   */
  onRequestDeleteBrand?: (brand: Brand) => void;
  testID?: string;
}

type Mode = "switch" | "create";

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 32) || `brand${Date.now().toString(36)}`;

export const BrandSwitcherSheet: React.FC<BrandSwitcherSheetProps> = ({
  visible,
  onClose,
  onBrandCreated,
  onRequestDeleteBrand,
  testID,
}) => {
  const brands = useBrandList();
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
  const { user } = useAuth();
  const createBrandMutation = useCreateBrand();

  const initialMode: Mode = brands.length === 0 ? "create" : "switch";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [displayName, setDisplayName] = useState<string>("Lonely Moth");
  const [submitting, setSubmitting] = useState<boolean>(false);
  // Cycle 17e-A: inline slug-collision error per Decision 11 hybrid UX
  const [slugError, setSlugError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setMode(brands.length === 0 ? "create" : "switch");
      setDisplayName("Lonely Moth");
      setSubmitting(false);
      setSlugError(null);
    }
  }, [brands.length, visible]);

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
        kind: "popup", // Cycle 7 v10 default — safer (no fake address)
        address: null,
        coverHue: 25, // Cycle 7 FX2 v11 default — warm orange
      });
      setCurrentBrand(newBrand);
      onBrandCreated?.(newBrand);
      onClose();
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

  const handleSwitchToCreate = (): void => {
    setMode("create");
  };

  const handleBackToSwitch = (): void => {
    setMode("switch");
  };

  return (
    <TopSheet visible={visible} onClose={onClose} testID={testID}>
      <View style={styles.host}>
        {mode === "switch" ? (
          <>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Switch brand</Text>
            </View>
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
                        <Text style={styles.brandSub} numberOfLines={1}>
                          {brand.stats.events} events ·{" "}
                          {brand.stats.followers.toLocaleString("en-GB")}{" "}
                          followers
                        </Text>
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
            <View style={styles.footer}>
              <Button
                label="Create a new brand"
                onPress={handleSwitchToCreate}
                variant="primary"
                size="lg"
                leadingIcon="plus"
              />
            </View>
          </>
        ) : (
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
