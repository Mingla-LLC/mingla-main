/**
 * Home tab — Cycle 1 Account anchor.
 *
 * States:
 *   - Empty (brands.length === 0)              → "No brands yet" prompt + topbar chip CTA
 *   - Populated, no live event (currentBrand)  → 7-day aggregate hero + KPI grid + Build CTA
 *   - Populated with live event                → Live KPI hero + KPI grid + Upcoming list + Build CTA
 *
 * Brand-chip on TopBar opens BrandSwitcherSheet (mode auto-derives from list state).
 * Sheet's onBrandCreated → Toast "{displayName} is ready" (per dispatch AC#2).
 *
 * Stub event-list rows are [TRANSITIONAL] hardcoded — replaced by real event
 * fetch in B1+ when event endpoints land.
 *
 * Cycle 3 wires draft rows from draftEventStore — those rows ARE real (not
 * stub). Stub rows below remain until Cycle 9 ships the live events list.
 * Cycle 3 also retires 2 TRANSITIONAL Toasts ("Event creation lands Cycle 3"
 * + "Events list lands Cycle 3") — both now navigate.
 */

import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandDeleteSheet } from "../../src/components/brand/BrandDeleteSheet";
import { BrandSwitcherSheet } from "../../src/components/brand/BrandSwitcherSheet";
import { EventCover } from "../../src/components/ui/EventCover";
import { GlassCard } from "../../src/components/ui/GlassCard";
import { Icon } from "../../src/components/ui/Icon";
import { KpiTile } from "../../src/components/ui/KpiTile";
import { Pill } from "../../src/components/ui/Pill";
import { Toast } from "../../src/components/ui/Toast";
import { TopBar } from "../../src/components/ui/TopBar";
import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import { useAuth } from "../../src/context/AuthContext";
import {
  useBrandList,
  useCurrentBrand,
  useCurrentBrandStore,
  type Brand,
} from "../../src/store/currentBrandStore";
import { useDraftsForBrand } from "../../src/store/draftEventStore";
import { formatGbpRound } from "../../src/utils/currency";
import { formatRelativeTime } from "../../src/utils/relativeTime";

interface ToastState {
  visible: boolean;
  message: string;
}

interface StubUpcomingRow {
  id: string;
  title: string;
  when: string;
  status: "live" | "draft";
  hue: number;
  sold: string;
}

// [TRANSITIONAL] stub upcoming-events list — removed in B1 backend cycle
// when event endpoints land. Always 2 rows in addition to the brand's
// currentLiveEvent so the "Upcoming" section reads non-trivially.
const STUB_UPCOMING_ROWS: StubUpcomingRow[] = [
  {
    id: "u1",
    title: "Sunday Languor Brunch",
    when: "Sun · 12:00",
    status: "live",
    hue: 290,
    sold: "62 / 80",
  },
  {
    id: "u2",
    title: "The Long Lunch (Series)",
    when: "Recurring · weekly",
    status: "draft",
    hue: 150,
    sold: "—",
  },
];

