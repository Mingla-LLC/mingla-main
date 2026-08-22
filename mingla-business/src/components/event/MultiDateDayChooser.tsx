/**
 * MultiDateDayChooser — issue #2135, extended to MULTI-SELECT by issue #2160.
 *
 * A guest attending a two-day exhibition on both days makes ONE reservation and
 * gets admission for both, so this is a set of checkboxes, not a radiogroup.
 * The occurrences are now HANDED DOWN by the host (they ride the event payload
 * from the same reader that served the event — #2161); this component no longer
 * reads anything.
 *
 * The multi-date leg of the public event page: it reads this event's
 * materialised `event_dates` occurrences and renders them as an INLINE list of
 * selectable day rows, in the page flow, above the body.
 *
 * WHY INLINE RATHER THAN A SHEET (decision recorded so it is not re-litigated):
 *
 *   1. It is what the bug asks for. #2135's complaint is that a guest "can
 *      neither see nor choose the second day". A sheet fixes only the second
 *      half — every date stays hidden behind a tap nobody knows to take. Inline
 *      rows put every day on the page, unprompted.
 *   2. It keeps 10 KB out of every guest's boot payload. Reusing the /exp
 *      surface's `ExperienceReservePicker` here made that component reachable
 *      from two chunks, so Metro hoisted it (9,912 B) into `__common` — the
 *      eager payload EVERY visitor downloads, for an affordance only multi-date
 *      events use. Measured: inline costs +1,212 B, the shared sheet +10,238 B.
 *   3. A sheet is the right shape on /exp because that surface is a three-step
 *      wizard (day -> time -> party). Choosing one of a handful of days is a
 *      single decision and does not need the machinery.
 *
 * `ExperienceReservePicker` and the whole /exp surface are deliberately
 * UNTOUCHED by this file — this is a different affordance, not a competing
 * implementation of the same one.
 *
 * The host owns the SELECTION (it is what the checkout URL is built from); this
 * component owns the read and the rendering, and reports both upward.
 *
 * Anon-tolerant: no useAuth anywhere in the chain.
 */

import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import type { ThemePalette } from "@mingla/offering-rendering";

import type { MultiDatePricingMode } from "../../services/publicEventsService";
import type { PublicEventOccurrence } from "../../services/publicEventOccurrencesService";
import { formatOccurrenceLine } from "../../utils/eventDateDisplay";

export interface MultiDateDayChooserProps {
  /** The event's IANA zone, used only when an occurrence row carries none. */
  timezone: string;
  palette: ThemePalette;
  /** Bold loaded font family (theme) — native bold no-ops without it. */
  fontFamily?: string;
  /**
   * issue #2160 / #2161 — the occurrences, handed down from the event payload.
   * The component no longer reads them: a guest surface must never read
   * `event_dates` directly (I-PROPOSED-2160-D).
   */
  occurrences: readonly PublicEventOccurrence[];
  /** The chosen `event_dates.id`s. Empty until the guest picks — never defaulted. */
  selectedOccurrenceIds: readonly string[];
  /**
   * issue #2160 — the organiser's pricing choice, so the guest learns the
   * multiplier HERE, before any total is shown.
   */
  pricingMode: MultiDatePricingMode;
  /** True when this event has at least one ticket priced above zero. */
  isPaid: boolean;
  /**
   * True once the guest has tried to check out without choosing. Turns the
   * block into an explicit, accessible prompt instead of a silent no-op.
   */
  highlightUnchosen: boolean;
  /** issue #2399 — explicit fail-closed occurrence truth state. */
  state?: "ready" | "error" | "offline" | "stale";
  onRetry?: () => void;
  onToggle: (eventDateId: string) => void;
}

/**
 * "Sat 22 Aug · 11 AM – 6 PM", degrading to the day alone when times are absent.
 *
 * issue #2209 — the label body MOVED to `formatOccurrenceLine` in
 * eventDateDisplay (I-14, the single owner of event date display) because the
 * public page's EYEBROW now renders the same days. Two copies of this string
 * would be two things a guest could see disagree about the same day. Output is
 * unchanged: `formatOccurrenceLine` returns null exactly where this returned
 * "Date to be confirmed", and that literal stays here because it is this
 * control's copy, not a date format.
 */
const rowLabel = (
  occurrence: PublicEventOccurrence,
  fallbackTimezone: string,
): string =>
  formatOccurrenceLine(occurrence, fallbackTimezone) ?? "Date to be confirmed";

const useReducedMotionOnWeb = (): boolean => {
  const [reduced, setReduced] = useState<boolean>(() =>
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
  );

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (query === undefined) return undefined;
    const update = (): void => setReduced(query.matches);
    query.addEventListener?.("change", update);
    return (): void => query.removeEventListener?.("change", update);
  }, []);

  return reduced;
};

