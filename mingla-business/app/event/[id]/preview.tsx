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
import { useQueryClient } from "@tanstack/react-query";
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
  MultiDateOverrideSheet,
  type MultiDateOverrideSavePatch,
} from "../../../src/components/event/MultiDateOverrideSheet";
import { PreviewEventView } from "../../../src/components/event/PreviewEventView";
import { useBrandList } from "../../../src/store/currentBrandStore";
import {
  useDraftById,
  useDraftEventStore,
  type DraftEvent,
} from "../../../src/store/draftEventStore";
import {
  eventDraftKeys,
  useServerDraftAutosave,
  useServerDraftById,
} from "../../../src/hooks/useServerDraftEvents";
import { createServerDraft } from "../../../src/services/eventDrafts";
import { useAuth } from "../../../src/context/AuthContext";
import { isBusinessAuthNotReadyError } from "../../../src/utils/authReadiness";

export default function EventPreviewRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const isLegacyLocalDraftId =
    typeof idParam === "string" && idParam.startsWith("d_");
  const { isAuthReady } = useAuth();

  const draft = useDraftById(typeof idParam === "string" ? idParam : null);
  const serverDraftQuery = useServerDraftById(
    typeof idParam === "string" && !isLegacyLocalDraftId ? idParam : null,
  );
  const serverDraftSettled =
    isAuthReady &&
    !isLegacyLocalDraftId &&
    !serverDraftQuery.isLoading &&
    !serverDraftQuery.isFetching &&
    !serverDraftQuery.isError;
  const staleServerDraft =
    draft !== null &&
    !draft.id.startsWith("d_") &&
    serverDraftSettled &&
    serverDraftQuery.data === null;
  const autosave = useServerDraftAutosave();
  const brands = useBrandList();
  const brand = useMemo(() => {
    if (draft === null) return null;
    return brands.find((b) => b.id === draft.brandId) ?? null;
  }, [draft, brands]);
  const updateDraft = useDraftEventStore((s) => s.updateDraft);
  const replaceDraft = useDraftEventStore((s) => s.replaceDraft);
  const deleteDraft = useDraftEventStore((s) => s.deleteDraft);
  const migratingLegacyIdRef = React.useRef<string | null>(null);
  const staleRecoveryDraftIdRef = React.useRef<string | null>(null);

  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  // Per-date override sheet state — owned at the route handler so the
  // sheet portals correctly per I-13 (overlay-portal contract).
  // Cycle 4 Q-5 — same MultiDateOverrideSheet used from Step 2 row pencil.
  const [overrideEntryId, setOverrideEntryId] = useState<string | null>(null);
  const overrideEntry =
    overrideEntryId === null || draft === null || draft.multiDates === null
      ? null
      : draft.multiDates.find((e) => e.id === overrideEntryId) ?? null;
  const overrideEntryIndex =
    overrideEntryId === null || draft === null || draft.multiDates === null
      ? 0
      : draft.multiDates.findIndex((e) => e.id === overrideEntryId);

  const handleEditMultiDateOverride = React.useCallback(
    (entryId: string): void => {
      setOverrideEntryId(entryId);
    },
    [],
  );

  const handleSaveOverride = React.useCallback(
    (patch: MultiDateOverrideSavePatch): void => {
      if (draft === null || overrideEntryId === null || staleServerDraft) return;
      const existing = draft.multiDates ?? [];
      // Auto-sort: startTime change can re-order rows chronologically.
      const next = existing
        .map((e) =>
          e.id === overrideEntryId
            ? {
                ...e,
                startTime: patch.startTime,
                endTime: patch.endTime,
                overrides: patch.overrides,
              }
            : e,
        )
        .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
      updateDraft(draft.id, { multiDates: next });
      if (!draft.id.startsWith("d_") && !staleServerDraft) {
        autosave.saveDraft({
          ...draft,
          multiDates: next,
          updatedAt: new Date().toISOString(),
        });
      }
      setOverrideEntryId(null);
    },
    [autosave, draft, overrideEntryId, staleServerDraft, updateDraft],
  );

  useEffect(() => {
    if (
      draft !== null &&
      draft.id.startsWith("d_") &&
      migratingLegacyIdRef.current !== draft.id
    ) {
      if (!isAuthReady) return undefined;
      migratingLegacyIdRef.current = draft.id;
      void createServerDraft(draft.brandId, draft)
        .then((serverDraft) => {
          replaceDraft(draft.id, serverDraft);
          router.replace(`/event/${serverDraft.id}/preview` as never);
        })
        .catch((error) => {
          migratingLegacyIdRef.current = null;
          if (isBusinessAuthNotReadyError(error)) {
            return;
          }
          setToast({
            visible: true,
            message: "Could not sync this local draft yet.",
          });
        });
      return undefined;
    }
    if (staleServerDraft) {
      if (staleRecoveryDraftIdRef.current === draft.id) {
        return undefined;
      }
      staleRecoveryDraftIdRef.current = draft.id;
      deleteDraft(draft.id);
      queryClient.removeQueries({ queryKey: eventDraftKeys.detail(draft.id) });
      queryClient.setQueryData<DraftEvent[]>(
        eventDraftKeys.list(draft.brandId),
        (prev) => (prev ?? []).filter((d) => d.id !== draft.id),
      );
      queryClient.invalidateQueries({ queryKey: eventDraftKeys.list(draft.brandId) });
      setToast({
        visible: true,
        message: "This draft is no longer editable.",
      });
      router.replace("/(tabs)/events" as never);
      return undefined;
    }
    if (staleRecoveryDraftIdRef.current === idParam) {
      return undefined;
    }
    if (!isAuthReady) {
      return undefined;
    }
    if (
      typeof idParam !== "string" ||
      idParam.length === 0 ||
      (draft === null && !serverDraftQuery.isLoading && !serverDraftQuery.isFetching)
    ) {
      const t = setTimeout(() => {
        router.replace("/(tabs)/home" as never);
      }, 0);
      return (): void => clearTimeout(t);
    }
    return undefined;
  }, [
    idParam,
    draft,
    router,
    isAuthReady,
    replaceDraft,
    deleteDraft,
    queryClient,
    serverDraftQuery.isFetching,
    serverDraftQuery.isError,
    serverDraftQuery.isLoading,
    serverDraftQuery.data,
    staleServerDraft,
  ]);

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

  if (staleServerDraft) {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: canvas.discover },
        ]}
      >
        <View style={styles.center}>
          <Spinner size={36} />
          <Text style={styles.label}>Recovering event…</Text>
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
    <View style={styles.host}>
      <PreviewEventView
        draft={draft}
        brand={brand}
        onBack={handleBack}
        onShareTap={handleShareTap}
        onEditStep={handleEditStep}
        onEditMultiDateOverride={handleEditMultiDateOverride}
      />
      {/* Per-date override sheet — Cycle 4 Q-5 entry from Preview accordion.
          Sheet state lives here (route handler) so it portals correctly. */}
      <MultiDateOverrideSheet
        visible={overrideEntryId !== null}
        onClose={() => setOverrideEntryId(null)}
        onSave={handleSaveOverride}
        entry={overrideEntry}
        entryIndex={overrideEntryIndex >= 0 ? overrideEntryIndex : 0}
        parentDraft={draft}
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
