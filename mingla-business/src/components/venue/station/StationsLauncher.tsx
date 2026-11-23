/**
 * #4490 spec 08 O3 — the Kitchen and bar destination inside a venue workspace
 * (ordinary and Stay shells). The rail's "Kitchen and bar" opens the
 * full-screen station route straight away; this panel is what a login whose
 * only job is the kitchen lands on, so the workspace is never blank. Kept tiny
 * and free of the station screen's own code (its own route chunk).
 */

import React from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { space } from "../../../constants/designSystem";
import { Button } from "../../ui/Button";
import { CenteredState } from "../../ui/CenteredState";
import { STATIONS_LAUNCHER_COPY, stationHref } from "./stationRoute";

export { stationHref } from "./stationRoute";

export function StationsLauncher({ venueId }: { venueId: string }): React.ReactElement {
  return (
    <View style={styles.host} testID="venue-stations-launcher">
      <CenteredState title={STATIONS_LAUNCHER_COPY.title} body={STATIONS_LAUNCHER_COPY.body}>
        <Button
          label={STATIONS_LAUNCHER_COPY.open}
          variant="primary"
          size="lg"
          leadingIcon="list"
          onPress={() => router.push(stationHref(venueId) as never)}
          testID="venue-stations-open"
        />
      </CenteredState>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { paddingVertical: space[8] },
});
