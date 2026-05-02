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
import { EditPublishedScreen } from "../../../src/components/event/EditPublishedScreen";
import { useBrandList } from "../../../src/store/currentBrandStore";
import { useDraftById } from "../../../src/store/draftEventStore";
import { useLiveEventStore } from "../../../src/store/liveEventStore";

export default function EventEditRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string | string[];
    step?: string | string[];
    mode?: string | string[];
  }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const stepParam = Array.isArray(params.step) ? params.step[0] : params.step;
  const modeParam = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  // Cycle 9b-2: when ?mode=edit-published, render the focused
  // EditPublishedScreen instead of the create wizard. The id refers to
  // a LIVE event, not a draft.
  const isEditPublished = modeParam === "edit-published";

  const initialStep = useMemo<number | undefined>(() => {
    if (stepParam === undefined || stepParam.length === 0) return undefined;
    const n = parseInt(stepParam, 10);
    return Number.isFinite(n) ? n : undefined;
  }, [stepParam]);

  // Edit-published path: resolve LiveEvent.
  const liveEvent = useLiveEventStore((s) => {
    if (!isEditPublished) return null;
    if (typeof idParam !== "string" || idParam.length === 0) return null;
    return s.events.find((e) => e.id === idParam) ?? null;
  });

  // Create/draft path: resolve DraftEvent.
  const draft = useDraftById(
    !isEditPublished && typeof idParam === "string" ? idParam : null,
  );
  const brands = useBrandList();
  const brand = useMemo(() => {
    if (isEditPublished) {
      if (liveEvent === null) return null;
      return brands.find((b) => b.id === liveEvent.brandId) ?? null;
    }
    if (draft === null) return null;
    return brands.find((b) => b.id === draft.brandId) ?? null;
  }, [isEditPublished, liveEvent, draft, brands]);

  const [toast, setToast] = React.useState<{ visible: boolean; message: string }>(
    { visible: false, message: "" },
  );

  useEffect(() => {
    if (typeof idParam !== "string" || idParam.length === 0) {
      router.replace("/(tabs)/events" as never);
      return;
    }
    if (isEditPublished) {
      if (liveEvent === null) {
        // Live event not found — bounce to events tab.
        const t = setTimeout(() => {
          router.replace("/(tabs)/events" as never);
        }, 0);
        return (): void => clearTimeout(t);
      }
      return undefined;
    }
    if (draft === null) {
      // Draft not found — bounce home (existing behaviour).
      const t = setTimeout(() => {
        router.replace("/(tabs)/home" as never);
      }, 0);
      return (): void => clearTimeout(t);
    }
    return undefined;
  }, [idParam, isEditPublished, draft, liveEvent, router]);

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

  // Cycle 9b-2 edit-published branch — render the focused edit screen
  // when ?mode=edit-published. Loading shell while liveEvent resolves.
  if (isEditPublished) {
    if (liveEvent === null) {
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
    return <EditPublishedScreen liveEvent={liveEvent} />;
  }

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
