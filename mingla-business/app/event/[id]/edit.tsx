/**
 * /event/[id]/edit — wizard resume entry (J-E4).
 *
 * Reads dynamic `id` segment + optional `?step=N` query param. Resolves
 * draft via useDraftEventStore.getDraft(id). When draft exists →
 * renders EventCreatorWizard at the requested step (or
 * draft.lastStepReached if no step query). When draft NOT found →
 * bounces to /(tabs)/home.
 *
 * Format-agnostic ID resolver per Cycle 2 invariant I-11.
 * Host-bg cascade per Cycle 2 invariant I-12 (the wizard sets it
 * itself, but the redirect-state View also honours it).
 *
 * Per Cycle 3 spec §3.5 route 2.
 */

import React, { useEffect, useMemo } from "react";
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
import {
  EventCreatorWizard,
  type WizardExitMode,
} from "../../../src/components/event/EventCreatorWizard";
import { useBrandList } from "../../../src/store/currentBrandStore";
import { useDraftById } from "../../../src/store/draftEventStore";

export default function EventEditRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[]; step?: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const stepParam = Array.isArray(params.step) ? params.step[0] : params.step;
  const initialStep = useMemo<number | undefined>(() => {
    if (stepParam === undefined || stepParam.length === 0) return undefined;
    const n = parseInt(stepParam, 10);
    return Number.isFinite(n) ? n : undefined;
  }, [stepParam]);

  const draft = useDraftById(typeof idParam === "string" ? idParam : null);
  const brands = useBrandList();
  const brand = useMemo(() => {
    if (draft === null) return null;
    return brands.find((b) => b.id === draft.brandId) ?? null;
  }, [draft, brands]);

  const [toast, setToast] = React.useState<{ visible: boolean; message: string }>(
    { visible: false, message: "" },
  );

  useEffect(() => {
    if (typeof idParam !== "string" || idParam.length === 0) {
      router.replace("/(tabs)/home" as never);
      return;
    }
    if (draft === null) {
      // Draft not found — bounce home.
      // The setTimeout 0 lets the Spinner render briefly before navigate.
      const t = setTimeout(() => {
        router.replace("/(tabs)/home" as never);
      }, 0);
      return (): void => clearTimeout(t);
    }
    return undefined;
  }, [idParam, draft, router]);

  const isCreateMode = useMemo<boolean>(() => {
    if (draft === null) return false;
    // First-time edit: lastStepReached is 0 AND name is empty AND no fields filled.
    return draft.lastStepReached === 0 && draft.name.length === 0;
  }, [draft]);

  const handleExit = React.useCallback(
    (
      mode: WizardExitMode,
      ctx?: {
        name?: string;
        slug?: { brandSlug: string; eventSlug: string };
      },
    ): void => {
      if (mode === "published") {
        const name = ctx?.name ?? "Event";
        setToast({ visible: true, message: `${name} is live.` });
        // Cycle 6 — route to the new public event page when slug is
        // provided. Falls back to home tab when slug missing (e.g.
        // pre-Cycle-6 draft or publish-failed-but-flagged-published).
        if (ctx?.slug !== undefined) {
          router.replace(
            `/e/${ctx.slug.brandSlug}/${ctx.slug.eventSlug}` as never,
          );
        } else {
          router.replace("/(tabs)/home" as never);
        }
      } else {
        // Discarded / abandoned (chrome X close) — route to Events tab
        // so the founder lands where they can see drafts + start a new
        // event easily, per founder UX directive.
        if (mode === "discarded") {
          setToast({ visible: true, message: "Draft discarded." });
        }
        router.replace("/(tabs)/events" as never);
      }
    },
    [router],
  );

  const handleOpenPreview = React.useCallback((): void => {
    if (draft === null) return;
    router.push(`/event/${draft.id}/preview` as never);
  }, [draft, router]);

  const handleOpenStripe = React.useCallback((): void => {
    if (draft === null) return;
    router.push(`/brand/${draft.brandId}/payments/onboard` as never);
  }, [draft, router]);

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
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={() => setToast((p) => ({ ...p, visible: false }))}
        />
      </View>
    );
  }

  return (
    <EventCreatorWizard
      draft={draft}
      brand={brand}
      initialStep={initialStep}
      isCreateMode={isCreateMode}
      onExit={handleExit}
      onOpenPreview={handleOpenPreview}
      onOpenStripeOnboard={handleOpenStripe}
    />
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
