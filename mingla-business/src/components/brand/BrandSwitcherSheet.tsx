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
  type BrandRole,
} from "../../store/currentBrandStore";

import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { TopSheet } from "../ui/TopSheet";

export interface BrandSwitcherSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Fires after a successful create — parent surfaces a confirmation Toast. */
  onBrandCreated?: (brand: Brand) => void;
  testID?: string;
}

type Mode = "switch" | "create";

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 32) || `brand${Date.now().toString(36)}`;

const buildBrand = (displayName: string): Brand => ({
  id: `b_${Date.now().toString(36)}`,
  displayName: displayName.trim(),
  slug: slugify(displayName),
  // Cycle 7 schema v10: default new brands to "popup" (safer — no fake
  // address shown). Founder switches to "physical" + adds address via
  // BrandEditView when applicable.
  kind: "popup",
  address: null,
  // Cycle 7 FX2 schema v11: default new brands to hue 25 (warm orange,
  // matches accent.warm). Founder picks a different hue via BrandEditView.
  coverHue: 25,
  role: "owner" as BrandRole,
  stats: { events: 0, followers: 0, rev: 0, attendees: 0 },
  currentLiveEvent: null,
});

export const BrandSwitcherSheet: React.FC<BrandSwitcherSheetProps> = ({
  visible,
  onClose,
  onBrandCreated,
  testID,
}) => {
  const brands = useBrandList();
  const setBrands = useCurrentBrandStore((s) => s.setBrands);
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const currentBrand = useCurrentBrandStore((s) => s.currentBrand);

  const initialMode: Mode = brands.length === 0 ? "create" : "switch";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [displayName, setDisplayName] = useState<string>("Lonely Moth");
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (visible) {
      setMode(brands.length === 0 ? "create" : "switch");
      setDisplayName("Lonely Moth");
      setSubmitting(false);
    }
  }, [brands.length, visible]);

  const trimmedName = displayName.trim();
  const canSubmit = useMemo(() => trimmedName.length > 0, [trimmedName]);

  const handlePick = (brand: Brand): void => {
    setCurrentBrand(brand);
    onClose();
  };

  const handleSubmit = (): void => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    const newBrand = buildBrand(trimmedName);
    setBrands([...brands, newBrand]);
    setCurrentBrand(newBrand);
    onBrandCreated?.(newBrand);
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
                const isActive =
                  currentBrand !== null && currentBrand.id === brand.id;
                return (
                  <Pressable
                    key={brand.id}
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
                        {brand.stats.followers.toLocaleString("en-GB")} followers
                      </Text>
                    </View>
                    {isActive ? (
                      <Icon name="check" size={18} color={accent.warm} />
                    ) : null}
                  </Pressable>
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
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  brandRow: {
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
