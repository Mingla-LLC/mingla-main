/**
 * /event/[id]/preview — in-app preview of a draft event.
 *
 * Reads dynamic `id` segment, resolves draft via useDraftById, and renders the
 * same FoundationEventPreview/EventTicketBox buyer tree used by
 * /e/[brandSlug]/[eventSlug], with draft-only actions kept in this route.
 *
 * Format-agnostic ID resolver per Cycle 2 invariant I-11.
 * The shared buyer renderer owns its normal theme/background cascade.
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
import { useBrandList } from "../../../src/store/currentBrandStore";
import {
  useDraftById,
  useDraftEventStore,
  type DraftEvent,
} from "../../../src/store/draftEventStore";
import {
  eventDraftKeys,
  useServerDraftById,
} from "../../../src/hooks/useServerDraftEvents";
// Issue #976 [event-name-focus] — the eager d_*→server preview migration
// routes through the single-flight registry: it joins the edit route's
// in-flight promotion (no duplicate row race) and live-merges instead of
// landing a stale snapshot (I-PROPOSED-0976-SINGLE-DRAFT-PROMOTION-OWNER).
import { promoteLegacyDraftOnce } from "../../../src/utils/draftPromotion";
import { useAuth } from "../../../src/context/AuthContext";
import { isBusinessAuthNotReadyError } from "../../../src/utils/authReadiness";
import { draftEventBuyerPreview } from "../../../src/utils/draftEventBuyerPreview";
import { DraftEventFoundationPreview } from "../../../src/components/event/DraftEventFoundationPreview";

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
  const brands = useBrandList();
  const brand = useMemo(() => {
    if (draft === null) return null;
    return brands.find((b) => b.id === draft.brandId) ?? null;
  }, [draft, brands]);
  const deleteDraft = useDraftEventStore((s) => s.deleteDraft);
  const migratingLegacyIdRef = React.useRef<string | null>(null);
  const staleRecoveryDraftIdRef = React.useRef<string | null>(null);

  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  const buyerPreview = useMemo(
    () => (draft === null ? null : draftEventBuyerPreview(draft, brand)),
    [brand, draft],
  );

  useEffect(() => {
    if (
      draft !== null &&
      draft.id.startsWith("d_") &&
      migratingLegacyIdRef.current !== draft.id
    ) {
      if (!isAuthReady) return undefined;
      migratingLegacyIdRef.current = draft.id;
      // Issue #976 — the registry owns the store swap + merge + caches. The
      // router.replace below is documented-safe: it replaces this static
      // preview screen with itself at the new id (no focused text input
      // exists here), and the edit route sitting behind it is protected by
      // its re-keyed retained-draft guard + converted safety belt.
      void promoteLegacyDraftOnce({
        queryClient,
        brandId: draft.brandId,
        draftId: draft.id,
      })
        .then((merged) => {
          router.replace(`/event/${merged.id}/preview` as never);
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
      router.replace("/(tabs)/hub/events" as never);
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
    deleteDraft,
    queryClient,
    serverDraftQuery.isFetching,
    serverDraftQuery.isError,
    serverDraftQuery.isLoading,
    serverDraftQuery.data,
    staleServerDraft,
  ]);

  if (draft === null || buyerPreview === null) {
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

  const handleClose = (): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/home" as never);
    }
  };

  return (
    <View style={styles.host}>
      <DraftEventFoundationPreview
        event={buyerPreview.event}
        brand={buyerPreview.brand}
        occurrences={buyerPreview.occurrences}
        isMultiDate={draft.whenMode === "multi_date"}
        multiDatePricingMode={draft.multiDatePricingMode ?? "per_day"}
        onClose={handleClose}
        onShare={() => setToast({
          visible: true,
          message: "Preview links are available after publishing.",
        })}
        onCheckout={() => setToast({
          visible: true,
          message: "Checkout is available after publishing.",
        })}
        onBlocked={(message) => setToast({ visible: true, message })}
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
