/**
 * DETAILS — the practical section, for a place AND for a plan. Issue #1605 wave 4.
 *
 * ---------------------------------------------------------------------------
 * THE SPLIT THIS FILE ENDS
 *
 * This component has ALWAYS accepted `openingHours` and `website` and has NEVER
 * rendered either. The hours table rendered inside `ActionButtons`, under an
 * orange-tinted "Opening Hours" card, next to the Save and Schedule buttons; the
 * website rendered as a full-width #1f2937 "Policies & Reservations" slab in the
 * same component. Hours are a practical detail and a website is a link, so both
 * live here now, and the props stop being a lie.
 *
 * ---------------------------------------------------------------------------
 * A PLAN HAS NO ADDRESS, NO HOURS, NO PHONE AND NO WEBSITE
 *
 * Its STOPS do. So a plan's Details carries exactly two rows, both of which are
 * true statements about the plan itself:
 *
 *     Starts at   the first stop's address
 *     Ends near   the last stop's address, ONLY when it differs from the first
 *
 * Promoting the first stop's phone number to be "the plan's phone" is a lie
 * about what the number reaches, and Constitution 9 forbids it more cheaply than
 * any argument would. There is also no derived "best window": intersecting the
 * stops' opening hours produces a true sentence that is nonetheless wrong,
 * because it ignores the travel time between them.
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS FAKED AND NOTHING IS GREYED OUT
 *
 * A place with no website and no phone renders Address and Hours and stops. No
 * em-dash, no "Not available", no disabled row. If it has no address and no
 * hours either, the section does not render AT ALL — and the rule above it goes
 * with it, because a rule with nothing under it is a rule to nowhere.
 */
import React from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { extractWeekdayText } from "../../utils/openingHoursUtils";
import { normalizeWebsiteUrl } from "../../utils/normalizeWebsiteUrl";
import { getUserLocale } from "../../utils/localeUtils";
import { useIsPlaceOpen } from "../../hooks/useIsPlaceOpen";
import { FactRow, LinkRow, Section, present } from "./SpineParts";
import { SPINE } from "./spineTokens";

export type PracticalOpeningHours =
  | string
  | { open_now?: boolean; weekday_text?: string[] }
  | {
      openNow?: boolean;
      periods?: unknown[];
      nextOpenTime?: string;
      nextCloseTime?: string;
      weekdayDescriptions?: string[];
    }
  | { lines?: string[] }
  | Record<string, string>
  | string[]
  | null;

interface PracticalDetailsSectionProps {
  address?: string;
  openingHours?: PracticalOpeningHours;
  phone?: string;
  website?: string;
  /**
   * The venue's UTC offset. WITHOUT IT THE OPEN/CLOSED BADGE DOES NOT RENDER.
   *
   * `isPlaceOpenAt` shifts to venue-local time only when the offset is non-null
   * and otherwise falls back to the DEVICE clock, so a London user reading a
   * Lagos venue's hours got a badge computed against London time. A wrong badge
   * is worse than no badge: hiding it makes the missing input visible instead of
   * silently wrong. That is Constitution 9 applied to a derived value.
   */
  utcOffsetMinutes?: number | null;
  /** A plan's two rows. When present, the single-place rows are not rendered. */
  plan?: { startsAt?: string | null; endsNear?: string | null };
  /** Surfaces a failed `Linking` attempt instead of swallowing it (Constitution 3). */
  onLinkUnavailable: (what: string) => void;
}

