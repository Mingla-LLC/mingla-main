/**
 * Events tab — Drafts section (Cycle 3 partial-light).
 *
 * Cycle 3 lights up the Drafts section ONLY. Live / Upcoming / Past
 * sections land Cycle 9 per BUSINESS_PRD §5.0. Originally a placeholder
 * deferred entirely to Cycle 9, but Cycle 3 ships drafts here so J-E4
 * resume has a destination beyond Home.
 *
 * Cycle 2 J-A8 polish wired the brand-chip to BrandSwitcherSheet
 * (matches home.tsx + account.tsx pattern).
 */

import React, { useCallback, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandSwitcherSheet } from "../../src/components/brand/BrandSwitcherSheet";
import { EventCover } from "../../src/components/ui/EventCover";
import { GlassCard } from "../../src/components/ui/GlassCard";
import { IconChrome } from "../../src/components/ui/IconChrome";
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
import {
  useCurrentBrand,
  type Brand,
} from "../../src/store/currentBrandStore";
import { useDraftsForBrand } from "../../src/store/draftEventStore";
import { formatRelativeTime } from "../../src/utils/relativeTime";

interface ToastState {
  visible: boolean;
  message: string;
}

export default function EventsTab(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const currentBrand = useCurrentBrand();
  const drafts = useDraftsForBrand(currentBrand?.id ?? null);
  const [sheetVisible, setSheetVisible] = useState<boolean>(false);
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

  const handleOpenDraft = useCallback(
    (draftId: string): void => {
      router.push(`/event/${draftId}/edit` as never);
    },
    [router],
  );

  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <View style={styles.barWrap}>
        <TopBar
          leftKind="brand"
          onBrandTap={handleOpenSwitcher}
          rightSlot={
            <IconChrome
              icon="plus"
              size={36}
              onPress={handleBuildEvent}
              accessibilityLabel="Build a new event"
            />
          }
        />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.headerTitle}>Events</Text>

        {/* Drafts section */}
        <Text style={styles.sectionLabel}>DRAFTS</Text>
        {drafts.length === 0 ? (
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.emptyTitle}>No drafts yet</Text>
            <Text style={styles.emptyBody}>
              Tap "Build a new event" below to start your first draft.
            </Text>
            <Pressable
              onPress={handleBuildEvent}
              accessibilityRole="button"
              accessibilityLabel="Build a new event"
              style={styles.emptyCta}
            >
              <Text style={styles.emptyCtaLabel}>Build a new event</Text>
            </Pressable>
          </GlassCard>
        ) : (
          <View style={styles.draftsCol}>
            {drafts.map((draft) => (
              <Pressable
                key={draft.id}
                onPress={() => handleOpenDraft(draft.id)}
                accessibilityRole="button"
                accessibilityLabel={`Resume draft: ${draft.name || "Untitled"}`}
                style={styles.draftRow}
              >
                <View style={styles.draftCoverWrap}>
                  <EventCover
                    hue={draft.coverHue}
                    radius={12}
                    label=""
                    height={56}
                    width={56}
                  />
                </View>
                <View style={styles.draftTextCol}>
                  <View style={styles.draftPillRow}>
                    <Pill variant="draft">Draft</Pill>
                  </View>
                  <Text style={styles.draftTitle} numberOfLines={1}>
                    {draft.name.length > 0 ? draft.name : "Untitled draft"}
                  </Text>
                  <Text style={styles.draftSub} numberOfLines={1}>
                    {`Step ${draft.lastStepReached + 1} of 7 · ${formatRelativeTime(draft.updatedAt)}`}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        <Text style={styles.footerNote}>
          Live, Upcoming, and Past sections land Cycle 9.
        </Text>
      </ScrollView>

      <BrandSwitcherSheet
        visible={sheetVisible}
        onClose={handleCloseSheet}
        onBrandCreated={handleBrandCreated}
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
    gap: spacing.md,
  },
  headerTitle: {
    fontSize: typography.h1.fontSize,
    lineHeight: typography.h1.lineHeight,
    fontWeight: typography.h1.fontWeight,
    letterSpacing: typography.h1.letterSpacing,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: textTokens.tertiary,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    letterSpacing: typography.h3.letterSpacing,
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  emptyBody: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  emptyCta: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    alignSelf: "flex-start",
  },
  emptyCtaLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  draftsCol: {
    gap: spacing.sm,
  },
  draftRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radiusTokens.lg,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  draftCoverWrap: {
    width: 56,
    height: 56,
    flexShrink: 0,
  },
  draftTextCol: {
    flex: 1,
    minWidth: 0,
  },
  draftPillRow: {
    flexDirection: "row",
    marginBottom: 2,
  },
  draftTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: 2,
  },
  draftSub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
  },
  footerNote: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    fontStyle: "italic",
    textAlign: "center",
    marginTop: spacing.lg,
  },
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },
});
