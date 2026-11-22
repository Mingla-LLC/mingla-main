/**
 * #4490 W7 (c) — the checkout line on the venue choose step: one quiet line
 * under the picks, "{day}, {time} · {forecast} · Usually {level}", for the
 * day and time the guest chose. Entry, Group and By the hour only (never Plans
 * or Private hire, and none when no time can be picked); shown only when BOTH
 * the day and the time are chosen, updating as the chips change. The weather
 * part hides when the forecast does not reach that hour; the crowd part hides
 * with no category. Drive lives on the pass, not here.
 *
 * Mounted by W4 (native venue checkout) under the picks on the choose step for
 * Entry, Group and By the hour (`VenueCheckoutChoose`), with the venue's
 * coordinates and crowd category (`crowdCategoryFor`) and the chosen
 * venue-local day and time.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { fontWeights, spacing, typography } from "../../constants/designSystem";
import { useLocalePreferences } from "../../hooks/useLocalePreferences";
import { useVenueForecast } from "../../hooks/useVenueForecast";
import { formatTemperature } from "../utils/formatters";
import { checkoutLineFor } from "../expandedCard/whenYoudGoModel";
import { PURCHASE_SHEET_COLORS as C } from "../purchases/purchaseSheetTheme";

export interface VenueCheckoutWhenLineProps {
  readonly lat: number | null | undefined;
  readonly lng: number | null | undefined;
  /** The typical-crowd curve key for this venue (`crowdCategoryFor`); null = no crowd part. */
  readonly category: string | null | undefined;
  /** The chosen day, venue-local "YYYY-MM-DD"; null while not chosen. */
  readonly day: string | null | undefined;
  /** The chosen time, venue-local "HH:MM"; null while not chosen. */
  readonly time: string | null | undefined;
}

export function VenueCheckoutWhenLine({ lat, lng, category, day, time }: VenueCheckoutWhenLineProps): React.ReactElement | null {
  const { t } = useTranslation(["cards"]);
  const { measurementSystem } = useLocalePreferences();
  const forecast = useVenueForecast(lat, lng);
  const line = checkoutLineFor({ day, time, hourly: forecast.data?.hourlyForecast ?? null, category });
  if (line === null) return null;

  const weather = line.weather;
  const rain =
    weather && typeof weather.precipitationProbability === "number" && weather.precipitationProbability >= 30
      ? ` · ${t("cards:sheet.rain_chance", { pct: Math.round(weather.precipitationProbability) })}`
      : "";
  const parts = [
    `${line.day}, ${line.time}`,
    weather ? `${formatTemperature(weather.temperature, measurementSystem)}${rain}` : null,
    line.crowd ? t(`cards:sheet.crowd_usually_${line.crowd}`) : null,
  ].filter((p): p is string => p !== null);

  return (
    <View style={styles.line} testID="venue-checkout-when-line" accessibilityLiveRegion="polite">
      <Text style={styles.text} accessibilityLabel={parts.join(", ")}>
        {parts.join(" · ")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { marginTop: spacing.sm },
  text: { color: C.textSecondary, ...typography.sm, fontWeight: fontWeights.semibold },
});
