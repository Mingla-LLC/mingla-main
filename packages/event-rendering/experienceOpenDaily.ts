/**
 * experienceOpenDaily — ORCH-1153 WS2 (canonical, rule-based open-daily owner).
 *
 * THE single source of truth for "is this experience open-daily / open-hours
 * (restaurant-style)?", consumed by EVERY surface (buyer-web /exp/ page +
 * business iOS/Android via the same expo-router route, AND the app-mobile
 * consumer detail screen). Replaces the consumer's occurrence-density heuristic
 * (app-mobile/src/utils/experienceOpenDaily.ts isOpenDailyModel), which
 * classified the SAME experience differently than the web page (F-5).
 *
 * The rule is the authoritative INTENT, independent of how many occurrences are
 * currently materialised: a recurring experience that repeats DAILY FOREVER
 * (preset='daily' + termination.kind='never') is open-daily and earns the
 * restaurant-style date → time-in-window → party picker. Everything else (a
 * discrete single/multi-date series, or a recurring-but-not-daily/never rule)
 * uses the flat slot list.
 *
 * Pure + dep-free (no React Native imports) so both apps consume it via the
 * existing @mingla/event-rendering import path (same path offeringCta.ts uses) —
 * satisfying I-MOR-0827-PACKAGE-ISOLATION (one shared package, never a cross-app
 * import).
 */

/** The minimal recurrence-rule shape the detector reads. */
export interface OpenDailyRecurrenceRule {
  preset?: string | null;
  termination?: { kind?: string | null } | null;
}

export interface IsOpenDailyExperienceInput {
  /** events.is_recurring (the experience repeats on a rule). */
  isRecurring: boolean;
  /** The first/only recurrence rule, or null when none / not recurring. */
  recurrenceRule: OpenDailyRecurrenceRule | null | undefined;
}

/**
 * TRUE only for a daily/never recurring experience (open-daily/open-hours).
 * Any other shape → false (use the flat slot list). Byte-equivalent to the
 * buyer-web inline predicate it replaces (preset==='daily' &&
 * termination.kind==='never').
 */
export const isOpenDailyExperience = (
  input: IsOpenDailyExperienceInput,
): boolean => {
  if (input.isRecurring !== true) return false;
  const rule = input.recurrenceRule;
  if (rule === null || rule === undefined) return false;
  return rule.preset === "daily" && rule.termination?.kind === "never";
};
