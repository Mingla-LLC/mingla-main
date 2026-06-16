/**
 * ORCH-1150-R2 D-5 — /rsvp/[id]/preview — in-app preview of an RSVP draft.
 *
 * The RSVP twin of `app/event/[id]/preview.tsx`. Resolves the RSVP draft the
 * SAME way the ticketed preview does (useDraftById + d_*→server migration +
 * stale/missing recovery), then renders the RSVP-safe public renderer
 * `RsvpPublicBody` (the Going / Not-going, money-free surface) — NEVER
 * `PreviewEventView` / `FoundationEventPreview`, which assume ticket tiers +
 * checkout (investigation F-3). The Going / Not-going CTA here is a PREVIEW
 * no-op: it shows an informational toast and NEVER calls `submitPublicRsvp` /
 * the edge function — a draft has no public guest list to write to.
 *
 * DO NOT delete — `RsvpStep7Preview` → `edit.tsx:381` pushes
 * `/rsvp/{id}/preview`; without this file expo-router falls through to
 * `+not-found.tsx` (the white-screen / enlarged-logo crash, ORCH-1150-R2).
 */

import React, { useEffect, useMemo, useState } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";
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
import { RsvpPublicBody } from "../../../src/components/event/RsvpPublicBody";
import {
  resolveTheme,
  createThemePalette,
  type PublicEventProps,
  type PublicBrandProps,
} from "@mingla/event-rendering";
import { useBrandList, type Brand } from "../../../src/store/currentBrandStore";
import {
  useDraftById,
  useDraftEventStore,
  type DraftEvent,
} from "../../../src/store/draftEventStore";
import {
  eventDraftKeys,
  useServerDraftById,
} from "../../../src/hooks/useServerDraftEvents";
import { createServerDraft } from "../../../src/services/eventDrafts";
import { useAuth } from "../../../src/context/AuthContext";
import { isBusinessAuthNotReadyError } from "../../../src/utils/authReadiness";
import {
  formatDraftDateLine,
  formatDraftDateSubline,
  formatDraftDatesList,
} from "../../../src/utils/eventDateDisplay";
import { isLegacyUnsafeEventCoverVideoUrl } from "../../../src/utils/eventCoverMediaRules";
import { eventCoverProviderCreditLabel } from "../../../src/types/eventCoverProvider";

// ----- Draft → public-prop mappers (inlined to avoid editing PublicEventPage) -

/**
 * Maps an RSVP DraftEvent into the `PublicEventProps` `RsvpPublicBody` consumes.
 * Mirrors `PublicEventPage.mapLiveEventToPublicEvent` field-for-field, with two
 * RSVP/preview adjustments: zero `tickets` (RSVP carries no tiers) and empty
 * `brandSlug`/`eventSlug` (a draft has no published slug; the preview never
 * shares — `onShare` is a toast). `currency` is a placeholder ("GBP") never read
 * by `RsvpPublicBody`.
 */
const mapDraftToPublicEvent = (draft: DraftEvent): PublicEventProps => {
  const coverVideoUnsafe = isLegacyUnsafeEventCoverVideoUrl(
    draft.coverMediaUrl,
    draft.coverMediaType,
  );
  const safeCoverMediaUrl = coverVideoUnsafe ? null : draft.coverMediaUrl;
  const safeCoverMediaType = coverVideoUnsafe ? null : draft.coverMediaType;
  const coverCredit = eventCoverProviderCreditLabel({
    provider: coverVideoUnsafe ? null : draft.coverMediaProvider ?? null,
    credit: coverVideoUnsafe ? null : draft.coverMediaCredit ?? null,
  });
  return {
    id: draft.id,
    name: draft.name,
    brandId: draft.brandId,
    brandSlug: draft.serverSlug ?? "",
    eventSlug: "",
    description: draft.description,
    dateLine: formatDraftDateLine(draft),
    dateSubline: formatDraftDateSubline(draft),
    datesList: formatDraftDatesList(draft),
    status: "published",
    endedAt: null,
    format:
      draft.format === "online"
        ? "online"
        : draft.format === "hybrid"
          ? "hybrid"
          : "in-person",
    venueName: draft.venueName ?? null,
    address: draft.address ?? null,
    hideAddressUntilTicket: Boolean(draft.hideAddressUntilTicket),
    coverHue: draft.coverHue,
    coverMediaUrl: safeCoverMediaUrl,
    coverMediaType:
      safeCoverMediaType === "image" ||
      safeCoverMediaType === "video" ||
      safeCoverMediaType === "gif"
        ? safeCoverMediaType
        : null,
    coverCredit,
    tickets: [],
    currency: "GBP",
    themeOverrides: draft.themeOverrides ?? null,
  };
};

