/**
 * Issue #1735 G-5..G-8 — the Site check instrument (standing venue-scoped
 * grader; design v2 §1.1 + v1 §3.0 carried).
 *
 * States (ALL implemented — no unhandled state ships): loading skeleton ·
 * first-run (website on file) · running (staged IntelProgress, height-stable)
 * · standing verdict · stale-on-edit (normalized compare, NEVER auto-runs) ·
 * cached re-serve copy · VISIBLE error + retry (standing idiom — the
 * hide-silently law is ambient-wizard-only) · rate-limited (429 scope:brand)
 * · offline · no-website honest empty state · authoring-context error
 * (distinct from absence — never misreport an error as absence, G-6).
 *
 * The component is PRESENTATIONAL over module-owned state: the run mutation +
 * latest-read live in `VenueInsightsModule` so a run survives the home ⇄ site
 * view switch. Results live in RQ cache/component state ONLY (P-35).
 * GlassCard layout keys via `contentStyle` only. Grade = color + letter +
 * words (color never the sole indicator — WCAG).
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  accent,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import type { GrowthToolsAppError } from "../../../services/growthToolsService";
import type {
  GraderReport,
} from "../../../services/growthToolsService";
import { Button } from "../../ui/Button";
import { GradeBadge } from "./GradeBadge";
import { GlassCard } from "../../ui/GlassCard";
import { Input } from "../../ui/Input";
import { Skeleton } from "../../ui/Skeleton";
import { GraderReportSections } from "./GraderReportSections";
import {
  formatCheckedDate,
  graderInputsValid,
  strongestSubScoreReason,
  websitesDiffer,
} from "./insightsInstruments";

// ── View-model (owned by VenueInsightsModule) ────────────────────────────────

export type SiteCheckWebsiteState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "none" }
  | { kind: "ready"; website: string };

export interface SiteCheckVerdict {
  report: GraderReport;
  /** ISO — the run row's created_at (or meta.generated_at for a fresh run). */
  checkedAtIso: string | null;
  /** P-22 — the last explicit re-check was a cached re-serve. */
  cached: boolean;
}

export interface SiteCheckInstrumentProps {
  venueName: string;
  venueCity: string | null;
  websiteState: SiteCheckWebsiteState;
  onRetryWebsite: () => void;
  onAddWebsite: () => void;
  /** Latest-read state (P-43). */
  latestLoading: boolean;
  latestError: boolean;
  onRetryLatest: () => void;
  /** The standing verdict (latest-read merged with this session's run). */
  verdict: SiteCheckVerdict | null;
  running: boolean;
  runError: GrowthToolsAppError | null;
  offline: boolean;
  onRun: (input: { name: string; city: string }) => void;
  /** home card: tap-anywhere on the verdict header opens the full workspace. */
  onOpenReport?: () => void;
  /** site view: render the G-8 report sections inline below the header. */
  fullReport?: boolean;
  testID?: string;
}

// ── IntelProgress (design v1 §3.0/§3.1 — staged, time-advanced, honest) ─────

const PROGRESS_STAGE_STARTS_MS: readonly number[] = [0, 6_000, 14_000, 22_000];
const PROGRESS_HONESTY_MS = 30_000;
/** Reserves the result body's height so running → result never jumps (G-5). */
const PROGRESS_MIN_HEIGHT = 140;

function progressLines(domain: string): string[] {
  return [
    `Reading ${domain}…`,
    "Scoring what visitors see…",
    "Sizing up nearby competition…",
    "Building your report…",
  ];
}

function domainOf(website: string | null): string {
  if (website === null) return "your site";
  try {
    const withScheme = /^https?:\/\//i.test(website)
      ? website
      : `https://${website}`;
    return new URL(withScheme).hostname;
  } catch {
    return "your site";
  }
}

