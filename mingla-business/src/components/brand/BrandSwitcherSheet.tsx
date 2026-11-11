import React, { useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  accent,
  glass,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useAuth } from "../../context/AuthContext";
import { useBrandListState } from "../../hooks/useBrandListShim";
import { useUpdateCreatorAccount } from "../../hooks/useCreatorAccount";
import { useBrandFollowerCounts } from "../../hooks/useBrandFollowerCount";
import { formatExactFollowers } from "@mingla/offering-rendering/followerCount";
import {
  useCurrentBrandStore,
  type Brand,
} from "../../store/currentBrandStore";
// Issue #1835 — brand deletion is owner-only.
import { canDeleteBrand } from "../../utils/brandDeletePermission";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { TopSheet } from "../ui/TopSheet";
import { BrandMark } from "./BrandMark";

export interface BrandSwitcherSheetProps {
  visible: boolean;
  onClose: () => void;
  onBrandCreated?: (brand: Brand) => void;
  onDefaultBrandSaveError?: (message: string) => void;
  onRequestDeleteBrand?: (brand: Brand) => void;
  testID?: string;
}

export const BrandSwitcherSheet: React.FC<BrandSwitcherSheetProps> = ({
  visible,
  onClose,
  onDefaultBrandSaveError,
  onRequestDeleteBrand,
  testID,
}) => {
  const brandList = useBrandListState();
  const brands = brandList.brands;
  const followerCounts = useBrandFollowerCounts(brands.map((brand) => brand.id));
  const { user } = useAuth();
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
  const updateCreatorAccountMutation = useUpdateCreatorAccount();
  const router = useRouter();
  // #4389 I-4389-NO-MODAL-ON-OVERLAY — brand creation is never embedded in
  // this non-modal TopSheet any more. Opening the setup flow (and its bank
  // country step) inside this overlay is what froze the app (a native modal
  // sheet over the overlay). "Create brand" closes the sheet and opens the
  // full-screen route.
  const openCreate = useCallback((): void => {
    onClose();
    router.push("/brand/new" as never);
  }, [onClose, router]);

  const handlePick = useCallback(
    (brand: Brand): void => {
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
    },
    [
      onClose,
      onDefaultBrandSaveError,
      setCurrentBrand,
      updateCreatorAccountMutation,
      user,
    ],
  );

  return (
    <TopSheet visible={visible} onClose={onClose} testID={testID}>
      <View style={styles.host}>
        {(
          <>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Switch brand</Text>
            </View>
            {/* ORCH-1136 F-4 defense-in-depth: render the cached brand list
               whenever brands exist, BEFORE the loading branch — a populated
               cache must never be hidden behind a transient/background-refetch
               loading flag even if the status machine regresses again. */}
            {brandList.status === "error" && brands.length === 0 ? (
              <View style={styles.loadingState}>
                <Text style={styles.emptyText}>{"Couldn't load your brands."}</Text>
              </View>
            ) : brands.length === 0 && brandList.isLoading ? (
              <View style={styles.loadingState}>
                <Text style={styles.emptyText}>Loading your brands…</Text>
              </View>
            ) : (
              <ScrollView
                style={styles.scrollArea}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator
              >
                {brands.map((brand) => {
                  const isActive = currentBrandId === brand.id;
                  const followerTotal = followerCounts.data?.[brand.id];
                  const followerLine =
                    typeof followerTotal === "number"
                      ? formatExactFollowers(followerTotal)
                      : null;
                  const subline = isActive
                    ? followerLine === null
                      ? "Current brand"
                      : `${followerLine} · Current brand`
                    : followerLine;
                  return (
                    <View key={brand.id} style={styles.brandRowOuter}>
                      <Pressable
                        onPress={() => handlePick(brand)}
                        style={[
                          styles.brandRow,
                          isActive ? styles.brandRowActive : null,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Switch to ${brand.displayName}`}
                        accessibilityState={{ selected: isActive }}
                      >
                        <BrandMark
                          brand={brand}
                          size={40}
                          testID={`brand-switcher-mark-${brand.id}`}
                        />
                        <View style={styles.brandTextCol}>
                          <Text style={styles.brandName} numberOfLines={1}>
                            {brand.displayName}
                          </Text>
                          {subline !== null ? (
                            <Text style={styles.brandSub} numberOfLines={1}>
                              {subline}
                            </Text>
                          ) : null}
                        </View>
                        {isActive ? (
                          <Icon name="check" size={18} color={accent.warm} />
                        ) : null}
                      </Pressable>
                      {/* Issue #1835 — PER-ROW gate, deliberately not a
                          sheet-level one. The switcher lists every brand you can
                          reach, owned or merely administered, so the trash must
                          be decided per brand: shown only on rows you own. */}
                      {onRequestDeleteBrand !== undefined &&
                      canDeleteBrand(brand, user?.id ?? null) ? (
                        <Pressable
                          onPress={() => {
                            onRequestDeleteBrand(brand);
                            onClose();
                          }}
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
                onPress={openCreate}
                variant="primary"
                size="lg"
                leadingIcon="plus"
                disabled={brandList.isLoading}
              />
            </View>
          </>
        )}
      </View>
    </TopSheet>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1 },
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
    color: textTokens.primary,
  },
  scrollArea: { flex: 1 },
  scrollContent: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  loadingState: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.xl },
  emptyText: { fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight, color: textTokens.secondary, textAlign: "center" },
  brandRowOuter: { position: "relative" },
  brandRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  brandRowActive: {
    borderColor: accent.border,
    backgroundColor: "rgba(235, 120, 37, 0.10)",
  },
  brandTextCol: { flex: 1 },
  brandName: { fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight, fontWeight: "600", color: textTokens.primary },
  brandSub: { fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, color: textTokens.tertiary },
  rowDeleteBtn: { position: "absolute", top: 6, right: 6, width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg },
});

export default BrandSwitcherSheet;
