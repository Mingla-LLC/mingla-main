/**
 * /event/[id]/preview — in-app preview of a draft event.
 *
 * Reads dynamic `id` segment, resolves draft via useDraftById. Renders
 * PreviewEventView (MID-fidelity port of designer PublicEventScreen)
 * with PREVIEW ribbon and back button. Share button fires
 * TRANSITIONAL Toast pointing at Cycle 7.
 *
 * Format-agnostic ID resolver per Cycle 2 invariant I-11.
 * Host-bg cascade per Cycle 2 invariant I-12 (PreviewEventView sets
 * its own dark background per designer; canvas.discover not used here
 * to match designer #0c0e12 hero treatment).
 *
 * Per Cycle 3 spec §3.5 route 3.
 */

import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  canvas,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { Spinner } from "../../../src/components/ui/Spinner";
import { Toast } from "../../../src/components/ui/Toast";
import { PreviewEventView } from "../../../src/components/event/PreviewEventView";
import { useBrandList } from "../../../src/store/currentBrandStore";
import { useDraftById } from "../../../src/store/draftEventStore";

export default function EventPreviewRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;

  const draft = useDraftById(typeof idParam === "string" ? idParam : null);
  const brands = useBrandList();
  const brand = useMemo(() => {
    if (draft === null) return null;
    return brands.find((b) => b.id === draft.brandId) ?? null;
  }, [draft, brands]);

  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  useEffect(() => {
    if (typeof idParam !== "string" || idParam.length === 0 || draft === null) {
      const t = setTimeout(() => {
        router.replace("/(tabs)/home" as never);
      }, 0);
      return (): void => clearTimeout(t);
    }
    return undefined;
  }, [idParam, draft, router]);

  const handleBack = (): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/home" as never);
    }
  };

  const handleShareTap = (): void => {
    setToast({ visible: true, message: "Share modal lands Cycle 7." });
  };

  const handleEditStep = (step: number): void => {
    if (draft === null) return;
    router.push(`/event/${draft.id}/edit?step=${step}` as never);
  };

  if (draft === null) {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: canvas.discover },
        ]}
      >
        <View style={styles.center}>
          <Spinner size={36} />
          <Text style={styles.label}>Loading…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.host}>
      <PreviewEventView
        draft={draft}
        brand={brand}
        onBack={handleBack}
        onShareTap={handleShareTap}
        onEditStep={handleEditStep}
      />
      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={() => setToast((p) => ({ ...p, visible: false }))}
        />
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
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.md,
  },
});