export default function PracticalDetailsSection({
  address,
  openingHours,
  phone,
  website,
  utcOffsetMinutes,
  plan,
  onLinkUnavailable,
}: PracticalDetailsSectionProps): React.ReactElement | null {
  const { t } = useTranslation(["expanded_details", "cards", "common"]);
  const [showWeek, setShowWeek] = React.useState(false);

  // Hooks run unconditionally, above every early return.
  const isOpen = useIsPlaceOpen(openingHours ?? null, utcOffsetMinutes ?? null);
  const weekdayLines = React.useMemo(
    () => extractWeekdayText(openingHours ?? null) ?? [],
    [openingHours],
  );
  const todayName = React.useMemo(
    () => new Date().toLocaleDateString(getUserLocale(), { weekday: "long" }),
    [],
  );
  const todayLine = React.useMemo(
    () => weekdayLines.find((line) => line.startsWith(todayName)) ?? null,
    [weekdayLines, todayName],
  );

  const normalizedWebsite = normalizeWebsiteUrl(website);
  const heading = t("expanded_details:action_buttons.details_heading", {
    defaultValue: "Details",
  });

  // ── A PLAN ────────────────────────────────────────────────────────────────
  if (plan) {
    const startsAt = present(plan.startsAt) ? plan.startsAt : null;
    // Rendered ONLY when it differs from the first — "Ends near" repeating the
    // start is not a second fact, it is the same fact twice.
    const endsNear =
      present(plan.endsNear) && plan.endsNear !== startsAt ? plan.endsNear : null;
    if (startsAt === null && endsNear === null) return null;

    return (
      <Section title={heading}>
        <FactRow
          first
          label={t("cards:expanded.starts_at", { defaultValue: "Starts at" })}
          value={startsAt}
          trailingIcon="open-outline"
          onPress={startsAt === null ? undefined : () => openMaps(startsAt, onLinkUnavailable, t)}
        />
        <FactRow
          first={startsAt === null}
          label={t("cards:expanded.ends_near", { defaultValue: "Ends near" })}
          value={endsNear}
          trailingIcon="open-outline"
          onPress={endsNear === null ? undefined : () => openMaps(endsNear, onLinkUnavailable, t)}
        />
      </Section>
    );
  }

  // ── A SINGLE PLACE ────────────────────────────────────────────────────────
  const hasAnything =
    present(address) || present(phone) || weekdayLines.length > 0 || normalizedWebsite !== null;
  if (!hasAnything) return null;

  return (
    <Section title={heading}>
      <FactRow
        first
        label={t("expanded_details:action_buttons.address", { defaultValue: "Address" })}
        value={present(address) ? address : null}
        trailingIcon="open-outline"
        onPress={present(address) ? () => openMaps(address, onLinkUnavailable, t) : undefined}
      />

      {weekdayLines.length > 0 ? (
        <View style={styles.hours}>
          <View style={styles.hoursHeader}>
            <Text style={styles.factLabel} numberOfLines={1}>
              {t("expanded_details:action_buttons.opening_hours")}
            </Text>
            <View style={styles.hoursBody}>
              <Text style={styles.factValue} numberOfLines={2}>
                {todayLine ?? weekdayLines[0]}
              </Text>
              {/*
                The badge renders IFF the offset is known. See the prop's
                docblock: five of six producers dropped it, so the badge was
                computed against the DEVICE clock almost everywhere.
              */}
              {isOpen !== null ? (
                <View style={[styles.badge, isOpen ? styles.badgeOpen : styles.badgeClosed]}>
                  <Text
                    style={[
                      styles.badgeText,
                      isOpen ? styles.badgeTextOpen : styles.badgeTextClosed,
                    ]}
                  >
                    {isOpen
                      ? t("expanded_details:action_buttons.open_now")
                      : t("expanded_details:action_buttons.closed")}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {showWeek
            ? weekdayLines.map((line) => {
                const isToday = line.startsWith(todayName);
                return (
                  <View key={line} style={styles.weekRow}>
                    {isToday ? <View style={styles.todayMarker} /> : <View style={styles.todaySpacer} />}
                    <Text
                      style={[styles.weekLine, isToday ? styles.weekLineToday : null]}
                      numberOfLines={1}
                    >
                      {line}
                    </Text>
                  </View>
                );
              })
            : null}

          {weekdayLines.length > 1 ? (
            <Pressable
              onPress={() => setShowWeek((v) => !v)}
              style={styles.showWeek}
              accessibilityRole="button"
              accessibilityState={{ expanded: showWeek }}
              accessibilityLabel={
                showWeek
                  ? t("expanded_details:action_buttons.show_less")
                  : t("expanded_details:action_buttons.show_all_hours")
              }
            >
              <Text style={styles.link}>
                {showWeek
                  ? t("expanded_details:action_buttons.show_less")
                  : t("expanded_details:action_buttons.show_all_hours")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <LinkRow
        label={t("expanded_details:action_buttons.phone", { defaultValue: "Phone" })}
        value={present(phone) ? phone : null}
        url={present(phone) ? `tel:${phone.replace(/[^0-9+]/g, "")}` : null}
        trailingIcon="call-outline"
        onUnavailable={() =>
          onLinkUnavailable(t("expanded_details:action_buttons.phone", { defaultValue: "Phone" }))
        }
      />

      {/*
        THIS ROW IS WHERE "POLICIES & RESERVATIONS" WENT. It was a full-width
        #1f2937 slab gated on `!!card.website` whose handler bailed when
        `normalizeWebsiteUrl` returned null — a visible dead button on any
        non-normalizable website. Gating on the NORMALIZED url is the fix: no
        url, no row.
      */}
      <LinkRow
        label={t("expanded_details:action_buttons.website", { defaultValue: "Website" })}
        value={normalizedWebsite === null ? null : displayHost(normalizedWebsite)}
        url={normalizedWebsite}
        trailingIcon="open-outline"
        onUnavailable={() =>
          onLinkUnavailable(
            t("expanded_details:action_buttons.website", { defaultValue: "Website" }),
          )
        }
      />
    </Section>
  );
}

/** `https://www.bar.com/menu` -> `bar.com`. A URL is not a label. */
function displayHost(url: string): string {
  const match = /^https?:\/\/(?:www\.)?([^/?#]+)/i.exec(url);
  return match ? match[1] : url;
}

function openMaps(
  address: string,
  onUnavailable: (what: string) => void,
  t: (key: string, opts?: Record<string, unknown>) => string,
): void {
  // ORCH-1148 / #1605 bug ledger item 3: `Platform.select` with only ios/android
  // keys returns UNDEFINED on web, and the `if (url)` then silently no-ops — a
  // dead tap nobody could see. The web arm is a real https maps URL.
  const url =
    Platform.OS === "ios"
      ? `maps:0,0?q=${encodeURIComponent(address)}`
      : Platform.OS === "android"
        ? `geo:0,0?q=${encodeURIComponent(address)}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  void (async () => {
    try {
      const can = await Linking.canOpenURL(url);
      if (!can) {
        onUnavailable(t("expanded_details:action_buttons.address", { defaultValue: "Address" }));
        return;
      }
      await Linking.openURL(url);
    } catch {
      onUnavailable(t("expanded_details:action_buttons.address", { defaultValue: "Address" }));
    }
  })();
}

const styles = StyleSheet.create({
  hours: { borderTopWidth: 1, borderTopColor: SPINE.rule },
  hoursHeader: {
    minHeight: SPINE.factRowMinHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: SPINE.gutter,
    paddingVertical: 10,
  },
  hoursBody: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  factLabel: {
    fontSize: SPINE.factLabelSize,
    fontWeight: "500",
    color: SPINE.factLabel,
    width: 118,
  },
  factValue: { fontSize: SPINE.factValueSize, fontWeight: "500", color: SPINE.factValue },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  // 8.30:1 and 8.20:1. The shipped pair measured 2.20:1 and 3.09:1 — a green on
  // its own 0.15 tint is a tint on a tint, and it failed AA outright.
  badgeOpen: { backgroundColor: SPINE.openFill },
  badgeClosed: { backgroundColor: SPINE.closedFill },
  badgeText: { fontSize: 11, fontWeight: "600" },
  badgeTextOpen: { color: SPINE.openText },
  badgeTextClosed: { color: SPINE.closedText },
  weekRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: SPINE.gutter,
    paddingVertical: 3,
  },
  // Today is marked by a 3x16 bar AND a 600 weight — never by colour alone.
  todayMarker: { width: 3, height: 16, borderRadius: 2, backgroundColor: SPINE.link },
  todaySpacer: { width: 3, height: 16 },
  weekLine: { fontSize: 13, lineHeight: 20, color: SPINE.prose, flex: 1 },
  weekLineToday: { fontWeight: "600", color: SPINE.link },
  showWeek: {
    minHeight: SPINE.factRowMinHeight,
    justifyContent: "center",
    paddingHorizontal: SPINE.gutter,
  },
  link: { fontSize: 14, fontWeight: "600", color: SPINE.link },
});
