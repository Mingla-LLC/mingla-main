/**
 * META-ORCH-1148 sub-ORCH 2.0 — the Venue Suite SHELL.
 *
 * The suite container mounted by the Hub Venue tab. OWNS the `activeModule`
 * state machine and renders the responsive shell:
 *  - web desktop (isWideDesktop): a two-column master rail (260) + workspace,
 *    centered at venueSuiteMaxWidth (1200); the Hub chrome stays above.
 *  - web-phone + native: single column. The module nav is the venue module pill
 *    row, which on native/web-phone REPLACES the Hub offering pills via the
 *    `venueSuiteStore` bridge (rendered in `_layout.tsx`). The shell renders the
 *    pill row inline ONLY as a fallback when the layout bridge isn't driving it
 *    — to avoid a double row, the inline row is shown only on web-phone where
 *    the layout swap also applies; the layout is the single owner. (Native: the
 *    layout owns the row; the shell does not duplicate it.)
 *
 * Module dispatch (NO dead taps, §6):
 *  - overview  → <VenueListingContent> (the ORCH-1145 listing, VERBATIM) + an
 *                invitation card when the toggle is OFF.
 *  - settings  → <VenueSettingsModule>.
 *  - booking   → <VenueModuleComingSoon> (honest "set up next", not a dead tap).
 *
 * Bands C/D are not in the module union → cannot be selected → cannot dead-tap.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  radius,
  spacing,
  text as textTokens,
  typography,
  venueRailWidth,
  venueSuiteMaxWidth,
} from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import {
  useSetReservationsEnabled,
  useVenueReservationSettings,
} from "../../hooks/useVenueReservationSettings";
import { useVenueSuiteStore } from "../../store/venueSuiteStore";
import type { VenueModule } from "../../types/venueReservation";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { VenueListingContent } from "./VenueListingContent";
import { VenueModuleComingSoon } from "./VenueModuleComingSoon";
import { VenueSettingsModule } from "./VenueSettingsModule";
import { moduleSelfScrolls, venueScrollBottomPad } from "./venueShellScroll";
import {
  VENUE_MODULES,
  deriveVenueModules,
  isBookingModule,
} from "./venueModules";

export interface VenueSuiteShellProps {
  brandId: string | null;
  focus?: "feedback";
  initialModule?: VenueModule;
}

export function VenueSuiteShell({
  brandId,
  focus,
  initialModule = "overview",
}: VenueSuiteShellProps): React.ReactElement {
  const { isWideDesktop } = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  // Bottom-nav clearance — the floating BottomNav primitive (64px) + its
  // floating margin + the device home-indicator inset. `insets.bottom + 120`
  // is the shared nav-lock companion-pin pattern used by every Hub tab
  // (app/(tabs)/hub/events.tsx) and by VenueListingContent in tab mode, so the
  // last content row clears the nav on native + web-phone.
  const scrollBottomPad = venueScrollBottomPad(insets.bottom);

  const settingsQuery = useVenueReservationSettings(brandId);
  const reservationsEnabled = settingsQuery.data?.reservationsEnabled ?? false;
  const setEnabled = useSetReservationsEnabled(brandId);

  const visibleModules = useMemo(
    () => deriveVenueModules(reservationsEnabled),
    [reservationsEnabled],
  );

  const [activeModule, setActiveModule] = useState<VenueModule>(initialModule);

  // Guard: if the toggle flips OFF while on a booking module, snap to overview.
  useEffect(() => {
    if (isBookingModule(activeModule) && !reservationsEnabled) {
      setActiveModule("overview");
    }
  }, [activeModule, reservationsEnabled]);

  // Bridge to the layout's pill row (native/web-phone REPLACE the Hub pills).
  const syncStore = useVenueSuiteStore((s) => s.sync);
  const selectModule = useCallback((m: VenueModule): void => {
    setActiveModule(m);
  }, []);
  useEffect(() => {
    syncStore({ activeModule, visibleModules, selectModule });
  }, [syncStore, activeModule, visibleModules, selectModule]);

  const handleTurnOnReservations = useCallback((): void => {
    setEnabled.mutate(true, {
      onSuccess: () => {
        // Toggle-ON lands on Settings (the real 2.0 action; Tables is ComingSoon).
        setActiveModule("settings");
      },
    });
  }, [setEnabled]);

  const goToSettings = useCallback((): void => {
    setActiveModule("settings");
  }, []);

  // Overview mounts <VenueListingContent>, which OWNS its own ScrollView (with
  // its own `insets.bottom + 120` clearance) — so the shell must NOT wrap it in
  // a second, outer ScrollView (nested same-axis scroll = the "doesn't scroll
  // properly" symptom). Settings + the booking ComingSoon render plain Views, so
  // the shell supplies the scroll container + bottom-nav clearance for them.
  const workspaceSelfScrolls = moduleSelfScrolls(activeModule);

  const renderWorkspace = (): React.ReactElement => {
    if (activeModule === "overview") {
      // The invitation card is pinned ABOVE the self-scrolling
      // <VenueListingContent> (which owns its own ScrollView + bottom-nav
      // clearance). Pinning it — rather than nesting it inside a second outer
      // ScrollView — keeps the CTA visible AND avoids the nested same-axis
      // scroll that broke scrolling on native.
      return (
        <View style={styles.overviewWrap}>
          {!reservationsEnabled ? (
            <View style={styles.invitationWrap}>
              <GlassCard variant="elevated" style={styles.invitationCard}>
                <Text style={styles.invitationTitle}>
                  Take table reservations on Mingla
                </Text>
                <Text style={styles.invitationBody}>
                  Free to switch on. Manage tables, hours, and bookings in one
                  place.
                </Text>
                <Button
                  label="Turn on Reservations"
                  onPress={handleTurnOnReservations}
                  variant="primary"
                  size="md"
                  loading={setEnabled.isPending}
                  fullWidth
                  testID="venue-overview-turn-on-reservations"
                />
              </GlassCard>
            </View>
          ) : null}
          <VenueListingContent
            brandId={brandId}
            focus={focus}
            chromeMode="tab"
          />
        </View>
      );
    }
    if (activeModule === "settings") {
      return <VenueSettingsModule brandId={brandId} />;
    }
    // Booking band → honest ComingSoon (never a dead tap).
    return (
      <VenueModuleComingSoon module={activeModule} onGoToSettings={goToSettings} />
    );
  };

  // ----- Web desktop: two-column master rail + workspace. -----
  if (isWideDesktop) {
    return (
      <View style={styles.desktopHost} testID="venue-suite-shell-desktop">
        <View style={styles.desktopCentered}>
          <View
            style={styles.desktopRail}
            accessibilityRole="tablist"
          >
            <DesktopRail
              modules={visibleModules}
              activeModule={activeModule}
              onSelect={setActiveModule}
            />
          </View>
          <View style={styles.desktopWorkspace}>
            {workspaceSelfScrolls ? (
              // Overview self-scrolls; avoid nesting a second ScrollView.
              renderWorkspace()
            ) : (
              <ScrollView
                contentContainerStyle={[
                  styles.desktopScroll,
                  { paddingBottom: scrollBottomPad },
                ]}
              >
                {renderWorkspace()}
              </ScrollView>
            )}
          </View>
        </View>
      </View>
    );
  }

  // ----- Web-phone + native: single column. -----
  // On NATIVE, the Hub `_layout.tsx` renders the module pill row in place of the
  // Hub pills (via the store bridge), so the shell does NOT render its own row
  // (avoids a double row). On WEB-phone the same layout swap applies. The shell
  // body is just the workspace.
  return (
    <View style={styles.phoneHost} testID="venue-suite-shell-phone">
      {workspaceSelfScrolls ? (
        // Overview self-scrolls (VenueListingContent owns the ScrollView + its
        // own bottom-nav clearance) — render it directly, no outer scroll.
        renderWorkspace()
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.phoneScroll,
            { paddingBottom: scrollBottomPad },
          ]}
          showsVerticalScrollIndicator={false}
          testID="venue-suite-shell-phone-scroll"
        >
          {renderWorkspace()}
        </ScrollView>
      )}
    </View>
  );
}

interface DesktopRailProps {
  modules: readonly VenueModule[];
  activeModule: VenueModule;
  onSelect: (m: VenueModule) => void;
}

function DesktopRail({
  modules,
  activeModule,
  onSelect,
}: DesktopRailProps): React.ReactElement {
  // Band section headers: Command (A) then Booking (B). C/D absent in 2.0.
  const command = modules.filter((m) => VENUE_MODULES[m].band === "command");
  const booking = modules.filter((m) => VENUE_MODULES[m].band === "booking");
  // Keep Overview (command) first, then Booking band, then Settings (command).
  const orderedCommandTop = command.filter((m) => m === "overview");
  const orderedCommandBottom = command.filter((m) => m !== "overview");

  const renderRow = (m: VenueModule): React.ReactElement => {
    const isActive = m === activeModule;
    return (
      <Pressable
        key={m}
        accessibilityRole="tab"
        accessibilityState={{ selected: isActive }}
        accessibilityLabel={`${VENUE_MODULES[m].label} module`}
        onPress={() => onSelect(m)}
        style={[styles.railRow, isActive ? styles.railRowActive : null]}
        testID={`venue-rail-${m}`}
      >
        {isActive ? <View style={styles.railActiveBar} /> : null}
        <Text
          style={[
            styles.railLabel,
            isActive ? styles.railLabelActive : null,
          ]}
        >
          {VENUE_MODULES[m].label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.railInner}>
      <Text style={styles.railSection}>Command</Text>
      {orderedCommandTop.map(renderRow)}
      {booking.length > 0 ? (
        <>
          <Text style={styles.railSection}>Booking</Text>
          {booking.map(renderRow)}
        </>
      ) : null}
      {orderedCommandBottom.map(renderRow)}
    </View>
  );
}

const styles = StyleSheet.create({
  // desktop
  desktopHost: {
    flex: 1,
  },
  desktopCentered: {
    flex: 1,
    flexDirection: "row",
    width: "100%",
    maxWidth: venueSuiteMaxWidth,
    alignSelf: "center",
  },
  desktopRail: {
    width: venueRailWidth,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  railInner: {
    gap: spacing.xxs,
  },
  railSection: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  railRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    ...Platform.select({ web: { cursor: "pointer" }, default: {} }),
  },
  railRowActive: {
    backgroundColor: accent.tint,
  },
  railActiveBar: {
    position: "absolute",
    left: 0,
    top: spacing.xs,
    bottom: spacing.xs,
    width: 3,
    borderRadius: radius.full,
    backgroundColor: accent.warm,
  },
  railLabel: {
    ...typography.body,
    color: textTokens.secondary,
  },
  railLabelActive: {
    color: textTokens.primary,
    fontWeight: "600",
  },
  desktopWorkspace: {
    flex: 1,
    paddingLeft: spacing.lg,
  },
  desktopScroll: {
    // paddingBottom supplied inline (insets.bottom + 120) for nav clearance.
  },
  // phone / native
  phoneHost: {
    flex: 1,
  },
  phoneScroll: {
    // paddingBottom supplied inline (insets.bottom + 120) for nav clearance.
  },
  // overview + invitation
  overviewWrap: {
    flex: 1,
  },
  invitationWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  invitationCard: {
    gap: spacing.sm,
  },
  invitationTitle: {
    ...typography.h3,
    color: textTokens.primary,
  },
  invitationBody: {
    ...typography.body,
    color: textTokens.secondary,
  },
});

export default VenueSuiteShell;
