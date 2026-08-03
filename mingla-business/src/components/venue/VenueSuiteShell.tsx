/**
 * META-ORCH-1148 sub-ORCH 2.0 — the Venue Suite SHELL.
 *
 * The suite container mounted by the Hub Venue tab. OWNS the `activeModule`
 * state machine and renders the responsive shell:
 *  - web desktop (isWideDesktop): a two-column master rail + workspace,
 *    left-anchored and filling the full page width (ORCH-1184 removed the
 *    1200px cap); the Hub chrome stays above.
 *  - web-phone + native: single column. The module nav is the venue module pill
 *    row, which on native/web-phone REPLACES the Hub offering pills via the
 *    `venueSuiteStore` bridge (rendered in `_layout.tsx`). The shell renders the
 *    pill row inline ONLY as a fallback when the layout bridge isn't driving it
 *    — to avoid a double row, the inline row is shown only on web-phone where
 *    the layout swap also applies; the layout is the single owner. (Native: the
 *    layout owns the row; the shell does not duplicate it.)
 *
 * Module dispatch (NO dead taps, §6):
 *  - overview  → VenueIntelligenceModule (ORCH-1186-B venue intelligence
 *                dashboard) + a reservations-activation card when the toggle is
 *                OFF. (The listing recap relocated to Settings in Leg 1.)
 *  - settings  → <VenueSettingsModule>.
 *  - booking   → live operator modules: Tables (2.1a) · Availability (2.1a) ·
 *                Reservations (2.1b) · Waitlist (2.1b). No ComingSoon left.
 *
 * Bands C/D are not in the module union → cannot be selected → cannot dead-tap.
 *
 * META-ORCH-1255 Leg B — VENUE-SCOPED: the shell takes `venueId` and passes it
 * to every module + the reservations-settings hooks, so everything on screen
 * belongs to ONE venue_listings row. Lineage note for the ORCH-1040/1145
 * source contract: the venue tab originally mounted `VenueListingContent`
 * with `chromeMode="tab"` directly; ORCH-1186 relocated that listing recap
 * into the Settings module, and 1255 hosts this shell on the pushed
 * per-venue page (`/venue/{venueId}`) instead of the Hub tab. `VenueMenuModule`
 * stays brand-keyed ([TRANSITIONAL-3] — menus are brand-level content).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import {
  useSetReservationsEnabled,
  useVenueReservationSettings,
} from "../../hooks/useVenueReservationSettings";
import { useVenueSuiteStore } from "../../store/venueSuiteStore";
import type { VenueModule } from "../../types/venueReservation";
import type { SuiteDesktopModule } from "../suite/SuiteDesktopShell";
import { SuiteDesktopShell } from "../suite/SuiteDesktopShell";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { VenueAvailabilityModule } from "./VenueAvailabilityModule";
import { VenueIntelligenceModule } from "./VenueIntelligenceModule";
import { VenueMenuModule } from "./VenueMenuModule";
import { VenueReservationsModule } from "./VenueReservationsModule";
import { VenueSettingsModule } from "./VenueSettingsModule";
import { VenueTablesModule } from "./VenueTablesModule";
import { VenueWaitlistModule } from "./VenueWaitlistModule";
import { moduleSelfScrolls, venueScrollBottomPad } from "./venueShellScroll";
import {
  VENUE_MODULES,
  deriveVenueModules,
  isBookingModule,
} from "./venueModules";

export interface VenueSuiteShellProps {
  brandId: string | null;
  /** META-ORCH-1255 — the venue every module is scoped to. */
  venueId?: string | null;
  focus?: "feedback";
  initialModule?: VenueModule;
}

