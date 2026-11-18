/**
 * #4490 click-test D9 — add-venue step 8, "Features".
 *
 * Features, not venue types: the switches the chosen type starts with (built
 * ones only) under "Usual for <type> venues", and every other built switch
 * under "More you can switch on". The host can change any of them here and
 * again later in Settings › Venue type and features. Table ordering is listed
 * but waits for Mingla to approve the venue, as it does in Settings.
 *
 * The choice lives in the draft (`startingFeatures`; null = the type's
 * starting set) and is applied after the venue row exists. The old
 * `wantsReservations` flag follows the Table reservations switch so the
 * reservation settings write stays in step.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../constants/designSystem";
import { useDraftVenueStore } from "../../../store/draftVenueStore";
import { FEATURE_COPY, type VenueFeatureKey, type VenueTypeKey } from "../../../types/venueFeatures";
import { BrandSwitch } from "../../ui/BrandSwitch";
import {
  canStartWith,
  chosenStartingFeatures,
  toggleStartingFeature,
  usualHeading,
  wizardFeatureRows,
} from "./wizardFeaturesModel";

export const VenueFeaturesStep: React.FC = () => {
  const category = useDraftVenueStore((s) => (s.venueCategory ?? null) as VenueTypeKey | null);
  const chosen = useDraftVenueStore((s) => s.startingFeatures ?? null);
  const name = useDraftVenueStore((s) => s.displayName.trim());
  const patch = useDraftVenueStore((s) => s.patch);

  const on = chosenStartingFeatures(category, chosen);
  const { usual, more } = wizardFeatureRows(category);

  const flip = (key: VenueFeatureKey, next: boolean): void => {
    const features = toggleStartingFeature(on, key, next);
    patch({ startingFeatures: features, wantsReservations: features.includes("table_reservations") });
  };

  const row = (key: VenueFeatureKey): React.ReactElement => {
    const startable = canStartWith(key);
    return (
      <View key={key} style={styles.row} testID={`venue-wizard-feature-${key}`}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{FEATURE_COPY[key].label}</Text>
          <Text style={styles.rowSub}>{FEATURE_COPY[key].summary}</Text>
          {!startable ? (
            <Text style={styles.rowNote}>Available once Mingla approves this venue.</Text>
          ) : null}
        </View>
        <BrandSwitch
          value={on.includes(key)}
          onValueChange={(next) => flip(key, next)}
          disabled={!startable}
          accessibilityRole="switch"
          accessibilityLabel={FEATURE_COPY[key].label}
          testID={`venue-wizard-feature-switch-${key}`}
        />
      </View>
    );
  };

  return (
    <View style={styles.host} testID="venue-wizard-features">
      <Text style={styles.title}>Features</Text>
      <Text style={styles.helper}>
        What guests can do at {name.length > 0 ? name : "your venue"}. Your type switches on the usual ones; change
        any of them now or later in Settings.
      </Text>
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>{usualHeading(category)}</Text>
        {usual.length === 0 ? (
          <Text style={styles.rowSub}>The usual features for this type arrive soon. Switch on anything below.</Text>
        ) : (
          usual.map(row)
        )}
      </View>
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>More you can switch on</Text>
        {more.map(row)}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: space[4],
    paddingHorizontal: space[6],
    paddingBottom: space[7],
  },
  title: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
  },
  helper: {
    fontSize: type.small.fontSize,
    lineHeight: 20,
    color: color.text2,
  },
  card: {
    gap: space[2],
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: color.fill.tile,
  },
  sectionLabel: {
    ...type.label,
    textTransform: "uppercase",
    color: color.text3,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: 56,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: type.body.fontSize, fontWeight: "600", color: color.text1 },
  rowSub: { ...type.caption, color: color.text2 },
  rowNote: { ...type.caption, color: color.text3 },
});

export default VenueFeaturesStep;