const greetingLabel = (): string => {
  const hour = new Date().getHours();
  if (hour < 5) return "Late night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

export default function HomeTab(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const brands = useBrandList();
  const currentBrand = useCurrentBrand();
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const drafts = useDraftsForBrand(currentBrand?.id ?? null);
  const [sheetVisible, setSheetVisible] = useState<boolean>(false);
  // Cycle 17e-A REWORK: BrandDeleteSheet state — opens from BrandSwitcherSheet
  // trash icon taps. Mirrors account.tsx pattern per ORCH-0734-RW SPEC §3.3.
  const [deleteSheetVisible, setDeleteSheetVisible] = useState<boolean>(false);
  const [brandPendingDelete, setBrandPendingDelete] = useState<Brand | null>(
    null,
  );
  const [toast, setToast] = useState<ToastState>({ visible: false, message: "" });

  const handleOpenSwitcher = useCallback((): void => {
    setSheetVisible(true);
  }, []);

  const handleCloseSheet = useCallback((): void => {
    setSheetVisible(false);
  }, []);

  const handleBrandCreated = useCallback((brand: Brand): void => {
    setToast({ visible: true, message: `${brand.displayName} is ready` });
  }, []);

  // Cycle 17e-A REWORK: BrandSwitcherSheet trash tap → open BrandDeleteSheet
  const handleRequestDeleteBrand = useCallback((brand: Brand): void => {
    setBrandPendingDelete(brand);
    setDeleteSheetVisible(true);
  }, []);

  const handleCloseDeleteSheet = useCallback((): void => {
    setDeleteSheetVisible(false);
    // Don't clear brandPendingDelete immediately — exit animation reads it
  }, []);

  const handleBrandDeleted = useCallback(
    (deletedBrandId: string): void => {
      // Clear currentBrand if it matches deleted brand (server already cleared
      // default_brand_id per softDeleteBrand Step 3; this clears local UI state)
      const current = useCurrentBrandStore.getState().currentBrand;
      if (current !== null && current.id === deletedBrandId) {
        setCurrentBrand(null);
      }
      const deleted = brandPendingDelete;
      setBrandPendingDelete(null);
      setToast({
        visible: true,
        message: `${deleted?.displayName ?? "Brand"} deleted`,
      });
    },
    [setCurrentBrand, brandPendingDelete],
  );

  const handleDismissToast = useCallback((): void => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleBuildEvent = useCallback((): void => {
    if (currentBrand === null) {
      setToast({ visible: true, message: "Create a brand first." });
      setSheetVisible(true);
      return;
    }
    router.push("/event/create" as never);
  }, [currentBrand, router]);

  const handleSeeAllEvents = useCallback((): void => {
    router.push("/(tabs)/events" as never);
  }, [router]);

  const handleOpenDraft = useCallback(
    (draftId: string): void => {
      router.push(`/event/${draftId}/edit` as never);
    },
    [router],
  );

  const isEmpty = brands.length === 0 || currentBrand === null;
  const liveEvent = currentBrand?.currentLiveEvent ?? null;

  const liveProgress = useMemo<number>(() => {
    if (liveEvent === null) return 0;
    if (liveEvent.goalGbp <= 0) return 0;
    return Math.min(1, liveEvent.soldGbp / liveEvent.goalGbp);
  }, [liveEvent]);

  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <View style={styles.barWrap}>
        <TopBar leftKind="brand" onBrandTap={handleOpenSwitcher} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {isEmpty ? (
          <View style={styles.emptyCol}>
            <GlassCard variant="elevated" padding={spacing.lg}>
              <Text style={styles.greetingTier}>{greetingLabel()}</Text>
              <Text style={styles.emptyTitle}>No brands yet</Text>
              <Text style={styles.emptyBody}>
                Tap{" "}
                <Text style={styles.emptyChipName}>Create brand</Text>
                {" "}in the top bar to set up your first brand. You can edit it
                any time.
              </Text>
            </GlassCard>
          </View>
        ) : (
          <>
            <View style={styles.greetingCol}>
              <Text style={styles.greetingTier}>{greetingLabel()}</Text>
              <Text style={styles.greetingHey}>Hey, {currentBrand.displayName}</Text>
            </View>

            {liveEvent !== null ? (
              <GlassCard variant="elevated" padding={spacing.lg}>
                <View style={styles.heroLiveTagRow}>
                  <Pill variant="live" livePulse>
                    Live tonight
                  </Pill>
                </View>
                <Text style={styles.heroEventName}>{liveEvent.name}</Text>
                <View style={styles.heroAmountRow}>
                  <Text style={styles.heroAmountSold}>
                    {formatGbpRound(liveEvent.soldGbp)}
                  </Text>
                  <Text style={styles.heroAmountGoal}>
                    {" "}/ {formatGbpRound(liveEvent.goalGbp)}
                  </Text>
                </View>
                <View style={styles.progressBarTrack}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${Math.round(liveProgress * 100)}%` },
                    ]}
                  />
                </View>
                <View style={styles.heroStatRow}>
                  <View style={styles.heroStatCell}>
                    <Text style={styles.heroStatValue}>
                      {Math.round(liveEvent.soldGbp / 30)}
                    </Text>
                    <Text style={styles.heroStatLabel}>Tickets sold</Text>
                  </View>
                  <View style={styles.heroStatCell}>
                    <Text style={styles.heroStatValue}>400</Text>
                    <Text style={styles.heroStatLabel}>Capacity</Text>
                  </View>
                  <View style={styles.heroStatCell}>
                    <Text style={styles.heroStatValue}>0</Text>
                    <Text style={styles.heroStatLabel}>Scanned</Text>
                  </View>
                </View>
              </GlassCard>
            ) : (
              <KpiTile
                label="Last 7 days"
                value={formatGbpRound(currentBrand.stats.rev)}
                delta="+18%"
                deltaUp
              />
            )}

            <View style={styles.kpiGrid}>
              <KpiTile
                label="Active events"
                value={currentBrand.stats.events}
                sub={liveEvent !== null ? "1 live · 2 upcoming" : "Nothing live tonight"}
                style={styles.kpiCell}
              />
              <KpiTile
                label="Followers"
                value={currentBrand.stats.followers.toLocaleString("en-GB")}
                sub="audience"
                style={styles.kpiCell}
              />
            </View>

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Upcoming</Text>
              <Pressable
                onPress={handleSeeAllEvents}
                accessibilityRole="link"
                accessibilityLabel="See all upcoming events"
              >
                <Text style={styles.sectionLink}>See all</Text>
              </Pressable>
            </View>

            <View style={styles.eventsCol}>
              {/* Cycle 3 — real draft rows from draftEventStore (NOT stub). */}
              {drafts.map((draft) => (
                <Pressable
                  key={draft.id}
                  onPress={() => handleOpenDraft(draft.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Resume draft: ${draft.name || "Untitled"}`}
                  style={styles.eventRow}
                >
                  <View style={styles.eventCoverWrap}>
                    <EventCover
                      hue={draft.coverHue}
                      radius={12}
                      label=""
                      height={56}
                      width={56}
                    />
                  </View>
                  <View style={styles.eventTextCol}>
                    <View style={styles.eventPillRow}>
                      <Pill variant="draft">Draft</Pill>
                    </View>
                    <Text style={styles.eventTitle} numberOfLines={1}>
                      {draft.name.length > 0 ? draft.name : "Untitled draft"}
                    </Text>
                    <Text style={styles.eventWhen} numberOfLines={1}>
                      {`Step ${draft.lastStepReached + 1} of 7 · ${formatRelativeTime(draft.updatedAt)}`}
                    </Text>
                  </View>
                  <View style={styles.eventSoldCol}>
                    <Text style={styles.eventSoldValue}>—</Text>
                    <Text style={styles.eventSoldLabel}>resume</Text>
                  </View>
                </Pressable>
              ))}
              {liveEvent !== null ? (
                <View style={styles.eventRow}>
                  <View style={styles.eventCoverWrap}>
                    <EventCover hue={25} radius={12} label="" height={56} width={56} />
                  </View>
                  <View style={styles.eventTextCol}>
                    <View style={styles.eventPillRow}>
                      <Pill variant="live" livePulse>
                        Live
                      </Pill>
                    </View>
                    <Text style={styles.eventTitle} numberOfLines={1}>
                      {liveEvent.name}
                    </Text>
                    <Text style={styles.eventWhen} numberOfLines={1}>
                      Tonight · 21:00
                    </Text>
                  </View>
                  <View style={styles.eventSoldCol}>
                    <Text style={styles.eventSoldValue}>
                      {Math.round(liveEvent.soldGbp / 30)} / 400
                    </Text>
                    <Text style={styles.eventSoldLabel}>sold</Text>
                  </View>
                </View>
              ) : null}
              {STUB_UPCOMING_ROWS.map((row) => (
                <View key={row.id} style={styles.eventRow}>
                  <View style={styles.eventCoverWrap}>
                    <EventCover hue={row.hue} radius={12} label="" height={56} width={56} />
                  </View>
                  <View style={styles.eventTextCol}>
                    <View style={styles.eventPillRow}>
                      <Pill variant={row.status === "live" ? "live" : "draft"}>
                        {row.status === "live" ? "Live" : "Draft"}
                      </Pill>
                    </View>
                    <Text style={styles.eventTitle} numberOfLines={1}>
                      {row.title}
                    </Text>
                    <Text style={styles.eventWhen} numberOfLines={1}>
                      {row.when}
                    </Text>
                  </View>
                  <View style={styles.eventSoldCol}>
                    <Text style={styles.eventSoldValue}>{row.sold}</Text>
                    <Text style={styles.eventSoldLabel}>sold</Text>
                  </View>
                </View>
              ))}
            </View>

            <Pressable
              onPress={handleBuildEvent}
              accessibilityRole="button"
              accessibilityLabel="Build a new event"
              style={styles.buildCta}
            >
              <View style={styles.buildCtaIconWrap}>
                <Icon name="plus" size={20} color={accent.warm} />
              </View>
              <View style={styles.buildCtaTextCol}>
                <Text style={styles.buildCtaTitle}>Build a new event</Text>
                <Text style={styles.buildCtaSub}>About 4 minutes</Text>
              </View>
            </Pressable>
          </>
        )}
      </ScrollView>

      <BrandSwitcherSheet
        visible={sheetVisible}
        onClose={handleCloseSheet}
        onBrandCreated={handleBrandCreated}
        onRequestDeleteBrand={handleRequestDeleteBrand}
      />

      <BrandDeleteSheet
        visible={deleteSheetVisible}
        brand={brandPendingDelete}
        accountId={user?.id ?? null}
        onClose={handleCloseDeleteSheet}
        onDeleted={handleBrandDeleted}
      />

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={handleDismissToast}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  barWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xl * 4,
    gap: spacing.md,
  },
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },

  // Empty state ---------------------------------------------------------
  emptyCol: {
    gap: spacing.md,
  },
  emptyTitle: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
    marginTop: spacing.xs,
  },
  emptyBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginTop: spacing.sm,
  },
  emptyChipName: {
    color: accent.warm,
    fontWeight: "600",
  },

  // Greeting ------------------------------------------------------------
  greetingCol: {
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.xs,
  },
  greetingTier: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 0.4,
    color: textTokens.tertiary,
    textTransform: "uppercase",
  },
  greetingHey: {
    fontSize: typography.h1.fontSize,
    lineHeight: typography.h1.lineHeight,
    fontWeight: typography.h1.fontWeight,
    letterSpacing: typography.h1.letterSpacing,
    color: textTokens.primary,
    marginTop: 4,
  },

  // Hero — live event ---------------------------------------------------
  heroLiveTagRow: {
    flexDirection: "row",
    marginBottom: spacing.sm,
  },
  heroEventName: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginBottom: 4,
  },
  heroAmountRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: spacing.md,
  },
  heroAmountSold: {
    fontSize: 32,
    lineHeight: 36,
    fontWeight: "700",
    letterSpacing: -0.4,
    color: textTokens.primary,
  },
  heroAmountGoal: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "500",
    color: textTokens.tertiary,
  },
  progressBarTrack: {
    height: 4,
    borderRadius: 999,
    backgroundColor: glass.tint.profileBase,
    overflow: "hidden",
    marginBottom: spacing.md,
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: accent.warm,
    borderRadius: 999,
  },
  heroStatRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  heroStatCell: {
    flex: 1,
  },
  heroStatValue: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
  },
  heroStatLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: 2,
  },

  // KPI grid ------------------------------------------------------------
  kpiGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  kpiCell: {
    flex: 1,
  },

  // Section header ------------------------------------------------------
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm,
  },
  sectionTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    letterSpacing: typography.h3.letterSpacing,
    color: textTokens.primary,
  },
  sectionLink: {
    fontSize: typography.bodySm.fontSize,
    color: accent.warm,
    fontWeight: "600",
  },

  // Event rows ----------------------------------------------------------
  eventsCol: {
    gap: spacing.sm,
  },
  eventRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radiusTokens.lg,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  eventCoverWrap: {
    width: 56,
    height: 56,
    flexShrink: 0,
  },
  eventTextCol: {
    flex: 1,
    minWidth: 0,
  },
  eventPillRow: {
    flexDirection: "row",
    marginBottom: 2,
  },
  eventTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: 2,
  },
  eventWhen: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
  },
  eventSoldCol: {
    alignItems: "flex-end",
    paddingRight: 2,
  },
  eventSoldValue: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  eventSoldLabel: {
    fontSize: 10,
    color: textTokens.tertiary,
  },

  // Build CTA -----------------------------------------------------------
  buildCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: accent.tint,
    borderStyle: "dashed",
    marginTop: spacing.sm,
  },
  buildCtaIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    alignItems: "center",
    justifyContent: "center",
  },
  buildCtaTextCol: {
    flex: 1,
  },
  buildCtaTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  buildCtaSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    marginTop: 2,
  },
});
