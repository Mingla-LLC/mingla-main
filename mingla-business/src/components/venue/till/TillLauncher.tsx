/**
 * #4490 spec 08 O1 — the Till destination inside a venue workspace (ordinary
 * and Stay shells). The rail's "Till" opens the full-screen Till route
 * straight away; this panel is what a login whose only job is the Till (a
 * Till device, or staff with only venue.sell) lands on, so the workspace is
 * never blank. Kept tiny and free of the Till's own code: the Till itself is
 * its own route chunk.
 */

import React from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { space } from "../../../constants/designSystem";
import { Button } from "../../ui/Button";
import { CenteredState } from "../../ui/CenteredState";
import { TILL_LAUNCHER_COPY, tillHref } from "./tillRoute";

export { TILL_LAUNCHER_COPY, tillHref } from "./tillRoute";

export function TillLauncher({ venueId }: { venueId: string }): React.ReactElement {
  return (
    <View style={styles.host} testID="venue-till-launcher">
      <CenteredState title={TILL_LAUNCHER_COPY.title} body={TILL_LAUNCHER_COPY.body}>
        <Button
          label={TILL_LAUNCHER_COPY.open}
          variant="primary"
          size="lg"
          leadingIcon="cash"
          onPress={() => router.push(tillHref(venueId) as never)}
          testID="venue-till-open"
        />
      </CenteredState>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { paddingVertical: space[8] },
});
