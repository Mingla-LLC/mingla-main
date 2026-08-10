/**
 * Issue #1735 — the combined "Insights" suite module (G-2): Site check
 * instrument + the #1737 pricing slot + the competitor watch, on
 * `/venue/{venueId}`.
 *
 * Self-scroll contract: OWNS its ScrollView with the shared bottom-nav
 * clearance (`insets.bottom + VENUE_SCROLL_NAV_CLEARANCE`) — the shell must
 * NOT wrap it (`moduleSelfScrolls("insights") === true`; nested same-axis
 * scroll hazard).
 *
 * Internal `view` state: `"home" | "site" | "pricing"` — module-internal, no
 * route change; the back chevron returns to `home`. `pricing` is the #1737
 * extension seam (unreachable until its instrument registers in
 * `INSIGHT_INSTRUMENTS`).
 *
 * State ownership (P-35, COMMS-0136): run results live in the RQ cache +
 * this module's component state ONLY — never a persisted store (CI gate
 * `issue-1734-tool-results-not-persisted.mjs`). The venue-subject run
 * mutation lives HERE so an in-flight run survives the home ⇄ site switch.
 *
 * Sheets (add-competitor · competitor report) mount at the MODULE ROOT,
 * outside the ScrollView (I-13). Stays never mount `VenueSuiteShell`, so
 * Insights structurally does not exist for stays in v1 (G-21 — stated, not
 * silent).
 */

import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft } from "lucide-react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import {
  captureIntelCardShown,
  captureIntelReportOpened,
  captureIntelRunCompleted,
  captureIntelRunFailed,
  captureIntelRunStarted,
} from "../../../analytics/businessAnalyticsEvents";
import { useBrandPlaceAuthoringContext } from "../../../hooks/useBrandPlacePipelineState";
import { useIntelRun, useIntelSubjectLatest } from "../../../hooks/useGrowthTools";
import { useVenueListing } from "../../../hooks/useVenueListings";
import type { CompetitorWatchRow } from "../../../services/growthToolsService";
import { useShareNetworkState } from "../../ui/useShareNetworkState";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { CompetitorAddSheet } from "./CompetitorAddSheet";
import { CompetitorWatchSection } from "./CompetitorWatchSection";
import { GraderReportSections } from "./GraderReportSections";
import {
  SiteCheckInstrument,
  type SiteCheckVerdict,
  type SiteCheckWebsiteState,
} from "./SiteCheckInstrument";
import { VENUE_SCROLL_NAV_CLEARANCE } from "../venueShellScroll";
import {
  INSIGHT_INSTRUMENTS,
  formatCheckedDate,
} from "./insightsInstruments";

type InsightsView = "home" | "site" | "pricing";

export interface VenueInsightsModuleProps {
  brandId: string | null;
  venueId?: string | null;
}

/** The competitor full-report sheet — same G-8 renderers, same report shape. */
function CompetitorReportSheet({
  brandId,
  row,
  onClose,
}: {
  brandId: string | null;
  row: CompetitorWatchRow | null;
  onClose: () => void;
}): React.ReactElement {
  const latestQuery = useIntelSubjectLatest(
    brandId,
    "venues",
    row !== null ? `competitor:${row.id}` : null,
    { includePrevious: true, enabled: row !== null },
  );
  const data = latestQuery.data;
  return (
    <Sheet
      visible={row !== null}
      onClose={onClose}
      testID="competitor-report-sheet"
    >
      <ScrollView
        contentContainerStyle={styles.sheetScroll}
        showsVerticalScrollIndicator={false}
      >
        {row !== null ? (
          <Text style={styles.sheetTitle}>{row.name}</Text>
        ) : null}
        {latestQuery.isLoading ? (
          <ActivityIndicator size="small" color={textTokens.tertiary} />
        ) : latestQuery.isError ? (
          <View style={styles.sheetErrorWrap}>
            <Text style={styles.sheetError}>
              Couldn&apos;t load their report — try again.
            </Text>
            <Button
              label="Try again"
              variant="secondary"
              size="sm"
              onPress={() => {
                void latestQuery.refetch();
              }}
            />
          </View>
        ) : data !== undefined && data.status === "report_ready" ? (
          <>
            <GraderReportSections
              report={data.latest.report}
              testID="competitor-report"
            />
            {/* G-9 honesty rail — verbatim, dated. */}
            <Text style={styles.sheetHonesty}>
              {`A read of their public website on ${
                formatCheckedDate(data.latest.createdAt) ?? "the dated check"
              } — their site, not their business.`}
            </Text>
          </>
        ) : (
          <Text style={styles.sheetHonesty}>
            No report yet — grade their site first.
          </Text>
        )}
      </ScrollView>
    </Sheet>
  );
}