function IntelProgress({ domain }: { domain: string }): React.ReactElement {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 1_000);
    return () => clearInterval(timer);
  }, []);
  const lines = progressLines(domain);
  const currentIndex = PROGRESS_STAGE_STARTS_MS.reduce(
    (acc, startMs, index) => (elapsedMs >= startMs ? index : acc),
    0,
  );
  return (
    <View style={styles.progressWrap} testID="site-check-progress">
      {lines.map((line, index) => {
        const done = index < currentIndex;
        const current = index === currentIndex;
        return (
          <View key={line} style={styles.progressRow}>
            {current ? (
              <ActivityIndicator size="small" color={accent.warm} />
            ) : (
              <Text
                style={[
                  styles.progressGlyph,
                  done ? styles.progressGlyphDone : styles.progressGlyphPending,
                ]}
              >
                {done ? "✓" : "·"}
              </Text>
            )}
            <Text
              style={[
                styles.progressLine,
                done
                  ? styles.progressLineDone
                  : current
                    ? styles.progressLineCurrent
                    : styles.progressLinePending,
              ]}
            >
              {line}
            </Text>
          </View>
        );
      })}
      {elapsedMs >= PROGRESS_HONESTY_MS ? (
        <Text style={styles.progressHonesty}>
          Still working — live research can take up to a minute.
        </Text>
      ) : null}
    </View>
  );
}

// ── The instrument ───────────────────────────────────────────────────────────

