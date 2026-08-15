/**
 * Issue #1735 — the Insights module's instrument registry + shared visual
 * constants. PURE (no React/RN/component imports) so hooks (`useGrowthTools`)
 * and the to-do plumbing can read the registration state without pulling the
 * component tree in (and without a require cycle through the instruments,
 * which import the hooks).
 *
 * THE #1737 EXTENSION POINT (G-2, structural — no fork of the module):
 * `INSIGHT_INSTRUMENTS` is the ordered instrument list `VenueInsightsModule`
 * maps over. This PR registers ONLY the site instrument; #1737 appends
 * `"pricing"` here (one-line diff) and adds its component to the module's
 * `INSTRUMENT_COMPONENTS` record. Until then the pricing slot renders
 * NOTHING — never a dead/"coming soon" card (Constitution #1) — and the
 * pricing to-do nudge row + its latest-read stay dark (G-15 binding: a to-do
 * row must never deep-link to a surface that doesn't render).
 */

export type InsightInstrumentId = "site" | "orders" | "pricing";

/** Ordered. #1737 appends "pricing" — one-line diff, same array. */
export const INSIGHT_INSTRUMENTS: readonly InsightInstrumentId[] = ["site", "orders"];

export function insightInstrumentRegistered(id: InsightInstrumentId): boolean {
  return INSIGHT_INSTRUMENTS.includes(id);
}

// ── Grade badge visuals (design v1 §3.1, carried by #1735 G-5) ──────────────
//
// Fill = `semantic.successTint` / `warningTint` / `errorTint` by grade band
// A–B / C / D–F. Android composites below are the design v1 §3.0 opaque
// fallbacks — the same arithmetic as `androidOpaque.accentFill`
// (tint over canvas.discover #0c0e12); they live HERE because
// `designSystem.ts` is outside this work item's allowlist. iOS/web keep the
// translucent truths. RN color formats: hex/rgb only (house rule).

export const INSIGHTS_ANDROID_OPAQUE = {
  /** semantic.successTint (rgba(34,197,94,.18)) over #0c0e12. */
  successFill: "#102f20",
  /** semantic.warningTint (rgba(245,158,11,.18)) over #0c0e12. */
  warningFill: "#362811",
  /** semantic.errorTint (rgba(239,68,68,.18)) over #0c0e12. */
  errorFill: "#35181b",
  /** semantic.infoTint (rgba(59,130,246,.18)) over #0c0e12. */
  infoFill: "#14233b",
} as const;

export type GradeBand = "good" | "mid" | "poor";

/** A–B → good · C → mid · D–F (and anything unreadable) → poor. */
export function gradeBand(grade: string | null | undefined): GradeBand {
  const letter = typeof grade === "string" ? grade.trim().charAt(0).toUpperCase() : "";
  if (letter === "A" || letter === "B") return "good";
  if (letter === "C") return "mid";
  return "poor";
}

// ── Shared pure helpers (unit-tested; G-5 semantics) ─────────────────────────

/**
 * G-5 stale-on-edit — the normalized website compare. Both sides
 * `trim().toLowerCase()`; either side missing ⇒ NOT comparable ⇒ never
 * reports stale (an absent value is a different state, not a change).
 */
export function websitesDiffer(
  onFile: string | null | undefined,
  graded: string | null | undefined,
): boolean {
  if (typeof onFile !== "string" || typeof graded !== "string") return false;
  const a = onFile.trim().toLowerCase();
  const b = graded.trim().toLowerCase();
  if (a.length === 0 || b.length === 0) return false;
  return a !== b;
}

/** G-5 CTA gate — the engine's own bounds (name 2–80, city 2–60). */
export function graderInputsValid(name: string, city: string): boolean {
  const n = name.trim().length;
  const c = city.trim().length;
  return n >= 2 && n <= 80 && c >= 2 && c <= 60;
}

/**
 * G-10 manual-entry URL-shaped check — mirrors the engine's
 * `normalizeWebsite` acceptance (scheme optional; hostname must carry a dot)
 * without relying on Hermes' `URL`. The ENGINE stays the gatekeeper of what
 * actually gets fetched (SSRF guard is server-side).
 */
export function websiteLooksValid(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length < 4 || trimmed.length > 2048) return false;
  const withoutScheme = trimmed.replace(/^https?:\/\//i, "");
  const host = withoutScheme.split(/[/?#]/)[0] ?? "";
  return /^[^\s.]+(\.[^\s.]+)+$/.test(host);
}

const SUB_SCORE_KEYS = [
  "first_impression",
  "findability",
  "mobile",
  "menu_offers",
  "occasion_signal",
] as const;

export type GraderSubScoreKey = (typeof SUB_SCORE_KEYS)[number];

export const GRADER_SUB_SCORE_LABELS: Record<GraderSubScoreKey, string> = {
  first_impression: "First impression",
  findability: "Findability",
  mobile: "Mobile",
  menu_offers: "Menu & offers",
  occasion_signal: "Occasion signal",
};

export function graderSubScoreKeys(): readonly GraderSubScoreKey[] {
  return SUB_SCORE_KEYS;
}

/**
 * G-5 standing verdict — the ONE strength line: the highest sub-score's
 * `scores.reasons` entry. Ties break on declaration order (deterministic).
 * Missing/malformed scores or reasons ⇒ null (render nothing, never fabricate).
 */
export function strongestSubScoreReason(scores: {
  first_impression?: number;
  findability?: number;
  mobile?: number;
  menu_offers?: number;
  occasion_signal?: number;
  reasons?: Record<string, string>;
} | undefined): string | null {
  if (scores === undefined || scores.reasons === undefined) return null;
  let bestKey: GraderSubScoreKey | null = null;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const key of SUB_SCORE_KEYS) {
    const value = scores[key];
    if (typeof value === "number" && Number.isFinite(value) && value > bestValue) {
      bestValue = value;
      bestKey = key;
    }
  }
  if (bestKey === null) return null;
  const reason = scores.reasons[bestKey];
  return typeof reason === "string" && reason.trim().length > 0
    ? reason.trim()
    : null;
}

/** "Checked 9 Aug" — shared date treatment on every dated insights surface. */
export function formatCheckedDate(iso: string | null | undefined): string | null {
  if (typeof iso !== "string" || iso.length === 0) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** G-9 — a competitor check older than 60 days renders in warning tone. */
export const COMPETITOR_STALE_AFTER_DAYS = 60;

export function competitorCheckIsStale(
  checkedAtIso: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (typeof checkedAtIso !== "string" || checkedAtIso.length === 0) return false;
  const checked = new Date(checkedAtIso).getTime();
  if (Number.isNaN(checked)) return false;
  return nowMs - checked > COMPETITOR_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