export function VenueInsightsModule({
  brandId,
  venueId = null,
}: VenueInsightsModuleProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const online = useShareNetworkState();
  const offline = !online;

  const venueQuery = useVenueListing(venueId);
  const venue = venueQuery.data ?? null;

  // G-6 — the on-file website comes from the authoring context (the client
  // VenueListing model has no website; D-4 resolved as the edge roundtrip,
  // RQ-deduped with the listing surface).
  const ctxQuery = useBrandPlaceAuthoringContext(
    brandId,
    venue?.placePoolId ?? null,
    venueId,
  );

  // READ-side subject composition is legal (P-43); WRITES send the subject
  // OBJECT only (P-41 — server-composed after ownership proof).
  const subjectRef = venueId !== null ? `venue:${venueId}` : null;
  const latestQuery = useIntelSubjectLatest(brandId, "venues", subjectRef);

  const run = useIntelRun();
  const [view, setView] = useState<InsightsView>("home");
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [reportRow, setReportRow] = useState<CompetitorWatchRow | null>(null);

  // ── website state (G-6: error is NEVER reported as absence) ─────────────
  const websiteState = useMemo((): SiteCheckWebsiteState => {
    if (venue === null) {
      return venueQuery.isError ? { kind: "error" } : { kind: "loading" };
    }
    if (venue.placePoolId === null) return { kind: "none" };
    if (ctxQuery.isError) return { kind: "error" };
    if (ctxQuery.data === undefined) return { kind: "loading" };
    const website = ctxQuery.data.website;
    if (typeof website !== "string" || website.trim().length === 0) {
      return { kind: "none" };
    }
    return { kind: "ready", website: website.trim() };
  }, [venue, venueQuery.isError, ctxQuery.isError, ctxQuery.data]);

  // ── standing verdict (this session's run wins until the read catches up) ─
  const verdict = useMemo((): SiteCheckVerdict | null => {
    if (run.data !== undefined) {
      return {
        report: run.data.report,
        checkedAtIso: run.data.report.meta?.generated_at ?? null,
        cached: run.data.cached,
      };
    }
    const latest = latestQuery.data;
    if (latest !== undefined && latest.status === "report_ready") {
      return {
        report: latest.latest.report,
        checkedAtIso: latest.latest.createdAt,
        cached: false,
      };
    }
    return null;
  }, [run.data, latestQuery.data]);

  // ── analytics: card shown once per venue (G-16) ──────────────────────────
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    if (venueId === null || latestQuery.isLoading) return;
    if (shownFor.current === venueId) return;
    shownFor.current = venueId;
    const grade = verdict?.report.scores?.grade;
    captureIntelCardShown(
      "insights_site",
      typeof grade === "string" ? grade : null,
    );
  }, [venueId, latestQuery.isLoading, verdict]);

  // ── the explicit venue-subject run (G-7 — NEVER auto-runs) ───────────────
  const handleRun = useCallback(
    (input: { name: string; city: string }): void => {
      if (brandId === null || venueId === null) return;
      if (websiteState.kind !== "ready" || run.isPending) return;
      captureIntelRunStarted("insights_site");
      run.mutate(
        {
          tool: "venues",
          brandId,
          input: {
            name: input.name,
            city: input.city,
            website: websiteState.website,
          },
          subject: { type: "venue", id: venueId },
        },
        {
          onSuccess: (result) => {
            const grade = typeof result.report.scores?.grade === "string"
              ? result.report.scores.grade
              : null;
            captureIntelRunCompleted("insights_site", grade);
            // G-18 — completion announced politely.
            AccessibilityInfo.announceForAccessibility(
              grade !== null
                ? `Site check ready: grade ${grade}.`
                : "Site check ready.",
            );
          },
          onError: () => {
            captureIntelRunFailed("insights_site");
          },
        },
      );
    },
    [brandId, venueId, websiteState, run],
  );

  const handleOpenSiteReport = useCallback((): void => {
    const grade = verdict?.report.scores?.grade;
    captureIntelReportOpened(
      "insights_site",
      typeof grade === "string" ? grade : null,
    );
    setView("site");
  }, [verdict]);

  const handleAddWebsite = useCallback((): void => {
    if (brandId === null || venueId === null) return;
    // The ordinary tier2 editor path (`save_tier2`) — the tool writes NOTHING.
    router.push(`/brand/${brandId}/listing?venue=${venueId}` as never);
  }, [brandId, venueId, router]);

  const contentContainerStyle = useMemo(
    () => [
      styles.scroll,
      { paddingBottom: insets.bottom + VENUE_SCROLL_NAV_CLEARANCE },
    ],
    [insets.bottom],
  );

  if (brandId === null || venueId === null) {
    // The suite mounts this only with a real venue in scope; an empty mount
    // renders an honest quiet state rather than a dead surface.
    return (
      <View style={styles.host}>
        <View style={styles.centerFill}>
          <Text style={styles.quiet}>Open a venue to see its insights.</Text>
        </View>
      </View>
    );
  }

  const siteInstrument = (fullReport: boolean): React.ReactElement => (
    <SiteCheckInstrument
      venueName={venue?.name ?? ""}
      venueCity={venue?.city ?? null}
      websiteState={websiteState}
      onRetryWebsite={() => {
        if (venue === null) void venueQuery.refetch();
        else void ctxQuery.refetch();
      }}
      onAddWebsite={handleAddWebsite}
      latestLoading={latestQuery.isLoading}
      latestError={latestQuery.isError}
      onRetryLatest={() => {
        void latestQuery.refetch();
      }}
      verdict={verdict}
      running={run.isPending}
      runError={run.error}
      offline={offline}
      onRun={handleRun}
      onOpenReport={fullReport ? undefined : handleOpenSiteReport}
      fullReport={fullReport}
    />
  );

  return (
    <View style={styles.host} testID="venue-insights-module">
      <ScrollView
        style={styles.host}
        contentContainerStyle={contentContainerStyle}
        showsVerticalScrollIndicator={false}
      >
        {view === "home" ? (
          <View style={styles.column}>
            <Text style={styles.headerTitle}>Insights</Text>
            {/* G-2 — ordered instrument slots. This PR registers only the
                site instrument; #1737 appends "pricing" to INSIGHT_INSTRUMENTS
                and adds its component here. An unregistered slot renders
                NOTHING — never a dead/"coming soon" card. */}
            {INSIGHT_INSTRUMENTS.map((instrumentId) => {
              if (instrumentId === "site") {
                return (
                  <React.Fragment key={instrumentId}>
                    {siteInstrument(false)}
                  </React.Fragment>
                );
              }
              return null;
            })}
            <CompetitorWatchSection
              brandId={brandId}
              venueListingId={venueId}
              offline={offline}
              onRequestAdd={(atCap) => {
                if (!atCap) setAddSheetOpen(true);
              }}
              onOpenReport={(row) => setReportRow(row)}
            />
            {/* Design §4.6 — text only, no nav. */}
            <Text style={styles.ariFooter}>
              Or just ask Ari — &quot;check my site&quot;
            </Text>
          </View>
        ) : view === "site" ? (
          <View style={styles.column}>
            <Pressable
              style={styles.backRow}
              onPress={() => setView("home")}
              accessibilityRole="button"
              accessibilityLabel="Back to Insights"
              hitSlop={8}
              testID="venue-insights-back"
            >
              <ArrowLeft size={20} color={textTokens.secondary} />
              <Text style={styles.backLabel}>Insights</Text>
            </Pressable>
            {/* G-2 binding: header at top, G-8 report sections below, SAME
                scroll; "Re-check my site" lives in the header. */}
            {siteInstrument(true)}
          </View>
        ) : (
          // "pricing" — the #1737 seam. Structurally unreachable until its
          // instrument registers; render the back affordance only (no dead
          // content, Constitution #1).
          <View style={styles.column}>
            <Pressable
              style={styles.backRow}
              onPress={() => setView("home")}
              accessibilityRole="button"
              accessibilityLabel="Back to Insights"
              hitSlop={8}
            >
              <ArrowLeft size={20} color={textTokens.secondary} />
              <Text style={styles.backLabel}>Insights</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* Sheets at the module root (I-13) — never inside the scroll. */}
      <CompetitorAddSheet
        visible={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        brandId={brandId}
        venueListingId={venueId}
        venueCity={venue?.city ?? null}
      />
      <CompetitorReportSheet
        brandId={brandId}
        row={reportRow}
        onClose={() => setReportRow(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  centerFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xxl,
  },
  column: {
    gap: spacing.md,
  },
  headerTitle: {
    ...typography.h2,
    color: textTokens.primary,
  },
  quiet: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  ariFooter: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  backRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  backLabel: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  // competitor report sheet
  sheetScroll: {
    padding: spacing.md,
    gap: spacing.md,
  },
  sheetTitle: {
    ...typography.h3,
    color: textTokens.primary,
  },
  sheetErrorWrap: {
    gap: spacing.sm,
  },
  sheetError: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  sheetHonesty: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
});

export default VenueInsightsModule;
