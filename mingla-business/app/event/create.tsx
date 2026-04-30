/**
 * /event/create — wizard entry from Home "Build a new event" CTA (J-E1).
 *
 * Reads currentBrand at mount. If null → bounces to /(tabs)/home.
 * Otherwise creates a new draft via draftEventStore.createDraft, then
 * router.replace to /event/{newId}/edit?step=0. The replace (not push)
 * means back from Step 1 returns to /(tabs)/home directly — no /create
 * stack frame to land on.
 *
 * Format-agnostic ID resolver per Cycle 2 invariant I-11 (the new id
 * is whatever generateDraftId produces — d_<ts36>; route resolves it
 * via find()).
 *
 * Host-bg cascade per Cycle 2 invariant I-12 — but this route never
 * renders permanent chrome; it redirects in useEffect with a Spinner
 * placeholder for the brief redirect moment.
 *
 * Per Cycle 3 spec §3.5 route 1.
 */

import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  canvas,
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import { Spinner } from "../../src/components/ui/Spinner";
import { useCurrentBrand } from "../../src/store/currentBrandStore";
import { useDraftEventStore } from "../../src/store/draftEventStore";

export default function EventCreateRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const currentBrand = useCurrentBrand();
  const createDraft = useDraftEventStore((s) => s.createDraft);

  useEffect(() => {
    if (currentBrand === null) {
      router.replace("/(tabs)/home" as never);
      return;
    }
    const newDraft = createDraft(currentBrand.id);
    router.replace(`/event/${newDraft.id}/edit?step=0` as never);
  }, [currentBrand, createDraft, router]);

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, backgroundColor: canvas.discover },
      ]}
    >
      <View style={styles.center}>
        <Spinner size={36} />
        <Text style={styles.label}>Starting a new event…</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  label: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
});
