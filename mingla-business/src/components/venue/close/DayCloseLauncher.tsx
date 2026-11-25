/**
 * #4490 spec 08 O5 part B — the Close the day destination inside a venue
 * workspace (ordinary and Stay shells). The rail's "Close the day" opens the
 * full-screen route straight away; this panel is what shows if the module is
 * opened by address, so the workspace is never blank. Kept tiny and free of
 * the screen's own code (its own route chunk).
 */

import React from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { space } from "../../../constants/designSystem";
import { Button } from "../../ui/Button";
import { CenteredState } from "../../ui/CenteredState";
import { CLOSE_LAUNCHER_COPY, closeHref } from "./closeRoute";

export { closeHref } from "./closeRoute";

export function DayCloseLauncher({ venueId }: { venueId: string }): React.ReactElement {
  return (
    <View style={styles.host} testID="venue-close-launcher">
      <CenteredState title={CLOSE_LAUNCHER_COPY.title} body={CLOSE_LAUNCHER_COPY.body}>
        <Button label={CLOSE_LAUNCHER_COPY.open} variant="primary" size="lg" leadingIcon="cash"
          onPress={() => router.push(closeHref(venueId) as never)} testID="venue-close-open" />
      </CenteredState>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { paddingVertical: space[8] },
});
