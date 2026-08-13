import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text,
  typography,
} from "../../constants/designSystem";
import type {
  TurnoutFreePlan,
  TurnoutPaidPlan,
  TurnoutReport,
} from "../../types/growthTools";
import { IntelBandStat } from "./IntelBandStat";

const safePromoCopy = (value: string): string =>
  // Issue #1008 positioning rail: display transform only. Engine truth stays
  // untouched; Mingla describes the instrument as promo spend, never "ads".
  value.replace(/\bad spend\b/gi, "promo spend").replace(/\bads?\b/gi, "promo");

const Row: React.FC<{ title: string; body?: string }> = ({ title, body }) => (
  <View style={styles.row}>
    <Text style={styles.rowTitle}>{title}</Text>
    {body !== undefined && body.length > 0 ? (
      <Text style={styles.rowBody}>{body}</Text>
    ) : null}
  </View>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

const number = (value?: number): string =>
  typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat().format(Math.round(value * 100) / 100)
    : "—";

const isPaidPlan = (
  plan: TurnoutFreePlan | TurnoutPaidPlan,
): plan is TurnoutPaidPlan =>
  plan.kind === "paid_optimized" || "recommended_budget" in plan;

export const EventsReportSections: React.FC<{ report: TurnoutReport }> = ({
  report,
}) => {
  const forecast = report.forecast;
  const plan = report.plan;
  return (
    <View style={styles.root} testID="turnout-full-report">
      {forecast !== undefined &&
      typeof forecast.total_low === "number" &&
      typeof forecast.total_high === "number" &&
      typeof forecast.capacity === "number" ? (
        <Section title="Forecast">
          <IntelBandStat
            low={forecast.total_low}
            high={forecast.total_high}
            capacity={forecast.capacity}
            benchmark={report.meta?.research_source === "fallback"}
          />
          <Row
            title={`Confidence: ${forecast.confidence ?? "modeled"}`}
            body={forecast.headline_read}
          />
        </Section>
      ) : null}

      {Array.isArray(report.factors) && report.factors.length > 0 ? (
        <Section title="What is shaping turnout">
          {report.factors.slice(0, 8).map((factor, index) => (
            <Row
              key={factor.key ?? `${factor.label ?? "factor"}-${index}`}
              title={factor.label ?? "Signal"}
              body={factor.detail}
            />
          ))}
        </Section>
      ) : null}

      {Array.isArray(report.competitors) && report.competitors.length > 0 ? (
        <Section title="Competing events">
          {report.competitors.slice(0, 5).map((item, index) => (
            <Row
              key={`${item.name ?? "event"}-${index}`}
              title={item.name ?? "Nearby event"}
              body={[item.platform, item.date_note, item.scale_note]
                .filter(Boolean)
                .join(" · ")}
            />
          ))}
        </Section>
      ) : null}

      {Array.isArray(report.comparables) && report.comparables.length > 0 ? (
        <Section title="Comparable events">
          {report.comparables.slice(0, 4).map((item, index) => (
            <Row
              key={`${item.name ?? "comparable"}-${index}`}
              title={
                [item.name, item.city].filter(Boolean).join(" · ") ||
                "Comparable"
              }
              body={[item.turnout_note, item.source_note]
                .filter(Boolean)
                .join(" · ")}
            />
          ))}
        </Section>
      ) : null}

      {report.weather !== null && report.weather !== undefined ? (
        <Section
          title={
            report.weather.kind === "forecast"
              ? "Weather forecast"
              : "Seasonal weather"
          }
        >
          <Row
            title={report.weather.summary ?? "Weather signal"}
            body={report.weather.impact}
          />
        </Section>
      ) : null}

      {plan !== undefined ? (
        <Section title="Promo budget plan">
          {isPaidPlan(plan) ? (
            <>
              <Row
                title={`Recommended promo budget: ${number(plan.recommended_budget)}`}
                body={
                  plan.read !== undefined ? safePromoCopy(plan.read) : undefined
                }
              />
              {(plan.scenarios ?? []).map((scenario, index) => (
                <Row
                  key={`${scenario.label ?? "scenario"}-${index}`}
                  title={`${scenario.label ?? "Scenario"}${scenario.recommended ? " · Recommended" : ""}`}
                  body={`Budget ${number(scenario.budget)} · ${number(scenario.total_attendees)} attendees · ${number(scenario.pct_capacity)}% capacity · Revenue ${number(scenario.revenue)} · Profit ${number(scenario.profit)} · ROAS ${number(scenario.roas)}`}
                />
              ))}
            </>
          ) : (
            <Row
              title={`What a ${number(plan.budget)} promo budget buys`}
              body={`${number(plan.clicks_low)}–${number(plan.clicks_high)} clicks · ${number(plan.attendees_low)}–${number(plan.attendees_high)} attendees${plan.read !== undefined ? ` · ${safePromoCopy(plan.read)}` : ""}`}
            />
          )}
        </Section>
      ) : null}

      {Array.isArray(report.fixes) && report.fixes.length > 0 ? (
        <Section title="Ways to improve the forecast">
          {report.fixes.slice(0, 5).map((fix, index) => (
            <Row
              key={`${fix.title ?? "fix"}-${index}`}
              title={
                [fix.title, fix.lift_note].filter(Boolean).join(" · ") ||
                "Recommendation"
              }
              body={[fix.why, fix.change, fix.effort]
                .filter(Boolean)
                .join(" · ")}
            />
          ))}
        </Section>
      ) : null}

      {report.listing_preview !== undefined ? (
        <Section title="Listing-copy suggestion">
          <Row
            title={report.listing_preview.title ?? "Suggested listing"}
            body={[
              report.listing_preview.tagline,
              report.listing_preview.why_go,
              report.listing_preview.best_for,
              ...(report.listing_preview.vibe_tags ?? []),
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        </Section>
      ) : null}

      {typeof report.narrative === "string" && report.narrative.length > 0 ? (
        <Section title="AI read">
          <Text style={styles.narrative}>{report.narrative}</Text>
        </Section>
      ) : null}

      <Text style={styles.footer}>
        Modeled guidance — not a promise
        {report.meta?.generated_at !== undefined
          ? ` · Generated ${new Date(report.meta.generated_at).toLocaleDateString()}`
          : ""}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { gap: spacing.lg, paddingBottom: spacing.xl },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.h3, color: text.primary },
  row: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  rowTitle: { ...typography.bodySm, color: text.primary, fontWeight: "700" },
  rowBody: { ...typography.caption, color: text.secondary, marginTop: 4 },
  narrative: { ...typography.bodySm, color: text.secondary },
  footer: { ...typography.caption, color: accent.warm, textAlign: "center" },
});
