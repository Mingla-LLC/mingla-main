import React, { useCallback } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

import {
  OfferingChooser,
  routeForOffering,
  type OfferingKind,
} from "../../../src/components/brand/OfferingChooser";
import { spacing } from "../../../src/constants/designSystem";

export default function HubGetStartedRoute(): React.ReactElement {
  const router = useRouter();
  const handleSelect = useCallback(
    (offering: OfferingKind): void => {
      router.push(routeForOffering(offering) as never);
    },
    [router],
  );

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <OfferingChooser
        variant="hub-getstarted"
        headline="Get started — pick what to create"
        subhead=""
        onSelect={handleSelect}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: spacing.md,
    paddingBottom: 120,
  },
});
