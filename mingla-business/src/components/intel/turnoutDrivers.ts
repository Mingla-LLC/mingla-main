import type {
  TurnoutFactorStatus,
  TurnoutReport,
} from "../../types/growthTools";
import type { IntelDriverTone } from "./IntelDriverChip";

export interface TurnoutDriver {
  id: string;
  label: string;
  detail: string;
  tone: IntelDriverTone;
}

const factorOrder: Record<TurnoutFactorStatus, number> = {
  hurt: 0,
  watch: 1,
  help: 2,
};

export const buildTurnoutDrivers = (
  report: TurnoutReport | null,
): TurnoutDriver[] => {
  if (report === null) return [];
  const output: TurnoutDriver[] = [];
  if (report.weather !== undefined && report.weather !== null) {
    output.push({
      id: "weather",
      label: report.weather.kind === "forecast" ? "Forecast" : "Seasonal",
      detail: [report.weather.summary, report.weather.impact]
        .filter(Boolean)
        .join(" · "),
      tone: report.weather.impact?.toLowerCase().includes("hurt")
        ? "hurt"
        : "info",
    });
  }
  if ((report.competitors?.length ?? 0) > 0) {
    output.push({
      id: "competitors",
      label: `${report.competitors?.length ?? 0} competing that night`,
      detail:
        report.demand_read ??
        "Nearby events are included in this modeled band.",
      tone: "watch",
    });
  }
  const factors = [...(report.factors ?? [])]
    .filter(
      (
        factor,
      ): factor is typeof factor & {
        label: string;
        status: TurnoutFactorStatus;
      } =>
        typeof factor.label === "string" &&
        (factor.status === "hurt" ||
          factor.status === "watch" ||
          factor.status === "help"),
    )
    .sort((a, b) => factorOrder[a.status] - factorOrder[b.status])
    .slice(0, 3);
  for (const [index, factor] of factors.entries()) {
    output.push({
      id: factor.key ?? `factor-${index}`,
      label: factor.label ?? "Signal",
      detail: factor.detail ?? "Included in this modeled band.",
      tone: factor.status ?? "info",
    });
  }

  // Engine factor keys are descriptive rather than unique. A positional suffix
  // gives every rendered chip its own stable identity within this ordered report.
  return output
    .slice(0, 5)
    .map((driver, index) => ({ ...driver, id: `${driver.id}:${index}` }));
};
