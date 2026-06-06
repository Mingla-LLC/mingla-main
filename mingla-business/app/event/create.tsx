/**
 * /event/create — instant-mount wizard entry (ORCH-0893
 * [Eager server-draft on creator entry — replace with client-id + lazy autosave]).
 *
 * Mints a client-side `d_<ts36>` draft id via the synchronous Zustand
 * `useDraftEventStore.createDraft(brandId)` action and immediately
 * `router.replace`s to `/event/{d_id}/edit?step=0`. No entry-blocking
 * server mutation. The server-side `events` row is created lazily by
 * `app/event/[id]/edit.tsx` on the first user-meaningful edit (per
 * `isDraftDirty` in `src/utils/draftDirtyCheck.ts`).
 *
 * Per I-PROPOSED-CREATOR-ENTRY-IS-INSTANT (DRAFT — flips to ACTIVE on
 * ORCH-0893 close). Per I-11 format-agnostic ID resolver: the `d_*` id
 * format flows through `useDraftById` resolver unchanged.
 *
 * The placeholder host exists ONLY for the brief auth-readiness wait
 * window. On a warm session the route mounts, the useEffect fires, and
 * `router.replace` runs in the same tick — the user never sees this
 * page past the first paint.
 *
 * Supersedes the Cycle 3 spec §3.5 route 1 eager-mutation pattern
 * (4-round-trip chain) and the ORCH-0743 cold-start redirect-loop
 * fix's eager-mutation usage from this route. The server-draft
 * mutation hook still exists in `useServerDraftEvents.ts` and is
 * called from the edit route's lazy-insert trigger.
 */

import React, { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  canvas,
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import { Spinner } from "../../src/components/ui/Spinner";
import { Button } from "../../src/components/ui/Button";
import { useCurrentBrandId } from "../../src/store/currentBrandStore";
import { useDraftEventStore } from "../../src/store/draftEventStore";
import { useAuth } from "../../src/context/AuthContext";
import { useCurrentBrandRecovery } from "../../src/hooks/useCurrentBrandRecovery";

const ROUTE_BOOT_TIMEOUT_MS = 6000;
const DRAFT_HYDRATION_TIMEOUT_MS = 6000;

type CreateRouteTerminalState =
  | "signed_out"
  | "auth_timeout"
  | "auth_error"
  | "brand_error"
  | "no_brand"
  | "draft_hydration_timeout";

const goToStaticHome = (router: ReturnType<typeof useRouter>): void => {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.location.assign("/home");
    return;
  }
  router.replace("/(tabs)/home" as never);
};

const retryRoute = (router: ReturnType<typeof useRouter>): void => {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.location.reload();
    return;
  }
  router.replace("/event/create" as never);
};