export function SiteCheckInstrument({
  venueName,
  venueCity,
  websiteState,
  onRetryWebsite,
  onAddWebsite,
  latestLoading,
  latestError,
  onRetryLatest,
  verdict,
  running,
  runError,
  offline,
  onRun,
  onOpenReport,
  fullReport = false,
  testID = "site-check-instrument",
}: SiteCheckInstrumentProps): React.ReactElement {
  // Edited name/city are RUN INPUTS ONLY — never written to the venue row (G-5).
  const [name, setName] = useState(venueName);
  const [city, setCity] = useState(venueCity ?? "");
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    const seed = `${venueName}|${venueCity ?? ""}`;
    if (seededFor.current !== seed) {
      seededFor.current = seed;
      setName(venueName);
      setCity(venueCity ?? "");
    }
  }, [venueName, venueCity]);

  const onFileWebsite = websiteState.kind === "ready" ? websiteState.website : null;
  const rateLimited = runError?.code === "rate_limited";
  const stale = useMemo(
    () =>
      verdict !== null &&
      websitesDiffer(onFileWebsite, verdict.report.venue?.website),
    [verdict, onFileWebsite],
  );

  // ── website source states (G-6) ──────────────────────────────────────────
  if (websiteState.kind === "loading" || latestLoading) {
    return (
      <GlassCard
        variant="base"
        contentStyle={styles.cardContent}
        testID={`${testID}-loading`}
      >
        <Skeleton width="55%" height={20} />
        <Skeleton width="100%" height={44} />
        <Skeleton width="80%" height={16} />
      </GlassCard>
    );
  }

  if (websiteState.kind === "error") {
    // An error is NEVER reported as absence (G-6).
    return (
      <GlassCard
        variant="base"
        contentStyle={styles.cardContent}
        testID={`${testID}-website-error`}
      >
        <Text style={styles.headline}>Site check</Text>
        <Text style={styles.bodySm}>
          Couldn&apos;t load your website on file — retry.
        </Text>
        <View style={styles.actionRow}>
          <Button
            label="Retry"
            variant="secondary"
            size="md"
            onPress={onRetryWebsite}
            testID={`${testID}-website-retry`}
          />
        </View>
      </GlassCard>
    );
  }

  if (websiteState.kind === "none") {
    // Honest no-website empty state (design §1.1 verbatim). The competitor
    // watch below stays fully functional — deliberate design fact.
    return (
      <GlassCard
        variant="base"
        contentStyle={styles.cardContent}
        testID={`${testID}-no-website`}
      >
        <Text style={styles.headline}>How does your website treat your guests?</Text>
        <Text style={styles.bodySm}>
          {`No website on file for ${venueName}. Add one and we'll grade it — or keep an eye on the competition below while you decide.`}
        </Text>
        <View style={styles.actionRow}>
          <Button
            label="Add website"
            variant="secondary"
            size="md"
            onPress={onAddWebsite}
            testID={`${testID}-add-website`}
          />
        </View>
      </GlassCard>
    );
  }

  if (latestError && verdict === null) {
    // Standing surface: VISIBLE error + retry — never hide-silently.
    return (
      <GlassCard
        variant="base"
        contentStyle={styles.cardContent}
        testID={`${testID}-latest-error`}
      >
        <Text style={styles.headline}>Site check</Text>
        <Text style={styles.bodySm}>
          Couldn&apos;t load your site check — try again.
        </Text>
        <View style={styles.actionRow}>
          <Button
            label="Try again"
            variant="secondary"
            size="md"
            onPress={onRetryLatest}
            testID={`${testID}-latest-retry`}
          />
        </View>
      </GlassCard>
    );
  }

  // ── running (staged progress; height-stable) ─────────────────────────────
  if (running) {
    return (
      <GlassCard
        variant="base"
        contentStyle={[styles.cardContent, styles.progressReserve]}
        testID={`${testID}-running`}
      >
        <Text style={styles.headline}>Checking your site</Text>
        <IntelProgress domain={domainOf(onFileWebsite)} />
      </GlassCard>
    );
  }

  // ── first-run (status "none", website on file) ───────────────────────────
  if (verdict === null) {
    const inputsValid = graderInputsValid(name, city);
    const ctaDisabled = !inputsValid || offline || rateLimited;
    return (
      <GlassCard
        variant="base"
        contentStyle={styles.cardContent}
        testID={`${testID}-first-run`}
      >
        <Text style={styles.headline}>How does your website treat your guests?</Text>
        <Text style={styles.bodySm}>
          We read it like a first-time visitor — score, fixes, and how you stack
          up against the competition.
        </Text>
        <Input
          value={name}
          onChangeText={setName}
          placeholder="Venue name"
          accessibilityLabel="Venue name for the site check"
          testID={`${testID}-name-input`}
        />
        <Input
          value={city}
          onChangeText={setCity}
          placeholder="City"
          accessibilityLabel="City for the site check"
          testID={`${testID}-city-input`}
        />
        {/* Website is READ-ONLY here (G-6) — the grading subject must equal
            the on-file site or stale-on-edit becomes meaningless. */}
        <View style={styles.websiteRow} testID={`${testID}-website-row`}>
          <Text style={styles.websiteCap}>WEBSITE</Text>
          <Text style={styles.websiteValue} numberOfLines={1}>
            {onFileWebsite}
          </Text>
        </View>
        {runError !== null && !rateLimited ? (
          <Text style={styles.errorLine} testID={`${testID}-run-error`}>
            Couldn&apos;t finish the check — try again.
          </Text>
        ) : null}
        {rateLimited ? (
          <Text style={styles.errorLine} testID={`${testID}-rate-limited`}>
            You&apos;ve used today&apos;s checks — they refresh tomorrow.
          </Text>
        ) : null}
        {offline ? (
          <Text style={styles.offlineLine} testID={`${testID}-offline`}>
            You&apos;re offline — checks need a connection.
          </Text>
        ) : null}
        <Button
          label="Check my site"
          variant="primary"
          size="md"
          fullWidth
          disabled={ctaDisabled}
          onPress={() => onRun({ name: name.trim(), city: city.trim() })}
          accessibilityLabel="Check my site"
          testID={`${testID}-run-cta`}
        />
      </GlassCard>
    );
  }

  // ── standing verdict (+ stale-on-edit dim; + cached copy) ────────────────
  const grade = typeof verdict.report.scores?.grade === "string"
    ? verdict.report.scores.grade
    : null;
  const strength = strongestSubScoreReason(verdict.report.scores);
  const fixesCount = Array.isArray(verdict.report.fixes)
    ? verdict.report.fixes.length
    : 0;
  const checkedDate = formatCheckedDate(
    verdict.checkedAtIso ?? verdict.report.meta?.generated_at,
  );
  const recheckDisabled = offline || rateLimited;

  // #1735 rework P1-2 — the rolled-up `accessible` element is ONLY the verdict
  // SUMMARY (badge + strength + fixes + date). The Re-check Button AND every
  // speaking status line are true SIBLINGS of it — outside the accessible
  // container and outside the open-report Pressable — so assistive tech can
  // reach and activate each one individually (nested Pressables/accessible
  // containers flatten the a11y subtree; verified by the sibling-tree test).
  const verdictSummary = (
    <View
      style={[styles.verdictDim, stale ? styles.verdictStale : null]}
      accessible
      accessibilityLabel={`Site check: grade ${grade ?? "unknown"}. ${
        fixesCount === 1 ? "1 fix waiting." : `${fixesCount} fixes waiting.`
      }${checkedDate !== null ? ` Checked ${checkedDate}.` : ""}`}
    >
      {/* G-5 stale-on-edit — ONLY the verdict dims to 0.5; the stale line and
          the re-check affordance stay fully legible (they live outside). */}
      <View style={styles.verdictHeadRow}>
        <GradeBadge grade={grade} />
        <View style={styles.verdictTextWrap}>
          {strength !== null ? (
            <Text style={styles.verdictStrength} numberOfLines={2}>
              {strength}
            </Text>
          ) : null}
          <Text style={styles.verdictFixes}>
            {fixesCount === 1 ? "1 fix waiting" : `${fixesCount} fixes waiting`}
          </Text>
        </View>
      </View>
      {checkedDate !== null ? (
        <Text style={styles.verdictChecked}>{`Checked ${checkedDate}`}</Text>
      ) : null}
    </View>
  );

  return (
    <View style={styles.standingWrap}>
      <GlassCard
        variant="base"
        contentStyle={styles.cardContent}
        testID={`${testID}-verdict`}
      >
        {onOpenReport !== undefined && !fullReport ? (
          // The open-report Pressable wraps ONLY the summary — never the
          // Button or the status lines below (P1-2: siblings, not nesting).
          <Pressable
            onPress={onOpenReport}
            accessibilityRole="button"
            accessibilityLabel="Open the full site report"
            testID={`${testID}-open-report`}
          >
            {verdictSummary}
          </Pressable>
        ) : (
          verdictSummary
        )}
        {verdict.cached ? (
          <Text
            style={styles.cachedLine}
            accessibilityRole="text"
            testID={`${testID}-cached`}
          >
            Checked earlier today — same inputs, same answer.
          </Text>
        ) : null}
        {stale ? (
          <Text
            style={styles.staleLine}
            accessibilityRole="text"
            testID={`${testID}-stale`}
          >
            Your website changed — re-check?
          </Text>
        ) : null}
        {runError !== null && !rateLimited ? (
          <Text
            style={styles.errorLine}
            accessibilityRole="text"
            testID={`${testID}-run-error`}
          >
            Couldn&apos;t finish the check — try again.
          </Text>
        ) : null}
        {rateLimited ? (
          <Text
            style={styles.errorLine}
            accessibilityRole="text"
            testID={`${testID}-rate-limited`}
          >
            You&apos;ve used today&apos;s checks — they refresh tomorrow.
          </Text>
        ) : null}
        {offline ? (
          <Text
            style={styles.offlineLine}
            accessibilityRole="text"
            testID={`${testID}-offline`}
          >
            You&apos;re offline — checks need a connection.
          </Text>
        ) : null}
        <Button
          label="Re-check my site"
          variant="secondary"
          size="md"
          disabled={recheckDisabled}
          onPress={() => onRun({ name: name.trim(), city: city.trim() })}
          accessibilityLabel="Re-check my site"
          testID={`${testID}-recheck`}
        />
      </GlassCard>
      {fullReport ? <GraderReportSections report={verdict.report} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cardContent: {
    gap: spacing.sm,
  },
  standingWrap: {
    gap: spacing.md,
  },
  headline: {
    ...typography.h2,
    color: textTokens.primary,
  },
  bodySm: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  actionRow: {
    flexDirection: "row",
  },
  websiteRow: {
    gap: 2,
  },
  websiteCap: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  websiteValue: {
    ...typography.bodySm,
    color: textTokens.primary,
  },
  errorLine: {
    ...typography.bodySm,
    color: semantic.error,
  },
  offlineLine: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  cachedLine: {
    ...typography.caption,
    color: textTokens.secondary,
  },
  staleLine: {
    ...typography.bodySm,
    color: semantic.warning,
  },
  // progress
  progressReserve: {
    minHeight: PROGRESS_MIN_HEIGHT,
  },
  progressWrap: {
    gap: spacing.sm,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  progressGlyph: {
    width: 20,
    textAlign: "center",
    ...typography.bodySm,
  },
  progressGlyphDone: {
    color: semantic.success,
  },
  progressGlyphPending: {
    color: textTokens.quaternary,
  },
  progressLine: {
    flex: 1,
    ...typography.bodySm,
  },
  progressLineDone: {
    color: textTokens.secondary,
  },
  progressLineCurrent: {
    color: textTokens.primary,
  },
  progressLinePending: {
    color: textTokens.quaternary,
  },
  progressHonesty: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  // verdict
  verdictDim: {
    gap: spacing.sm,
  },
  verdictStale: {
    opacity: 0.5,
  },
  verdictHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  verdictTextWrap: {
    flex: 1,
    gap: 2,
  },
  verdictStrength: {
    ...typography.bodySm,
    color: textTokens.primary,
  },
  verdictFixes: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.primary,
  },
  verdictChecked: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
});

export default SiteCheckInstrument;
