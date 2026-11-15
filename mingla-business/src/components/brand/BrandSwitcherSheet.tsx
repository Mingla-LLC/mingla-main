import React, { useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  color,
  radius,
  size,
  space,
  type,
} from "../../constants/designSystem";
import { useAuth } from "../../context/AuthContext";
import { useBrandListState } from "../../hooks/useBrandListShim";
import { usePickBrand } from "../../hooks/usePickBrand";
// #4389 N3 — draft and free-only rows from the setup checklist.
import { useBrandSetupStates } from "../../hooks/useBrandSetupStates";
import { BRAND_SWITCHER_COPY } from "./brandSwitcherCopy";
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
                        ? ` · ${BRAND_SWITCHER_COPY.n3.freeOnlyTag}`
                        : ` · ${BRAND_SWITCHER_COPY.n3.progress(setupState.doneCount)}`;
                  const canDiscard =
                    setupState.kind === "draft" && canDeleteBrand(brand, user?.id ?? null);
                  // #4420 round-3 item 2 — the current brand is shown by the
                  // selected row and its check (and `selected` for screen
                  // readers), so the line no longer repeats "Current brand".
                  const subline = setupRest !== null ? null : followerLine;
                  const showDelete =
                    setupRest === null &&
                    onRequestDeleteBrand !== undefined &&
                    canDeleteBrand(brand, user?.id ?? null);
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
                          showDelete ? styles.brandRowWithDelete : null,
                        ]}
                        testID={`brand-switcher-rowbox-${brand.id}`}
                      >
                      <Pressable
                        onPress={() => handlePick(brand)}
                        onLongPress={canDiscard ? () => openDiscard(brand) : undefined}
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
                              <Text style={styles.brandSubDraft}>{BRAND_SWITCHER_COPY.n3.draftLabel}</Text>
                              {setupRest}
                            </Text>
                          ) : subline !== null ? (
                            <Text style={styles.brandSub} numberOfLines={1}>
                              {subline}
                            </Text>
                          ) : null}
                        </View>
                        {isActive ? (
                          <View style={styles.activeCheck} testID={`brand-switcher-check-${brand.id}`}>
                            <Icon name="check" size={16} color={color.ink} />
                          </View>
                        ) : null}
                      </Pressable>
                        {setupRest !== null ? (
                          <Pressable
                            onPress={() => openSetup(brand)}
                            onLongPress={canDiscard ? () => openDiscard(brand) : undefined}
                            accessibilityRole="button"
                            accessibilityLabel={`${BRAND_SWITCHER_COPY.n3.continue} ${brand.displayName}`}
                            hitSlop={4}
                            style={styles.rowContinueBtn}
                            testID={`brand-switcher-continue-${brand.id}`}
                          >
                            <Text style={styles.rowContinueLabel}>{BRAND_SWITCHER_COPY.n3.continue}</Text>
                          </Pressable>
                        ) : null}
                        {/* The row menu on a true draft: "Discard draft" (the
                            N1 confirm on its own route). Inline, after Continue.
                            #4389 (device r4): no per-row trash on unfinished
                            rows — check + Continue + trash left the name
                            "B…"; delete stays on the brand's profile. */}
                        {canDiscard ? (
                          <Pressable
                            onPress={() => openDiscard(brand)}
                            accessibilityRole="button"
                            accessibilityLabel={`${BRAND_SWITCHER_COPY.n3.discard}: ${brand.displayName}`}
                            hitSlop={8}
                            style={styles.rowMenuBtn}
                            testID={`brand-switcher-discard-${brand.id}`}
                          >
                            <Icon name="moreH" size={16} color={color.text3} />
                          </Pressable>
                        ) : null}
                      </View>
                      {/* Issue #1835 — PER-ROW gate, deliberately not a
                          sheet-level one. The switcher lists every brand you can
                          reach, owned or merely administered, so the trash must
                          be decided per brand: shown only on rows you own.
                          #4389 — an unfinished brand's row carries Continue
                          (and, on a draft, the Discard menu) instead. */}
                      {showDelete && onRequestDeleteBrand !== undefined ? (
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
                          <Icon name="trash" size={18} color={color.text2} />
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
  brandSubDraft: { color: color.text1, fontWeight: "600" },
  // 36pt pill; hitSlop 4 makes the target 44pt.
  rowContinueBtn: {
    height: 36,
    paddingHorizontal: space[4],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: color.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  rowMenuBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center", marginLeft: -space[1] },
  rowContinueLabel: { ...type.caption, color: color.text1, fontWeight: "600" },
  host: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[5],
    paddingTop: space[6],
    paddingBottom: space[4],
  },
  headerTitle: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
  },
  scrollArea: { flex: 1 },
  scrollContent: { gap: space[1], paddingHorizontal: space[5], paddingBottom: space[4] },
  loadingState: { flex: 1, justifyContent: "center", paddingHorizontal: space[5], paddingVertical: space[7] },
  emptyText: { fontSize: type.body.fontSize, lineHeight: type.body.lineHeight, color: color.text2, textAlign: "center" },
  brandRowOuter: { position: "relative" },
  brandRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    padding: space[4],
    borderRadius: radius.xl,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.transparent,
    backgroundColor: color.transparent,
  },
  // #4420 round-3 item 2 — the current brand is the one selected row: a
  // filled pill with a paper check, the rest sit flat on the sheet.
  brandRowActive: {
    borderColor: color.line,
    backgroundColor: color.card3,
  },
  // Room for the trash, which sits centred at the row's trailing edge.
  brandRowWithDelete: { paddingRight: size.iconBtn.md + space[2] },
  activeCheck: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: color.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  // The row box keeps its look; the switch target fills it up to the pill.
  brandRowSplit: { padding: 0, paddingRight: space[4], gap: space[2] },
  rowPick: { flex: 1, minHeight: 64, flexDirection: "row", alignItems: "center", gap: space[4], padding: space[4], paddingRight: 0 },
  brandTextCol: { flex: 1 },
  brandName: { fontSize: type.body.fontSize, lineHeight: type.body.lineHeight, fontWeight: "600", color: color.text1 },
  brandSub: { fontSize: type.caption.fontSize, lineHeight: type.caption.lineHeight, color: color.text3 },
  rowDeleteBtn: { position: "absolute", top: 0, bottom: 0, right: space[1], width: size.iconBtn.md, alignItems: "center", justifyContent: "center" },
  footer: { paddingHorizontal: space[5], paddingTop: space[4], paddingBottom: space[6], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
});

export default BrandSwitcherSheet;