export const MultiDateDayChooser: React.FC<MultiDateDayChooserProps> = ({
  timezone,
  palette,
  fontFamily,
  occurrences,
  selectedOccurrenceIds,
  pricingMode,
  isPaid,
  highlightUnchosen,
  state = "ready",
  onRetry,
  onToggle,
}) => {
  const reducedMotion = useReducedMotionOnWeb();
  // Nothing to choose between → render nothing. A multi-date event that
  // materialised a single row shows no dead affordance, and the host's CTA
  // behaves exactly as it does for single dates.
  if (state === "ready" && occurrences.length <= 1) return null;

  const fontStyle = fontFamily !== undefined ? { fontFamily } : null;
  const chosen = selectedOccurrenceIds.length;
  // issue #2160 §7(b) — THE MULTIPLIER IS VISIBLE BEFORE ANY TOTAL IS.
  // A guest who sees £10 on a two-day event and picks both days pays £20; the
  // floating bar must never be the first place they learn that. A free event
  // carries no price qualifier because there is nothing to qualify.
  const countLine = chosen === 0
    ? `${occurrences.length} days`
    : isPaid && pricingMode === "per_day"
      ? `Priced per day · ${chosen} of ${occurrences.length} selected`
      : isPaid && pricingMode === "all_days"
        ? `One price for all days · ${chosen} of ${occurrences.length} selected`
        : `${chosen} of ${occurrences.length} selected`;

  const recovery =
    state === "error"
      ? { message: "We couldn’t load the event days.", action: "Try again" }
      : state === "offline"
        ? { message: "You’re offline. Reconnect to continue.", action: null }
        : state === "stale"
          ? {
              message: "Those dates just changed. Refresh and choose again.",
              action: "Refresh days",
            }
          : null;

  return (
    <View
      style={[
        styles.host,
        { borderBottomColor: palette.panelBorder },
        highlightUnchosen ? { borderBottomColor: palette.accent } : null,
      ]}
      testID="issue-2135-day-chooser"
      nativeID="issue-2399-day-section"
      tabIndex={-1}
    >
      <View style={styles.headerRow}>
        <Text
          style={[styles.heading, { color: palette.primaryText }, fontStyle]}
        >
          Pick your days
        </Text>
        <Text style={[styles.count, { color: palette.tertiaryText }]}>
          {countLine}
        </Text>
      </View>

      {highlightUnchosen && chosen === 0 ? (
        <Text
          style={[styles.prompt, { color: palette.accent }, fontStyle]}
          testID="issue-2135-day-chooser-prompt"
          accessibilityRole="alert"
        >
          Choose at least one day {"you're"} attending to continue.
        </Text>
      ) : null}

      {recovery !== null ? (
        <View style={styles.recovery}>
          <Text
            style={[styles.prompt, { color: palette.accent }, fontStyle]}
            accessibilityRole="alert"
            testID="issue-2399-day-recovery"
          >
            {recovery.message}
          </Text>
          {recovery.action !== null && onRetry !== undefined ? (
            <Pressable
              onPress={onRetry}
              accessibilityRole="button"
              accessibilityLabel={recovery.action}
              style={[styles.retry, { borderColor: palette.accent }]}
            >
              <Text
                style={[styles.retryText, { color: palette.accent }, fontStyle]}
              >
                {recovery.action}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Rows are SIBLINGS — never nested Pressables, which would flatten the
          accessibility subtree (feedback_nested_pressable_flattens_a11y_subtree).
          The container DROPS accessibilityRole="radiogroup": RN has no
          checkbox-group role, and leaving "radiogroup" on a set of checkboxes
          would announce "pick exactly one", which is the opposite of what this
          control now does. A plain labelled group is the honest shape. */}
      {state === "ready" ? (
        <View accessibilityLabel="Days you're attending" style={styles.rows}>
          {occurrences.map((occurrence) => {
            const selected = selectedOccurrenceIds.includes(occurrence.id);
            const label = rowLabel(occurrence, timezone);
            const webCheckboxProps = Platform.OS === "web"
              ? {
                  "aria-checked": selected,
                  tabIndex: 0 as const,
                  onKeyDown: (event: React.KeyboardEvent<HTMLElement>): void => {
                    if ((event.key === " " || event.key === "Spacebar") && !event.repeat) {
                      event.preventDefault();
                      onToggle(occurrence.id);
                    }
                  },
                }
              : {};
            return (
              <Pressable
                key={occurrence.id}
                {...webCheckboxProps}
                onPress={() => onToggle(occurrence.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={label}
                style={[
                  styles.row,
                  { borderColor: palette.panelBorder },
                  Platform.OS === "web"
                    ? {
                        transitionProperty:
                          "background-color, border-color, color, opacity",
                        transitionDuration: reducedMotion ? "0ms" : "150ms",
                      }
                    : null,
                  selected
                    ? {
                        borderColor: palette.accent,
                        backgroundColor: palette.accentWash,
                      }
                    : null,
                ]}
                testID={`issue-2135-day-row-${occurrence.id}`}
                /* issue #2160 — a second, mode-neutral hook so a test can target
                 the multi-select rows without depending on the #2135 id. */
                nativeID={`issue-2160-day-row-${occurrence.id}`}
              >
                <View
                  style={[
                    styles.radio,
                    {
                      borderColor: selected
                        ? palette.accent
                        : palette.panelBorder,
                    },
                  ]}
                >
                  {selected ? (
                    <Text style={[styles.check, { color: palette.accentText }]}>
                      ✓
                    </Text>
                  ) : null}
                </View>
                <Text
                  style={[
                    styles.rowLabel,
                    {
                      color: selected
                        ? palette.primaryText
                        : palette.secondaryText,
                    },
                    fontStyle,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  // Palette-themed with the OPAQUE card fill + panel border the page's other
  // cards use, so Android never renders translucent glass here.
  host: {
    borderBottomWidth: 1,
    paddingBottom: 14,
    marginBottom: 8,
    gap: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  heading: { flex: 1, fontSize: 14, fontWeight: "900", letterSpacing: -0.2 },
  count: { fontSize: 12, fontWeight: "700" },
  prompt: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  rows: { gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 48,
  },
  // issue #2160 — a SQUARE check box, same 18pt box / 2pt border / accent fill
  // as #2135's radio circle. The affordance now means "any number", so it must
  // not look like "exactly one".
  radio: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  check: { fontSize: 14, lineHeight: 16, fontWeight: "900" },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: "700" },
  recovery: { gap: 8 },
  retry: {
    minHeight: 44,
    alignSelf: "flex-start",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
  },
  retryText: { fontSize: 13, fontWeight: "800" },
});

export default MultiDateDayChooser;
