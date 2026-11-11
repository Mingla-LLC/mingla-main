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
import { usePickBrand } from "../../hooks/usePickBrand";
// #4389 N3 — draft and free-only rows from the setup checklist.
import { useBrandSetupStates } from "../../hooks/useBrandSetupStates";
import { BRAND_SETUP_COPY } from "./brandSetupCopy";
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
  /** #4389 AB — Ari titles the sheet "Talk to Ari about". Default "Switch brand". */
  title?: string;
  /**
   * #4389 R-16 — called before a pick is applied. Return false to hold the
   * pick (the sheet closes, nothing changes); the caller applies it later
   * with `usePickBrand()`.
   */
  onBeforePick?: (brand: Brand) => boolean;
  /** #4389 — called after a pick was applied. */
  onPicked?: (brand: Brand) => void;
  testID?: string;
}

export const BrandSwitcherSheet: React.FC<BrandSwitcherSheetProps> = ({
  visible,
  onClose,
  onDefaultBrandSaveError,
  onRequestDeleteBrand,
  title = "Switch brand",
  onBeforePick,
  onPicked,
  testID,
}) => {
  const brandList = useBrandListState();
  const brands = brandList.brands;
  const followerCounts = useBrandFollowerCounts(brands.map((brand) => brand.id));
  const { user } = useAuth();
  const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
  const pickBrand = usePickBrand(onDefaultBrandSaveError);
  const router = useRouter();
  // #4389 I-4389-NO-MODAL-ON-OVERLAY — brand creation is never embedded in
  // this non-modal TopSheet any more. Opening the setup flow (and its bank
  // country step) inside this overlay is what froze the app (a native modal
  // sheet over the overlay). "Create brand" closes the sheet and opens the
  // full-screen route.
  const brandIds = React.useMemo(() => brands.map((b) => b.id), [brands]);
  const setupStates = useBrandSetupStates(brandIds);
  const draftBrand = brands.find((b) => b.id === setupStates.draftId) ?? null;
  const openCreate = useCallback((): void => {
    onClose();
    // #4389 N1 — one draft at a time: Create brand with a draft opens
    // "You have a brand in progress" on the full-screen route.
    router.push(
      (draftBrand !== null
        ? `/brand/new?draft=${encodeURIComponent(draftBrand.id)}&draft_name=${encodeURIComponent(draftBrand.displayName)}`
        : "/brand/new") as never,
    );
  }, [draftBrand, onClose, router]);
  const openSetup = useCallback(
    (brand: Brand): void => {
      onClose();
      router.push(`/brand/${brand.id}/setup` as never);
    },
    [onClose, router],
  );
  // The discard confirm is the N1 confirm on its full-screen route, never a
  // pop-up over this sheet (U-1).
  const openDiscard = useCallback(
    (brand: Brand): void => {
      onClose();
      router.push(
        `/brand/new?draft=${encodeURIComponent(brand.id)}&draft_name=${encodeURIComponent(brand.displayName)}&discard=1` as never,
      );
    },
    [onClose, router],
  );

  const handlePick = useCallback(
    (brand: Brand): void => {
      if (onBeforePick !== undefined && !onBeforePick(brand)) {
        onClose();
        return;
      }
      pickBrand(brand);
      onClose();
      onPicked?.(brand);
    },
    [onBeforePick, onClose, onPicked, pickBrand],
  );

  return (
    <TopSheet visible={visible} onClose={onClose} testID={testID}>
      <View style={styles.host}>
        {(
          <>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>{title}</Text>
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
                  const setupState = setupStates.byId[brand.id] ?? { kind: "none" };
                  // #4389 N3 — any unfinished brand: line 2 starts with
                  // "Draft" (accent), then "Free events only" when the host
                  // chose it (no count: skipping payments is a choice, so
                  // "3 of 4 done" beside it contradicted it), else
                  // "{n} of 4 done". Continue sits inside the row.
                  const setupRest =
                    setupState.kind === "none"
                      ? null
                      : setupState.kind === "free_only"
                        ? ` · ${BRAND_SETUP_COPY.n3.freeOnlyTag}`
                        : ` · ${BRAND_SETUP_COPY.n3.progress(setupState.doneCount)}`;
                  const canDiscard =
                    setupState.kind === "draft" && canDeleteBrand(brand, user?.id ?? null);
                  const subline = setupRest !== null
                    ? null
                    : isActive
                      ? followerLine === null
                        ? "Current brand"
                        : `${followerLine} · Current brand`
                      : followerLine;
                  return (
                    <View key={brand.id} style={styles.brandRowOuter}>
                      {/* #4389 (retest) — the row is a plain box; the switch
                          target and the Continue pill are SIBLINGS. The pill
                          used to be nested in the switch Pressable: it sat on
                          the row's centre, so a tap on the row (and an
                          accessibility tap, which lands on the element's
                          centre) opened setup instead of switching, and
                          VoiceOver could not reach the pill on its own. */}
                      <View
                        style={[
                          styles.brandRow,
                          styles.brandRowSplit,
                          isActive ? styles.brandRowActive : null,
                        ]}
                        testID={`brand-switcher-rowbox-${brand.id}`}
                      >
                      <Pressable
                        onPress={() => handlePick(brand)}
                        style={styles.rowPick}
                        accessibilityRole="button"
                        accessibilityLabel={`Switch to ${brand.displayName}`}
                        accessibilityState={{ selected: isActive }}
                        testID={`brand-switcher-row-${brand.id}`}
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
                          {setupRest !== null ? (
                            <Text
                              style={styles.brandSub}
                              numberOfLines={1}
                              testID={`brand-switcher-setup-line-${brand.id}`}
                            >
                              <Text style={styles.brandSubDraft}>{BRAND_SETUP_COPY.n3.draftLabel}</Text>
                              {setupRest}
                            </Text>
                          ) : subline !== null ? (
                            <Text style={styles.brandSub} numberOfLines={1}>
                              {subline}
                            </Text>
                          ) : null}
                        </View>
                        {isActive ? (
                          <Icon name="check" size={18} color={accent.warm} />
                        ) : null}
                      </Pressable>
                        {setupRest !== null ? (
                          <Pressable
                            onPress={() => openSetup(brand)}
                            onLongPress={canDiscard ? () => openDiscard(brand) : undefined}
                            accessibilityRole="button"
                            accessibilityLabel={`${BRAND_SETUP_COPY.n3.continue} ${brand.displayName}`}
                            hitSlop={4}
                            style={styles.rowContinueBtn}
                            testID={`brand-switcher-continue-${brand.id}`}
                          >
                            <Text style={styles.rowContinueLabel}>{BRAND_SETUP_COPY.n3.continue}</Text>
                          </Pressable>
                        ) : null}
                        {/* The row menu on a true draft: "Discard draft" (the
                            N1 confirm on its own route). Inline, after Continue. */}
                        {canDiscard ? (
                          <Pressable
                            onPress={() => openDiscard(brand)}
                            accessibilityRole="button"
                            accessibilityLabel={`${BRAND_SETUP_COPY.n3.discard}: ${brand.displayName}`}
                            hitSlop={8}
                            style={styles.rowMenuBtn}
                            testID={`brand-switcher-discard-${brand.id}`}
                          >
                            <Icon name="moreH" size={16} color={textTokens.tertiary} />
                          </Pressable>
                        ) : setupRest !== null &&
                        onRequestDeleteBrand !== undefined &&
                        canDeleteBrand(brand, user?.id ?? null) ? (
                          // Not a draft (free-only or published): the usual
                          // owner-only delete, inline so it never covers Continue.
                          <Pressable
                            onPress={() => {
                              onRequestDeleteBrand(brand);
                              onClose();
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={`Delete ${brand.displayName}`}
                            hitSlop={8}
                            style={styles.rowMenuBtn}
                          >
                            <Icon name="trash" size={16} color={textTokens.tertiary} />
                          </Pressable>
                        ) : null}
                      </View>
                      {/* Issue #1835 — PER-ROW gate, deliberately not a
                          sheet-level one. The switcher lists every brand you can
                          reach, owned or merely administered, so the trash must
                          be decided per brand: shown only on rows you own.
                          #4389 — an unfinished brand's row carries Continue
                          (and, on a draft, the Discard menu) instead. */}
                      {setupRest === null &&
                      onRequestDeleteBrand !== undefined &&
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
  brandSubDraft: { color: accent.warm, fontWeight: "600" },
  // 36pt pill; hitSlop 4 makes the target 44pt.
  rowContinueBtn: {
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  rowMenuBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center", marginLeft: -spacing.xs },
  rowContinueLabel: { ...typography.caption, color: textTokens.primary, fontWeight: "600" },
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
  // The row box keeps its look; the switch target fills it up to the pill.
  brandRowSplit: { padding: 0, paddingRight: spacing.md, gap: spacing.sm },
  rowPick: { flex: 1, minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, paddingRight: 0 },
  brandTextCol: { flex: 1 },
  brandName: { fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight, fontWeight: "600", color: textTokens.primary },
  brandSub: { fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, color: textTokens.tertiary },
  rowDeleteBtn: { position: "absolute", top: 6, right: 6, width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg },
});

export default BrandSwitcherSheet;