/** Identical to `PublicEventPage.mapBrandToPublicBrand` (inlined, not edited). */
const mapBrandToPublicBrand = (
  brand: Brand | null,
): PublicBrandProps | null => {
  if (brand === null) return null;
  return {
    id: brand.id,
    slug: brand.slug,
    displayName: brand.displayName ?? "Brand",
    photo: brand.photo,
    theme: brand.theme ?? null,
  };
};

const openMapsForQuery = (query: string): void => {
  const encoded = encodeURIComponent(query);
  const googleUrl = `https://www.google.com/maps/search/?api=1&query=${encoded}`;
  const platformUrl =
    Platform.OS === "ios"
      ? `maps://?q=${encoded}`
      : Platform.OS === "android"
        ? `geo:0,0?q=${encoded}`
        : googleUrl;

  void Linking.openURL(platformUrl).catch(() => {
    void Linking.openURL(googleUrl).catch(() => undefined);
  });
};

export default function RsvpPreviewRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isAuthReady } = useAuth();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const isLegacyLocalDraftId =
    typeof idParam === "string" && idParam.startsWith("d_");

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
  const replaceDraft = useDraftEventStore((s) => s.replaceDraft);
  const deleteDraft = useDraftEventStore((s) => s.deleteDraft);
  const migratingLegacyIdRef = React.useRef<string | null>(null);
  const staleRecoveryDraftIdRef = React.useRef<string | null>(null);

  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });
  const [muted, setMuted] = useState<boolean>(true);

  // Legacy d_* → server-draft migration + stale recovery + missing-draft bounce.
  // Copied from app/event/[id]/preview.tsx, with /event targets swapped to /rsvp.
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
          router.replace(`/rsvp/${serverDraft.id}/preview` as never);
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
        router.replace("/(tabs)/hub/events" as never);
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

  // Wrong-wizard guard (mirror edit.tsx:333–343 inverse): a hand-typed/stale
  // /rsvp/{id}/preview pointed at a TICKETED draft (isRsvp=false) routes to the
  // ticketed preview — the route is the discriminator.
  useEffect(() => {
    if (draft === null) return;
    if (draft.isRsvp === false) {
      // orch-strict-grep-allow route-by-event-type — wrong-wizard fallback: a /rsvp preview URL on a ticketed (isRsvp=false) draft routes to the ticketed event preview
      router.replace(`/event/${draft.id}/preview` as never);
    }
  }, [draft, router]);

  const handleBack = (): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/hub/events" as never);
    }
  };

  const handleShareTap = (): void => {
    setToast({
      visible: true,
      message: "This is a preview — publish to get a shareable link.",
    });
  };

  // Preview submit — NO-OP. Never calls submitPublicRsvp / the edge function;
  // a draft has no public guest list. Resolves to a defined state so the body's
  // optimistic UI has a return value, but writes nothing.
  const handlePreviewSubmit = async (): Promise<{
    status: "going" | "not_going" | "waitlisted";
    approvalStatus: "pending" | "approved";
  }> => {
    setToast({
      visible: true,
      message: "This is a preview. Publish to let guests RSVP.",
    });
    return { status: "going", approvalStatus: "approved" };
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

  const publicEvent = mapDraftToPublicEvent(draft);
  const publicBrand = mapBrandToPublicBrand(brand);
  const resolvedTheme = resolveTheme(
    publicBrand?.theme ?? null,
    publicEvent.themeOverrides ?? null,
  );
  const palette = createThemePalette(resolvedTheme);

  return (
    <View style={styles.host}>
      <RsvpPublicBody
        event={publicEvent}
        brand={publicBrand}
        palette={palette}
        theme={resolvedTheme}
        config={{
          capacity: draft.rsvpCapacity,
          goingCount: 0,
          allowPlusOnes: draft.rsvpAllowPlusOnes,
          plusOnesMax: draft.rsvpPlusOnesMax,
          waitlistEnabled: draft.rsvpWaitlistEnabled,
          manualApproval: draft.rsvpApprovalMode === "manual",
        }}
        isLoggedIn={user !== null}
        muted={muted}
        onToggleMute={() => setMuted((m) => !m)}
        onClose={handleBack}
        onShare={handleShareTap}
        onOpenBrand={(slug: string) => router.push(`/b/${slug}` as never)}
        onOpenMaps={openMapsForQuery}
        onSubmit={handlePreviewSubmit}
        safeAreaTop={insets.top}
        testID="orch-1150-rsvp-preview"
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