export default function EventCreateRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const currentBrandId = useCurrentBrandId();
  const { authError, authStatus, isAuthReady, loading } = useAuth();
  const currentBrandRecovery = useCurrentBrandRecovery();
  const startedRef = useRef<boolean>(false);
  const warnedStateRef = useRef<CreateRouteTerminalState | null>(null);
  const [routeTimedOut, setRouteTimedOut] = useState<boolean>(false);
  const [hydrationTimedOut, setHydrationTimedOut] = useState<boolean>(false);

  // ORCH-0893 REWORK Part A — Zustand persist hydration gate.
  // Pre-rework, `/event/create` minted the d_<ts36> draft synchronously
  // and `router.replace`d in the same tick. If the user tapped before
  // `useDraftEventStore`'s persist middleware finished hydrating from
  // AsyncStorage / localStorage, the just-minted draft was OVERWRITTEN
  // when hydration completed and `setState(persisted, true)` REPLACED
  // the in-memory state. The next route (`event/[id]/edit.tsx`) then
  // saw `draft === null` for `d_<ts36>` and the existing bounce-home
  // guard fired → "wizard shows up then immediately closes."
  //
  // Pre-ORCH-0893 was masked because the eager server-draft chain
  // ran ~600ms-1.5s, by which time hydration had completed.
  //
  // Fix: wait for `useDraftEventStore.persist.hasHydrated()` before
  // calling createDraft. Zustand v5 exposes `hasHydrated()` synchronously
  // and `onFinishHydration(cb)` as a subscription for the async case.
  const [hydrated, setHydrated] = useState<boolean>(() =>
    useDraftEventStore.persist.hasHydrated(),
  );

  useEffect(() => {
    if (hydrated) return undefined;
    const unsub = useDraftEventStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
    // Defensive re-check: hydration may complete between the initial
    // `hasHydrated()` read and this effect mount (rare microtask race).
    if (useDraftEventStore.persist.hasHydrated()) {
      setHydrated(true);
    }
    return unsub;
  }, [hydrated]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setRouteTimedOut(true);
    }, ROUTE_BOOT_TIMEOUT_MS);
    return (): void => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (hydrated) {
      setHydrationTimedOut(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      if (!useDraftEventStore.persist.hasHydrated()) {
        setHydrationTimedOut(true);
      }
    }, DRAFT_HYDRATION_TIMEOUT_MS);
    return (): void => clearTimeout(timer);
  }, [hydrated]);

  const terminalState: CreateRouteTerminalState | null =
    authError !== null
      ? "auth_error"
      : !loading && authStatus === "signed_out"
        ? "signed_out"
        : routeTimedOut && !isAuthReady
          ? "auth_timeout"
          : currentBrandRecovery.isError
            ? "brand_error"
            : isAuthReady &&
                !currentBrandRecovery.isResolving &&
                hydrated &&
                currentBrandId === null
              ? "no_brand"
              : hydrationTimedOut
                ? "draft_hydration_timeout"
                : null;

  useEffect(() => {
    if (terminalState === null || warnedStateRef.current === terminalState) {
      return;
    }
    warnedStateRef.current = terminalState;
    console.warn("[event/create] terminal-state", {
      terminalState,
      authStatus,
      brandError: currentBrandRecovery.errorMessage,
    });
  }, [authStatus, currentBrandRecovery.errorMessage, terminalState]);

  useEffect(() => {
    if (startedRef.current) return;
    if (terminalState !== null) return;
    if (!isAuthReady || currentBrandRecovery.isResolving) return;
    // ORCH-0893 REWORK Part A: do not mint a client-side draft until
    // Zustand persist hydration has completed — otherwise the persisted
    // state overwrites the just-minted draft and the edit route
    // bounces home.
    if (!hydrated) return;
    if (currentBrandId === null) {
      return;
    }
    startedRef.current = true;
    // Use `getState().createDraft(...)` instead of a subscribed selector
    // so we read the CURRENT post-hydration store and write the new draft
    // into the post-hydration state directly — no subscription staleness,
    // no risk of the persisted state replacing our write.
    const draft = useDraftEventStore.getState().createDraft(currentBrandId);
    router.replace(`/event/${draft.id}/edit?step=0` as never);
  }, [
    currentBrandId,
    currentBrandRecovery.isResolving,
    hydrated,
    isAuthReady,
    router,
    terminalState,
  ]);

  if (terminalState !== null) {
    const copy = terminalCopy[terminalState];
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: canvas.discover },
        ]}
      >
        <View style={styles.card}>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.body}>{copy.body}</Text>
          <View style={styles.buttonStack}>
            <Button
              label={copy.primaryLabel}
              onPress={() => {
                if (terminalState === "signed_out" || terminalState === "auth_timeout") {
                  router.replace("/auth?next=/event/create" as never);
                  return;
                }
                retryRoute(router);
              }}
              fullWidth
              size="md"
              shape="square"
            />
            <Button
              label="Back to Home"
              onPress={() => goToStaticHome(router)}
              fullWidth
              size="md"
              shape="square"
              variant="secondary"
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, backgroundColor: canvas.discover },
      ]}
    >
      <View style={styles.center}>
        <Spinner size={36} />
        <Text style={styles.label}>
          {!isAuthReady
            ? "Finishing sign-in…"
            : currentBrandRecovery.isResolving
              ? "Getting your brand ready…"
              : !hydrated
                ? "Loading local drafts…"
                : "Loading…"}
        </Text>
      </View>
    </View>
  );
}

const terminalCopy: Record<
  CreateRouteTerminalState,
  { title: string; body: string; primaryLabel: string }
> = {
  signed_out: {
    title: "Sign in to create an event.",
    body: "Your browser session is not available on this route.",
    primaryLabel: "Sign in again",
  },
  auth_timeout: {
    title: "We could not finish sign-in.",
    body: "Refresh or sign in again before starting an event.",
    primaryLabel: "Sign in again",
  },
  auth_error: {
    title: "We could not finish sign-in.",
    body: "Refresh or sign in again before starting an event.",
    primaryLabel: "Try again",
  },
  brand_error: {
    title: "We could not load your brand.",
    body: "Try again before starting an event.",
    primaryLabel: "Try again",
  },
  no_brand: {
    title: "Create or select a brand before starting an event.",
    body: "Use desktop or the Mingla Business app if brand setup is not available on this phone browser.",
    primaryLabel: "Try again",
  },
  draft_hydration_timeout: {
    title: "This browser cannot save drafts right now.",
    body: "Refresh, use desktop, or use the Mingla Business app before creating this listing.",
    primaryLabel: "Try again",
  },
};

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
  card: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  body: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
  },
  buttonStack: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
