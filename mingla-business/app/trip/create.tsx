/**
 * /trip/create — instant-mount trip wizard entry (ORCH-0893
 * [Eager server-draft on creator entry — replace with client-id + lazy autosave]).
 *
 * Mints a client-side `d_<ts36>` id synchronously via `generateDraftId`
 * and immediately `router.replace`s to `/trip/{d_id}/edit`. No
 * entry-blocking server mutation on this route.
 *
 * Universal trip-create route per I-BRAND-UNIVERSAL-AUTHORING
 * (META-ORCH-0972).
 *
 * DISC-0893: with the 4-step builder (`tripBuilderV2`) `/trip/[id]/edit` does not
 * create the server draft on mount either: it asks the host to name the trip
 * first (TripStartGate) and creates the draft from that title. The 8-step wizard
 * (flag off) still creates it on mount.
 *
 * Supersedes the Tr2 (ORCH-0859) eager `useCreateTripDraft.mutateAsync`
 * call on this route. The mutation hook still exists and is now called
 * from `/trip/[id]/edit.tsx` on `d_*` mount.
 */

import React, { useEffect, useRef } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  color,
  space,
  type,
} from "../../src/constants/designSystem";
import { SafeScreen } from "../../src/components/ui/SafeScreen";
import { useCurrentBrand } from "../../src/hooks/useCurrentBrand";
import { generateDraftId } from "../../src/utils/draftEventId";
import { isSetupReturn, withReturnTo } from "../../src/utils/brandEditReturn";

export default function TripCreateRoute(): React.ReactElement {
  const router = useRouter();
  const currentBrand = useCurrentBrand();
  const startedRef = useRef<boolean>(false);
  // #2830 — carried through to the wizard, only when it is Website setup's.
  const params = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const rawReturnTo = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  const setupReturn = isSetupReturn(rawReturnTo) ? (rawReturnTo as string) : null;

  useEffect(() => {
    if (startedRef.current) return;
    if (currentBrand === null) return;

    startedRef.current = true;
    // ORCH-0893: synchronous client-side id, no server round-trip.
    // I-PROPOSED-CREATOR-ENTRY-IS-INSTANT.
    const clientId = generateDraftId();
    if (setupReturn) {
      router.replace(withReturnTo(`/trip/${clientId}/edit`, setupReturn) as never);
      return;
    }
    router.replace(`/trip/${clientId}/edit` as never);
  }, [currentBrand, router, setupReturn]);

  if (currentBrand === null) {
    return (
      <SafeScreen style={styles.host}>
        <ActivityIndicator />
        <Text style={styles.body}>Loading brand…</Text>
      </SafeScreen>
    );
  }

  return (
    <SafeScreen style={styles.host}>
      <ActivityIndicator />
      <Text style={styles.body}>Loading…</Text>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space[7],
    gap: space[4],
    backgroundColor: color.canvas,
  },
  body: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: color.text2,
    textAlign: "center",
  },
});