export function VenueSuiteShell({
  brandId,
  venueId = null,
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

  const settingsQuery = useVenueReservationSettings(brandId, venueId);
  const reservationsEnabled = settingsQuery.data?.reservationsEnabled ?? false;
  const setEnabled = useSetReservationsEnabled(brandId, venueId);

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

  // Overview mounts the VenueIntelligenceModule, which OWNS its own ScrollView
  // (with its own `insets.bottom + 120` clearance) — so the shell must NOT wrap
  // it in a second, outer ScrollView (nested same-axis scroll = the "doesn't
  // scroll properly" symptom). Settings + the booking ComingSoon render plain
  // Views, so the shell supplies the scroll container + clearance for them.
  const workspaceSelfScrolls = moduleSelfScrolls(activeModule);

  // Issue #1484 — the shared desktop shell takes `{ key, label }` rows and a
  // string-keyed `onSelect`. Ordering stays venue-owned (band grouping); the
  // select handler resolves the string back through `visibleModules`, so an
  // unknown key can never write a bogus module into state (no `as` cast).
  const railModules = useMemo(
    () => deriveVenueRailModules(visibleModules),
    [visibleModules],
  );
  const handleRailSelect = useCallback(
    (key: string): void => {
      const next = visibleModules.find((m) => m === key);
      if (next !== undefined) setActiveModule(next);
    },
    [visibleModules],
  );

  const renderWorkspace = (): React.ReactElement => {
    if (activeModule === "overview") {
      // ORCH-1186-B — the Overview slot is now the venue INTELLIGENCE dashboard
      // (the listing recap relocated to Settings by Leg 1). The reservations-
      // activation invitation card is pinned ABOVE the self-scrolling
      // <VenueIntelligenceModule> (which owns its own ScrollView + bottom-nav
      // clearance). Pinning it — rather than nesting it inside a second outer
      // ScrollView — keeps the CTA visible AND avoids the nested same-axis
      // scroll that broke scrolling on native. (`focus` is the venue-claim
      // feedback deep-link, which followed the recap into Settings — it is no
      // longer consumed at the Overview slot.)
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
          {/* META-ORCH-1255(C) D-D: venue-scoped so the RPC resolves THIS
              venue's place signals + timezone (the legacy brand place pointer
              is inert for new venues). */}
          <VenueIntelligenceModule brandId={brandId} venueId={venueId} />
        </View>
      );
    }
    if (activeModule === "settings") {
      return <VenueSettingsModule brandId={brandId} venueId={venueId} />;
    }
    // ORCH-1186-C — the always-visible command-band DISPLAY-ONLY menu builder
    // (independent of the reservations toggle). Renders inside the shell's
    // ScrollView (moduleSelfScrolls("menu") === false), like Settings.
    if (activeModule === "menu") {
      return <VenueMenuModule brandId={brandId} venueId={venueId} />;
    }
    // 2.1a — Tables + Availability LIVE. 2.1b — Reservations + Waitlist LIVE.
    // The whole booking band is now real operator UI (no ComingSoon left).
    if (activeModule === "tables") {
      return <VenueTablesModule brandId={brandId} venueId={venueId} />;
    }
    if (activeModule === "availability") {
      return <VenueAvailabilityModule brandId={brandId} venueId={venueId} />;
    }
    if (activeModule === "reservations") {
      return <VenueReservationsModule brandId={brandId} venueId={venueId} />;
    }
    // The remaining booking module: waitlist.
    return <VenueWaitlistModule brandId={brandId} venueId={venueId} />;
  };

  // ----- Web desktop: two-column master rail + workspace. -----
  // Issue #1484 [stay-desktop-shell] — the layout itself now lives in the
  // SHARED `SuiteDesktopShell` (decision D2) so the Stay suite renders the
  // identical rail + full-width workspace instead of its own phone-first
  // template. The rendered output here is UNCHANGED: same `desktopHost` /
  // `desktopCentered` / `desktopRail` / `desktopWorkspace` tree, same
  // `venue-suite-shell-desktop` + `venue-rail-<module>` testIDs, same
  // tablist/tab a11y roles, same width math (NO maxWidth cap — ORCH-1184).
  if (isWideDesktop) {
    return (
      <SuiteDesktopShell
        modules={railModules}
        activeModule={activeModule}
        onSelect={handleRailSelect}
        workspaceSelfScrolls={workspaceSelfScrolls}
        scrollBottomPad={scrollBottomPad}
        railTestIdPrefix="venue-rail-"
        testID="venue-suite-shell-desktop"
      >
        {renderWorkspace()}
      </SuiteDesktopShell>
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
        // Overview self-scrolls (VenueIntelligenceModule owns the ScrollView +
        // its own bottom-nav clearance) — render it directly, no outer scroll.
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

/**
 * Rail ORDER (ORCH-1184 removed the Command/Booking captions, so the bands now
 * drive order ONLY): Overview (command) first, then the Booking band, then the
 * remaining command modules (Menu, Settings). Bands C/D are absent in 2.0.
 *
 * Issue #1484 — this derivation stayed in the venue shell (it is venue-band
 * specific); only the RENDERING moved to `SuiteDesktopShell`. The emitted list
 * is identical to what the old local `DesktopRail` mapped over.
 */
export function deriveVenueRailModules(
  modules: readonly VenueModule[],
): SuiteDesktopModule[] {
  const command = modules.filter((m) => VENUE_MODULES[m].band === "command");
  const booking = modules.filter((m) => VENUE_MODULES[m].band === "booking");
  const orderedCommandTop = command.filter((m) => m === "overview");
  const orderedCommandBottom = command.filter((m) => m !== "overview");
  return [...orderedCommandTop, ...booking, ...orderedCommandBottom].map(
    (m) => ({ key: m, label: VENUE_MODULES[m].label }),
  );
}

const styles = StyleSheet.create({
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
