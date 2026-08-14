/**
 * #1742 Review-only recommendation presentation.
 *
 * Kept separate from turnoutInput.ts so ambient cards can use the canonical
 * input/metre owner without pulling the pre-publish UI into startup.
 */
import type { TurnoutReport } from "../types/growthTools";
import type { TurnoutEngineInput } from "./turnoutInput";

export type TurnoutGateWizard = "event" | "rsvp" | "experience";
export type TurnoutGateFocus = "name" | "date" | "city" | "price" | "capacity";

export interface TurnoutGateTarget {
  step: number;
  focus: TurnoutGateFocus;
  label: string;
}

export interface TurnoutGateRecommendation {
  id: string;
  copy: string;
  severity: "info" | "warning";
  severityWord: "Info" | "Warning";
  target: TurnoutGateTarget | null;
}

const safePromoCopy = (value: string): string =>
  value.replace(/\bad spend\b/gi, "promo spend").replace(/\bads?\b/gi, "promo");

export const classifyTurnoutGateTarget = (
  classificationCopy: string,
  wizard: TurnoutGateWizard,
): TurnoutGateTarget | null => {
  const value = classificationCopy.toLowerCase();
  if (/date|day|week|time|lead|runway|schedul/.test(value)) {
    return {
      step: wizard === "experience" ? 2 : 1,
      focus: "date",
      label: "Review when",
    };
  }
  if (/price|ticket|fee|cost|charg/.test(value)) {
    return wizard === "rsvp"
      ? null
      : {
          step: wizard === "experience" ? 3 : 4,
          focus: "price",
          label: "Review pricing",
        };
  }
  if (/capacity|seat|spot|room\b/.test(value)) {
    return {
      step: wizard === "experience" ? 3 : 4,
      focus: "capacity",
      label: "Review capacity",
    };
  }
  if (/title|name|listing|copy|descri|tagline/.test(value)) {
    return { step: 0, focus: "name", label: "Review basics" };
  }
  if (/venue|location|city|area|neighborhood/.test(value)) {
    return {
      step: wizard === "experience" ? 1 : 2,
      focus: "city",
      label: "Review location",
    };
  }
  return null;
};

/** One deterministic recommendation truth shared by every #1742 gate. */
export const buildTurnoutGateRecommendations = (
  report: TurnoutReport | null,
  input: TurnoutEngineInput | null,
  wizard: TurnoutGateWizard,
): TurnoutGateRecommendation[] => {
  if (report === null) return [];
  const rows: TurnoutGateRecommendation[] = [];
  const fix = report.fixes?.[0];
  if (fix?.title !== undefined && fix.title.trim().length > 0) {
    rows.push({
      id: "fix",
      copy: fix.title,
      severity: "info",
      severityWord: "Info",
      target: classifyTurnoutGateTarget(
        `${fix.title} ${fix.change ?? ""}`,
        wizard,
      ),
    });
  }
  const hurt = report.factors?.find((factor) => factor.status === "hurt");
  if (hurt?.label !== undefined && hurt.label.trim().length > 0) {
    rows.push({
      id: "hurt",
      copy: hurt.label,
      severity: "warning",
      severityWord: "Warning",
      target: classifyTurnoutGateTarget(
        `${hurt.key ?? ""} ${hurt.label}`,
        wizard,
      ),
    });
  }
  const competitorCount = report.competitors?.length ?? 0;
  if (competitorCount > 0) {
    rows.push({
      id: "competitors",
      copy: `${competitorCount} competing event${competitorCount === 1 ? "" : "s"} that night`,
      severity: "info",
      severityWord: "Info",
      target: null,
    });
  }
  if ((input?.ticket_price ?? 0) > 0 && report.plan?.read !== undefined) {
    rows.push({
      id: "plan",
      copy: safePromoCopy(report.plan.read),
      severity: "info",
      severityWord: "Info",
      target: classifyTurnoutGateTarget(report.plan.read, wizard),
    });
  }
  return rows.slice(0, 4);
};
