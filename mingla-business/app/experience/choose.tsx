/**
 * /experience/choose (ORCH-1144) — host route for the universal
 * experience-create chooser.
 *
 * Reached from:
 *   - the top-bar "+" → "Create experience" (UniversalCreatorSheet now routes
 *     the experience option here instead of straight to /experience/create), and
 *   - the Experiences-tab empty-state "New experience" CTA.
 *
 * Mounts ExperienceCreateChooser with `visible` true. Closing the chooser
 * (scrim tap / back) pops this route via router.back(). Each of the chooser's
 * three rows closes the sheet then pushes its real destination
 * (/experience/snap?mode=menu | ?mode=activities | /experience/create) — so
 * there are no dead taps (Constitution #1, SC-10).
 *
 * SPEC §4.4 (A1): a dedicated route keeps UniversalCreatorSheet a pure router
 * (single-line change there) and adds zero per-consumer chooser state.
 *
 * Mingla_Artifacts/specs/SPEC_ORCH-1144_UNIVERSAL_EXPERIENCE_PARSER_CHOOSER.md §4.4
 */

import React, { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";

import { ExperienceCreateChooser } from "../../src/components/experience/ExperienceCreateChooser";
import { canvas } from "../../src/constants/designSystem";

export default function ExperienceChooseRoute(): React.ReactElement {
  const router = useRouter();

  const handleClose = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/hub/experiences" as never);
  }, [router]);

  return (
    <View style={styles.host}>
      <ExperienceCreateChooser
        visible
        onClose={handleClose}
        testID="experience-create-chooser"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
});
