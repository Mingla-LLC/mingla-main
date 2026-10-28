import { entireMetricsCollection } from "@capsizecss/metrics/entireMetricsCollection";
import type { FontFallback } from "../contracts/generated/fontSlots.ts";

/*
 * #2829 AD-3 — a metric-matched fallback face for every chosen family.
 *
 * While a site's own font file is on its way, text renders in a local system
 * face (Arial for sans families, Times New Roman for serif ones) resized and
 * re-spaced to take up the same room, so nothing jumps when the real face
 * arrives. The metrics come from @capsizecss/metrics, the same data next/font
 * uses, and the arithmetic is next/font's: scale the fallback by the ratio of
 * average character widths, then express the family's ascent, descent and
 * line gap against that scaled size.
 *
 * Server-only (the builder). A family capsize does not know gets no fallback
 * face and simply falls back to the generic stack.
 */

type Metrics = {
  familyName: string;
  category: string;
  ascent: number;
  descent: number;
  lineGap: number;
  unitsPerEm: number;
  xWidthAvg: number;
};

const collection = entireMetricsCollection as unknown as Record<string, Metrics>;
let byFamily: Map<string, Metrics> | null = null;

function metricsFor(family: string): Metrics | null {
  if (!byFamily) {
    byFamily = new Map();
    for (const metrics of Object.values(collection)) {
      if (metrics && typeof metrics.familyName === "string") byFamily.set(metrics.familyName, metrics);
    }
  }
  return byFamily.get(family) ?? null;
}

function percent(value: number): string {
  return `${Math.abs(value * 100).toFixed(2)}%`;
}

/** The fallback face for a family, or null when its metrics are unknown. */
export function fallbackFaceFor(family: string): FontFallback | null {
  const metrics = metricsFor(family);
  if (!metrics || !(metrics.unitsPerEm > 0) || !(metrics.xWidthAvg > 0)) return null;
  const serif = metrics.category === "serif";
  const local = serif ? "Times New Roman" : "Arial";
  const fallback = metricsFor(local);
  if (!fallback) return null;
  const sizeAdjust = (metrics.xWidthAvg / metrics.unitsPerEm) /
    (fallback.xWidthAvg / fallback.unitsPerEm);
  const scaled = metrics.unitsPerEm * sizeAdjust;
  return {
    family,
    local,
    size_adjust: percent(sizeAdjust),
    ascent_override: percent(metrics.ascent / scaled),
    descent_override: percent(metrics.descent / scaled),
    line_gap_override: percent(metrics.lineGap / scaled),
  };
}
